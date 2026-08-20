<#
.SYNOPSIS
  Provisions the Azure resources and deploys the requisition app.

.DESCRIPTION
  Runs in three passes, which is deliberate: the container registry has to
  exist before an image can be built, and the image has to exist before the
  container app can reference it.

    1. Deploy the infrastructure with a placeholder image.
    2. Build the image from source using ACR Tasks (no local Docker needed).
    3. Redeploy pointing at the built image.

  Re-running the script is safe; it converges rather than recreating.

.EXAMPLE
  ./scripts/deploy.ps1 -ResourceGroup rg-requisitions -Location eastus

.EXAMPLE
  ./scripts/deploy.ps1 -ResourceGroup rg-requisitions -AuthClientId $id -AuthClientSecret $secret
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ResourceGroup,

  [string]$Location = 'eastus',

  [string]$ParametersFile = "$PSScriptRoot/../infra/main.parameters.json",

  [string]$BicepFile = "$PSScriptRoot/../infra/main.bicep",

  # Supply these after running setup-auth.ps1 to switch on Entra ID sign-in.
  [string]$AuthClientId = '',
  [string]$AuthClientSecret = '',

  # Optional allowlist of sign-in names. Empty allows anyone who can sign in.
  [string[]]$AllowedUsers = @(),

  <#
    Credentials for reaching D365 when it lives in a different Entra tenant
    than this subscription. A managed identity belongs to a single tenant and
    is rejected by D365 with a 401 across a tenant boundary, so an app
    registration created inside the D365 tenant is required instead.

    Supply all three, or none to keep using the managed identity.
  #>
  [string]$D365TenantId = '',
  [string]$D365ClientId = '',
  [string]$D365ClientSecret = '',

  [string]$ImageTag = 'latest',

  # Pin the deployment to one subscription. Leave empty to use whichever the
  # CLI currently has selected.
  [string]$SubscriptionId = '',

  # Skip the ACR Tasks build. Required on subscriptions where ACR Tasks is
  # blocked (TasksOperationsNotAllowed) -- there the image is built by the
  # GitHub Actions workflow instead, and this script only provisions.
  [switch]$SkipImageBuild
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/common.ps1"

function Write-Step($message) {
  Write-Host ''
  Write-Host "==> $message" -ForegroundColor Cyan
}

# --- Preflight ---------------------------------------------------------------

Set-AzCaBundle
$az = Resolve-AzCli
Write-Host "Azure CLI: $az" -ForegroundColor DarkGray

$account = & $az account show 2>$null | ConvertFrom-Json
if (-not $account) {
  throw "Not signed in to Azure. Run: & '$az' login"
}

if ($SubscriptionId -and $account.id -ne $SubscriptionId) {
  Write-Step "Switching to subscription $SubscriptionId"
  & $az account set --subscription $SubscriptionId
  if ($LASTEXITCODE -ne 0) { throw "Could not select subscription $SubscriptionId." }
  $account = & $az account show | ConvertFrom-Json
}

Write-Host "Subscription: $($account.name) ($($account.id))" -ForegroundColor DarkGray

$d365Supplied = @($D365TenantId, $D365ClientId, $D365ClientSecret | Where-Object { $_ }).Count
if ($d365Supplied -gt 0 -and $d365Supplied -lt 3) {
  throw 'D365TenantId, D365ClientId and D365ClientSecret must be supplied together, or all omitted.'
}
$useD365ServicePrincipal = $d365Supplied -eq 3

$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path

# --- Resource group ----------------------------------------------------------

# A resource group's location is fixed at creation, and `az group create`
# rejects a different one rather than ignoring it. Only create when absent, so
# -Location is what to use for a new group rather than an assertion about an
# existing one.
$groupExists = (& $az group exists --name $ResourceGroup) -eq 'true'

if ($groupExists) {
  $existingLocation = & $az group show --name $ResourceGroup --query location --output tsv
  Write-Step "Using existing resource group '$ResourceGroup' in $existingLocation"

  if ($PSBoundParameters.ContainsKey('Location') -and $Location -ne $existingLocation) {
    Write-Host "    Ignoring -Location '$Location': a resource group cannot be moved." -ForegroundColor Yellow
  }

  # Everything in the template defaults to resourceGroup().location, so
  # resources follow the group rather than this parameter.
  $Location = $existingLocation
} else {
  Write-Step "Creating resource group '$ResourceGroup' in $Location"
  & $az group create --name $ResourceGroup --location $Location --output none
  if ($LASTEXITCODE -ne 0) { throw "Failed to create resource group '$ResourceGroup' in '$Location'." }
}

# --- Pass 1: infrastructure --------------------------------------------------

