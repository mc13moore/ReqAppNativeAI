<#
.SYNOPSIS
  Lets GitHub Actions deploy to Azure without storing any long-lived secret.

.DESCRIPTION
  Creates an Entra ID app registration and configures a federated credential so
  Azure will trust short-lived tokens minted by GitHub Actions for one specific
  repository and branch. Nothing secret is ever created, so nothing has to be
  stored in GitHub or rotated later.

  It then grants that identity exactly two permissions:

    AcrPush     on the container registry  -- to push images
    Contributor on the container app       -- to point it at a new image

  Both are scoped to individual resources rather than the resource group or
  subscription, so a compromised workflow could not reach anything else.

  Safe to re-run: existing registrations, credentials, and role assignments are
  reused rather than duplicated.

.EXAMPLE
  ./scripts/setup-github-oidc.ps1 `
    -ResourceGroup rg-d365-fsc-app `
    -GitHubRepo mc13moore/ReqAppNativeAI
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ResourceGroup,

  # owner/repo, exactly as it appears in the GitHub URL.
  [Parameter(Mandatory = $true)]
  [string]$GitHubRepo,

  [string]$Branch = 'main',

  <#
    Extra subject strings to trust, in addition to the standard
    repo:<owner>/<repo>:ref:refs/heads/<branch> form.

    Needed when the repository uses GitHub's immutable subject claims, where
    the numeric owner and repository IDs are embedded in the subject, like:

      repo:owner@216615657/repo@1336274125:ref:refs/heads/main

    Azure matches the subject literally, so a workflow presenting that form
    will be rejected unless it is registered too. If a run fails with
    AADSTS700213, copy the exact subject out of the error and pass it here.
  #>
  [string[]]$AdditionalSubjects = @(),

  [string]$DisplayName = 'ReqApp GitHub Deploy',

  [string]$SubscriptionId = ''
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/common.ps1"

function Write-Step($message) {
  Write-Host ''
  Write-Host "==> $message" -ForegroundColor Cyan
}

if ($GitHubRepo -notmatch '^[^/]+/[^/]+$') {
  throw "GitHubRepo must be in owner/repo form, for example mc13moore/ReqAppNativeAI. Got: $GitHubRepo"
}

Set-AzCaBundle
$az = Resolve-AzCli

$account = & $az account show 2>$null | ConvertFrom-Json
if (-not $account) { throw "Not signed in to Azure. Run: & '$az' login" }

if ($SubscriptionId -and $account.id -ne $SubscriptionId) {
  & $az account set --subscription $SubscriptionId
  if ($LASTEXITCODE -ne 0) { throw "Could not select subscription $SubscriptionId." }
  $account = & $az account show | ConvertFrom-Json
}

$subId = $account.id
$tenantId = $account.tenantId
Write-Host "Subscription: $($account.name) ($subId)" -ForegroundColor DarkGray

# --- Discover the resources deployed by main.bicep ---------------------------

Write-Step 'Locating the registry and container app'

$registryName = & $az acr list --resource-group $ResourceGroup --query '[0].name' --output tsv
if ($LASTEXITCODE -ne 0 -or -not $registryName) {
  # Look wider before giving up. The usual causes are a resource group name
  # that differs from the one deploy.ps1 used, or a different subscription
  # being selected now than when the deployment ran -- both of which are much
  # easier to see than to guess at.
  $elsewhere = & $az acr list --query '[].{name:name,resourceGroup:resourceGroup,location:location}' --output json | ConvertFrom-Json
  $groups = & $az group list --query '[].name' --output tsv

  $detail = if ($elsewhere) {
    "Registries visible in this subscription:`n" +
    (($elsewhere | ForEach-Object { "    $($_.name)  (resource group: $($_.resourceGroup), $($_.location))" }) -join "`n")
  } else {
    'No container registries are visible in this subscription at all.'
  }

  throw @"
No container registry found in resource group '$ResourceGroup'.

Current subscription: $($account.name) ($subId)

$detail

Resource groups in this subscription:
    $($groups -join "`n    ")

If the registry is listed above under a different resource group, re-run this
script with that -ResourceGroup. If nothing is listed, you are probably in a
different subscription than the one you deployed to -- re-run with
-SubscriptionId <the id you deployed with>.
"@
}

$registryId = & $az acr show --name $registryName --resource-group $ResourceGroup --query id --output tsv
$appName = & $az containerapp list --resource-group $ResourceGroup --query '[0].name' --output tsv
if ($LASTEXITCODE -ne 0 -or -not $appName) {
  throw "No container app found in '$ResourceGroup'. Run deploy.ps1 first."
}
$appId = & $az containerapp show --name $appName --resource-group $ResourceGroup --query id --output tsv

Write-Host "    Registry     : $registryName" -ForegroundColor DarkGray
Write-Host "    Container app: $appName" -ForegroundColor DarkGray

# --- App registration ---------------------------------------------------------

