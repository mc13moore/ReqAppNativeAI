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

  [string]$ImageTag = 'latest'
)

$ErrorActionPreference = 'Stop'

function Write-Step($message) {
  Write-Host ''
  Write-Host "==> $message" -ForegroundColor Cyan
}

# --- Preflight ---------------------------------------------------------------

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw 'Azure CLI is not installed. Install it with: winget install Microsoft.AzureCLI'
}

$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
  throw 'Not signed in to Azure. Run: az login'
}
Write-Host "Subscription: $($account.name) ($($account.id))" -ForegroundColor DarkGray

$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path

# --- Resource group ----------------------------------------------------------

Write-Step "Ensuring resource group '$ResourceGroup' in $Location"
az group create --name $ResourceGroup --location $Location --output none
if ($LASTEXITCODE -ne 0) { throw 'Failed to create the resource group.' }

# --- Pass 1: infrastructure --------------------------------------------------

Write-Step 'Deploying infrastructure (placeholder image)'

$deployArgs = @(
  'deployment', 'group', 'create',
  '--resource-group', $ResourceGroup,
  '--template-file', $BicepFile,
  '--parameters', "@$ParametersFile",
  '--output', 'json'
)
if ($AuthClientId) {
  $deployArgs += @('--parameters', "authClientId=$AuthClientId", "authClientSecret=$AuthClientSecret")
}

$result = az @deployArgs | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Infrastructure deployment failed.' }

$outputs = $result.properties.outputs
$registryName = $outputs.registryName.value
$loginServer = $outputs.registryLoginServer.value
$identityClientId = $outputs.managedIdentityClientId.value
$appName = $outputs.appName.value

# --- Pass 2: build the image -------------------------------------------------

Write-Step "Building image in ACR '$registryName' (this runs in Azure, not locally)"

$image = "requisitions:$ImageTag"
az acr build --registry $registryName --image $image --file "$repoRoot/Dockerfile" $repoRoot --output none
if ($LASTEXITCODE -ne 0) { throw 'Container image build failed.' }

# --- Pass 3: point the app at the real image ---------------------------------

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

$result = az @deployArgs | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Final deployment failed.' }

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
Write-Host "  Then open $appUrl/diagnostics to verify the connection."
Write-Host ''

if (-not $AuthClientId) {
  Write-Host '  NOTE: deployed without user sign-in (AUTH_MODE=none).' -ForegroundColor Red
  Write-Host '        Run scripts/setup-auth.ps1 and redeploy before sharing the URL.' -ForegroundColor Red
  Write-Host ''
}