# The template's containerImage parameter defaults to a placeholder. If an app
# is already running a real image -- pushed by the GitHub Actions workflow, for
# instance -- redeploying without pinning that image would silently roll the
# app back to the placeholder. Carry the current image forward instead.
$currentImage = & $az containerapp list --resource-group $ResourceGroup `
  --query '[0].properties.template.containers[0].image' --output tsv 2>$null
if ($LASTEXITCODE -ne 0) { $currentImage = '' }

$preserveImage = $currentImage -and $currentImage -notmatch 'k8se/quickstart'

if ($preserveImage) {
  Write-Step "Deploying infrastructure (keeping current image: $currentImage)"
} else {
  Write-Step 'Deploying infrastructure (placeholder image)'
}

$deployArgs = @(
  'deployment', 'group', 'create',
  '--resource-group', $ResourceGroup,
  '--template-file', $BicepFile,
  '--parameters', "@$ParametersFile",
  '--output', 'json'
)
if ($preserveImage) {
  $deployArgs += @('--parameters', "containerImage=$currentImage")
}
if ($AuthClientId) {
  $deployArgs += @('--parameters', "authClientId=$AuthClientId", "authClientSecret=$AuthClientSecret")
}
if ($AllowedUsers.Count -gt 0) {
  $deployArgs += @('--parameters', "allowedUsers=$($AllowedUsers -join ',')")
}
if ($useD365ServicePrincipal) {
  $deployArgs += @('--parameters', "d365TenantId=$D365TenantId", "d365ClientId=$D365ClientId", "d365ClientSecret=$D365ClientSecret")
}

$result = & $az @deployArgs | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Infrastructure deployment failed.' }

$outputs = $result.properties.outputs
$registryName = $outputs.registryName.value
$loginServer = $outputs.registryLoginServer.value
$identityClientId = $outputs.managedIdentityClientId.value
$appName = $outputs.appName.value

# --- Pass 2: build the image -------------------------------------------------

$image = "requisitions:$ImageTag"

if ($SkipImageBuild) {
  Write-Step 'Skipping image build (-SkipImageBuild)'
  Write-Host '    The GitHub Actions workflow builds and deploys the image.' -ForegroundColor DarkGray
} else {
  Write-Step "Building image in ACR '$registryName' (this runs in Azure, not locally)"

  & $az acr build --registry $registryName --image $image --file "$repoRoot/Dockerfile" $repoRoot --output none

  if ($LASTEXITCODE -ne 0) {
    throw @"
Container image build failed.

If the error above was TasksOperationsNotAllowed, ACR Tasks is disabled on this
subscription and no permission change will fix it -- Microsoft restricts it on
trial, Visual Studio benefit, and flagged subscriptions.

Build on GitHub Actions instead:

    ./scripts/deploy.ps1 -ResourceGroup $ResourceGroup -SkipImageBuild
    ./scripts/setup-github-oidc.ps1 -ResourceGroup $ResourceGroup -GitHubRepo <owner/repo>

then push to main. See the README section "When ACR Tasks is blocked".
"@
  }

  # --- Pass 3: point the app at the real image -------------------------------

  Write-Step 'Redeploying with the built image'

  $deployArgs = @(
    'deployment', 'group', 'create',
    '--resource-group', $ResourceGroup,
    '--template-file', $BicepFile,
    '--parameters', "@$ParametersFile",
    '--parameters', "containerImage=$loginServer/$image",
    '--output', 'json'
  )
  if ($AuthClientId) {
    $deployArgs += @('--parameters', "authClientId=$AuthClientId", "authClientSecret=$AuthClientSecret")
  }
  if ($AllowedUsers.Count -gt 0) {
    $deployArgs += @('--parameters', "allowedUsers=$($AllowedUsers -join ',')")
  }
  if ($useD365ServicePrincipal) {
    $deployArgs += @('--parameters', "d365TenantId=$D365TenantId", "d365ClientId=$D365ClientId", "d365ClientSecret=$D365ClientSecret")
  }

  $result = & $az @deployArgs | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Final deployment failed.' }
}

$appUrl = $result.properties.outputs.appUrl.value

# --- Summary -----------------------------------------------------------------

Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host ' Deployment complete' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''
Write-Host "  App URL          : $appUrl"
Write-Host "  Container app    : $appName"
Write-Host "  Registry         : $loginServer"
Write-Host ''
Write-Host '  Managed identity client ID:' -ForegroundColor Yellow
Write-Host "    $identityClientId" -ForegroundColor Yellow
Write-Host ''
Write-Host '  REQUIRED NEXT STEP in Dynamics 365:' -ForegroundColor Yellow
Write-Host '    System administration > Setup > Microsoft Entra ID applications'
Write-Host '    Add a row with:'
Write-Host "      Client Id : $identityClientId"
Write-Host '      Name      : Requisition app (or anything descriptive)'
Write-Host '      User ID   : a service account user with requisition permissions'
Write-Host ''
if ($SkipImageBuild) {
  Write-Host '  The container app is running a placeholder image until the' -ForegroundColor Yellow
  Write-Host '  GitHub Actions workflow pushes the real one. Next:' -ForegroundColor Yellow
  Write-Host "    ./scripts/setup-github-oidc.ps1 -ResourceGroup $ResourceGroup -GitHubRepo <owner/repo>"
  Write-Host '    then push to main.'
} else {
  Write-Host "  Then open $appUrl/diagnostics to verify the connection."
}
Write-Host ''

if (-not $AuthClientId) {
  Write-Host '  NOTE: deployed without user sign-in (AUTH_MODE=none).' -ForegroundColor Red
  Write-Host '        Run scripts/setup-auth.ps1 and redeploy before sharing the URL.' -ForegroundColor Red
  Write-Host ''
}
