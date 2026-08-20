<#
.SYNOPSIS
  Creates the Entra ID app registration that fronts the app with user sign-in.

.DESCRIPTION
  Container Apps built-in authentication needs its own app registration --
  separate from the managed identity that talks to D365. This script creates
  it, adds the redirect URI that EasyAuth expects, and mints a client secret.

  Run this after the first deploy, because the redirect URI contains the app's
  generated hostname. Then redeploy with the returned values.

.EXAMPLE
  ./scripts/setup-auth.ps1 -ResourceGroup rg-requisitions -AppName reqapp-app
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ResourceGroup,

  [Parameter(Mandatory = $true)]
  [string]$AppName,

  [string]$DisplayName = 'Purchase Requisition App',

  [int]$SecretYears = 2
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw 'Azure CLI is not installed. Install it with: winget install Microsoft.AzureCLI'
}

Write-Host '==> Reading the container app hostname' -ForegroundColor Cyan
$fqdn = az containerapp show --name $AppName --resource-group $ResourceGroup `
  --query 'properties.configuration.ingress.fqdn' --output tsv
if ($LASTEXITCODE -ne 0 -or -not $fqdn) {
  throw "Could not find container app '$AppName' in resource group '$ResourceGroup'. Deploy first."
}

$redirectUri = "https://$fqdn/.auth/login/aad/callback"
Write-Host "    Redirect URI: $redirectUri" -ForegroundColor DarkGray

# Reuse an existing registration if one is already there, so re-running does
# not litter the tenant with duplicates.
Write-Host '==> Looking for an existing registration' -ForegroundColor Cyan
$existing = az ad app list --display-name $DisplayName --query "[0]" --output json | ConvertFrom-Json

if ($existing) {
  $appId = $existing.appId
  Write-Host "    Reusing registration $appId" -ForegroundColor DarkGray
  az ad app update --id $appId --web-redirect-uris $redirectUri --output none
} else {
  Write-Host '==> Creating the app registration' -ForegroundColor Cyan
  $created = az ad app create `
    --display-name $DisplayName `
    --sign-in-audience AzureADMyOrg `
    --web-redirect-uris $redirectUri `
    --enable-id-token-issuance true `
    --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create the app registration.' }
  $appId = $created.appId
}

# EasyAuth validates the token audience against api://<clientId>.
Write-Host '==> Setting the application ID URI' -ForegroundColor Cyan
az ad app update --id $appId --identifier-uris "api://$appId" --output none

Write-Host '==> Creating a client secret' -ForegroundColor Cyan
$secret = az ad app credential reset --id $appId --years $SecretYears --query password --output tsv
if ($LASTEXITCODE -ne 0 -or -not $secret) { throw 'Failed to create a client secret.' }

Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host ' App registration ready' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''
Write-Host "  Client ID : $appId"
Write-Host "  Secret    : $secret"
Write-Host ''
Write-Host '  This secret is shown once. Redeploy with it now:' -ForegroundColor Yellow
Write-Host ''
Write-Host "    ./scripts/deploy.ps1 -ResourceGroup $ResourceGroup ``"
Write-Host "        -AuthClientId $appId ``"
Write-Host "        -AuthClientSecret '$secret'"
Write-Host ''
Write-Host '  By default anyone in your tenant can sign in. To restrict further,' -ForegroundColor DarkGray
Write-Host '  set the enterprise application to require user assignment in the' -ForegroundColor DarkGray
Write-Host '  Entra portal, then assign only your testers.' -ForegroundColor DarkGray
Write-Host ''
