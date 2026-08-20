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

# --- Carry forward existing configuration ------------------------------------
#
# Every parameter not supplied on the command line falls back to the template
# default, which for an existing deployment means silently undoing settings.
# Omitting -AuthClientId would set AUTH_MODE=none and drop the stored secret,
# turning off sign-in on a running app. Reading the current values back and
# re-supplying them makes a partial redeploy safe.

$existingApp = Invoke-Az $az containerapp list --resource-group $ResourceGroup --query '[0].name' --output tsv
$existingAppName = if ($existingApp.Success) { $existingApp.Output } else { '' }

$currentImage = ''

if ($existingAppName) {
  $img = Invoke-Az $az containerapp show --name $existingAppName --resource-group $ResourceGroup `
    --query 'properties.template.containers[0].image' --output tsv
  if ($img.Success) { $currentImage = $img.Output }

  # --- Sign-in configuration ---
  if (-not $AuthClientId) {
    $auth = Invoke-Az $az containerapp auth show --name $existingAppName --resource-group $ResourceGroup `
      --query 'identityProviders.azureActiveDirectory.registration.clientId' --output tsv
    if ($auth.Success -and $auth.Output -and $auth.Output -ne 'null') {
      $secret = Invoke-Az $az containerapp secret show --name $existingAppName --resource-group $ResourceGroup `
        --secret-name 'auth-client-secret' --query value --output tsv
      if ($secret.Success -and $secret.Output) {
        $AuthClientId = $auth.Output
        $AuthClientSecret = $secret.Output
        Write-Host "Preserving existing sign-in configuration (client $AuthClientId)." -ForegroundColor DarkGray
      } else {
        Write-Host 'WARNING: sign-in is configured but its secret could not be read.' -ForegroundColor Yellow
        Write-Host '         Pass -AuthClientId and -AuthClientSecret or sign-in will be disabled.' -ForegroundColor Yellow
      }
    }
  }

  # --- D365 service principal ---
  if (-not $D365ClientId) {
    $envJson = Invoke-Az $az containerapp show --name $existingAppName --resource-group $ResourceGroup `
      --query "properties.template.containers[0].env[?name=='D365_CLIENT_ID' || name=='D365_TENANT_ID']" --output json
    if ($envJson.Success -and $envJson.Output -and $envJson.Output -ne '[]') {
      $vars = $envJson.Output | ConvertFrom-Json
      $existingClientId = ($vars | Where-Object { $_.name -eq 'D365_CLIENT_ID' }).value
      $existingTenantId = ($vars | Where-Object { $_.name -eq 'D365_TENANT_ID' }).value

      if ($existingClientId -and $existingTenantId) {
        $secret = Invoke-Az $az containerapp secret show --name $existingAppName --resource-group $ResourceGroup `
          --secret-name 'd365-client-secret' --query value --output tsv
        if ($secret.Success -and $secret.Output) {
          $D365ClientId = $existingClientId
          $D365TenantId = $existingTenantId
          $D365ClientSecret = $secret.Output
          $useD365ServicePrincipal = $true
          Write-Host "Preserving existing D365 service principal (client $D365ClientId)." -ForegroundColor DarkGray
        } else {
          Write-Host 'WARNING: D365 service principal is configured but its secret could not be read.' -ForegroundColor Yellow
          Write-Host '         Pass -D365TenantId, -D365ClientId and -D365ClientSecret or D365 access will revert' -ForegroundColor Yellow
          Write-Host '         to the managed identity, which cannot work across tenants.' -ForegroundColor Yellow
        }
      }
    }
  }
}

# --- Pass 1: infrastructure --------------------------------------------------

# The template's containerImage parameter defaults to a placeholder, so an app
# already running a real image would be rolled back to it. Pin the current one.

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

$imageBuilt = $false

if ($SkipImageBuild) {
  Write-Step 'Skipping image build (-SkipImageBuild)'
  Write-Host '    The GitHub Actions workflow builds and deploys the image.' -ForegroundColor DarkGray
} else {
  Write-Step "Building image in ACR '$registryName' (this runs in Azure, not locally)"

  # The Azure CLI writes ordinary progress ("Packing source code into tar...")
  # to stderr. In Windows PowerShell any redirection of native stderr turns
  # those lines into ErrorRecords, which under $ErrorActionPreference = 'Stop'
  # abort the script on the first progress message -- even for a build that
  # would have succeeded. Relaxing the preference for exactly this call is what
  # makes the output capturable; the exit code is still what decides success.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $buildErr = (& $az acr build --registry $registryName --image $image `
        --file "$repoRoot/Dockerfile" $repoRoot --output none 2>&1 | Out-String)
    $buildExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  if ($buildExit -eq 0) {
    $imageBuilt = $true
  } elseif ($buildErr -match 'TasksOperationsNotAllowed') {
    # Not a recoverable condition and not this script's fault: Microsoft blocks
    # ACR Tasks on some subscription types. The infrastructure deployment above
    # already succeeded, so failing the whole run here would misrepresent what
    # happened and discard that work.
    Write-Host ''
    Write-Host '  ACR Tasks is disabled on this subscription, so the image was not built.' -ForegroundColor Yellow
    Write-Host '  Infrastructure and configuration were deployed successfully.' -ForegroundColor Yellow
    Write-Host '  No permission change fixes this -- build via GitHub Actions instead:' -ForegroundColor Yellow
    Write-Host "      ./scripts/setup-github-oidc.ps1 -ResourceGroup $ResourceGroup -GitHubRepo <owner/repo>" -ForegroundColor Yellow
    Write-Host '      git push' -ForegroundColor Yellow
    Write-Host '  Pass -SkipImageBuild to skip this step silently next time.' -ForegroundColor DarkGray
  } else {
    Write-Host $buildErr
    throw 'Container image build failed. See the output above.'
  }
}

if ($imageBuilt) {

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
if ($useD365ServicePrincipal) {
  Write-Host '  D365 access: service principal (cross-tenant)' -ForegroundColor Yellow
  Write-Host "    Tenant    : $D365TenantId"
  Write-Host "    Client Id : $D365ClientId"
  Write-Host ''
  Write-Host '  That client ID must appear in Dynamics 365 under:' -ForegroundColor Yellow
  Write-Host '    System administration > Setup > Microsoft Entra ID applications'
  Write-Host '    mapped to a user with requisition permissions.'
  Write-Host ''
  Write-Host "  The managed identity ($identityClientId)" -ForegroundColor DarkGray
  Write-Host '  is still used to pull the container image, but is NOT used for D365.' -ForegroundColor DarkGray
} else {
  Write-Host '  D365 access: managed identity (same tenant only)' -ForegroundColor Yellow
  Write-Host "    Client Id : $identityClientId" -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  REQUIRED NEXT STEP in Dynamics 365:' -ForegroundColor Yellow
  Write-Host '    System administration > Setup > Microsoft Entra ID applications'
  Write-Host '    Add a row with:'
  Write-Host "      Client Id : $identityClientId"
  Write-Host '      Name      : Requisition app (or anything descriptive)'
  Write-Host '      User ID   : a service account user with requisition permissions'
  Write-Host ''
  Write-Host '  If D365 is in a DIFFERENT Entra tenant than this subscription, a' -ForegroundColor DarkGray
  Write-Host '  managed identity cannot work. Redeploy with -D365TenantId,' -ForegroundColor DarkGray
  Write-Host '  -D365ClientId and -D365ClientSecret instead.' -ForegroundColor DarkGray
}
Write-Host ''
if (-not $imageBuilt) {
  Write-Host '  Configuration was applied, but no image was built by this run.' -ForegroundColor Yellow
  Write-Host '  The container app keeps whatever image it already had, so any' -ForegroundColor Yellow
  Write-Host '  application changes need a GitHub Actions build to take effect:' -ForegroundColor Yellow
  Write-Host '    git push'
  Write-Host ''
  Write-Host "  Then open $appUrl/diagnostics to verify the connection."
} else {
  Write-Host "  Then open $appUrl/diagnostics to verify the connection."
}
Write-Host ''

if (-not $AuthClientId) {
  Write-Host '  NOTE: deployed without user sign-in (AUTH_MODE=none).' -ForegroundColor Red
  Write-Host '        Run scripts/setup-auth.ps1 and redeploy before sharing the URL.' -ForegroundColor Red
  Write-Host ''
}