Write-Step 'Creating the app registration'

$clientId = & $az ad app list --display-name $DisplayName --query '[0].appId' --output tsv
if ($clientId) {
  Write-Host "    Reusing existing registration $clientId" -ForegroundColor DarkGray
} else {
  $clientId = & $az ad app create --display-name $DisplayName --query appId --output tsv
  if ($LASTEXITCODE -ne 0 -or -not $clientId) { throw 'Failed to create the app registration.' }
  Write-Host "    Created $clientId" -ForegroundColor DarkGray
}

# The service principal is the object role assignments actually attach to.
$principalId = & $az ad sp list --filter "appId eq '$clientId'" --query '[0].id' --output tsv
if (-not $principalId) {
  $principalId = & $az ad sp create --id $clientId --query id --output tsv
  if ($LASTEXITCODE -ne 0 -or -not $principalId) { throw 'Failed to create the service principal.' }
  # Entra ID replication lags briefly; role assignment fails without this.
  Write-Host '    Waiting for directory replication...' -ForegroundColor DarkGray
  Start-Sleep -Seconds 20
}

# --- Federated credentials ----------------------------------------------------

Write-Step "Trusting GitHub Actions from $GitHubRepo"

# One subject per trigger type. A push to the branch and a manual run present
# the same subject; a pull_request run presents a different one and is
# deliberately not trusted, so forked PRs cannot deploy.
$credentials = @(
  @{ name = "github-$Branch"; subject = "repo:${GitHubRepo}:ref:refs/heads/$Branch" }
)

# Registering extra subjects is additive and safe: each one still pins a single
# repository and branch, so trusting both the standard and immutable-ID forms
# does not widen access -- it only tolerates either claim format.
$index = 0
foreach ($extra in $AdditionalSubjects) {
  if (-not $extra) { continue }
  $index++
  $credentials += @{ name = "github-extra-$index"; subject = $extra }
}

$existing = & $az ad app federated-credential list --id $clientId --output json | ConvertFrom-Json

foreach ($cred in $credentials) {
  if ($existing | Where-Object { $_.subject -eq $cred.subject }) {
    Write-Host "    Already trusted: $($cred.subject)" -ForegroundColor DarkGray
    continue
  }

  $body = @{
    name      = $cred.name
    issuer    = 'https://token.actions.githubusercontent.com'
    subject   = $cred.subject
    audiences = @('api://AzureADTokenExchange')
  } | ConvertTo-Json -Compress

  $tmp = New-TemporaryFile
  Set-Content -Path $tmp -Value $body -Encoding ascii
  & $az ad app federated-credential create --id $clientId --parameters "@$tmp" --output none
  Remove-Item $tmp -Force
  if ($LASTEXITCODE -ne 0) { throw "Failed to add federated credential for $($cred.subject)." }
  Write-Host "    Trusted: $($cred.subject)" -ForegroundColor DarkGray
}

# --- Role assignments ---------------------------------------------------------

Write-Step 'Granting least-privilege access'

function Grant-Role($role, $scope, $label) {
  $already = & $az role assignment list --assignee $principalId --scope $scope --role $role --query '[0].id' --output tsv 2>$null
  if ($already) {
    Write-Host "    Already has $role on $label" -ForegroundColor DarkGray
    return
  }
  & $az role assignment create --assignee-object-id $principalId --assignee-principal-type ServicePrincipal `
    --role $role --scope $scope --output none
  if ($LASTEXITCODE -ne 0) { throw "Failed to grant $role on $label." }
  Write-Host "    Granted $role on $label" -ForegroundColor DarkGray
}

Grant-Role 'AcrPush' $registryId "registry $registryName"
Grant-Role 'Contributor' $appId "container app $appName"

# --- Summary ------------------------------------------------------------------

Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host ' GitHub OIDC ready -- no secrets were created' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''
Write-Host "  Add these three repository secrets at:"
Write-Host "    https://github.com/$GitHubRepo/settings/secrets/actions" -ForegroundColor Cyan
Write-Host ''
Write-Host "    AZURE_CLIENT_ID        $clientId"
Write-Host "    AZURE_TENANT_ID        $tenantId"
Write-Host "    AZURE_SUBSCRIPTION_ID  $subId"
Write-Host ''
Write-Host '  These are identifiers, not credentials -- they grant nothing on' -ForegroundColor DarkGray
Write-Host '  their own. Access is only issued to a workflow run on the' -ForegroundColor DarkGray
Write-Host "  $Branch branch of $GitHubRepo." -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Then add these repository variables (Settings > Variables):'
Write-Host "    AZURE_RESOURCE_GROUP   $ResourceGroup"
Write-Host "    AZURE_REGISTRY_NAME    $registryName"
Write-Host "    AZURE_CONTAINER_APP    $appName"
Write-Host ''
Write-Host "  Then: git push, or run the workflow manually from the Actions tab."
Write-Host ''
