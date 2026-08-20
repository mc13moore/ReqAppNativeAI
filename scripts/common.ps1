<#
Shared helpers for the deployment scripts.

Dot-source this file, then use `& $az ...` in place of `az ...`.
#>

<#
.SYNOPSIS
  Locates the Azure CLI and returns the command to invoke it with.

.DESCRIPTION
  Prefers a system-wide `az` if one is on PATH. Otherwise falls back to the
  project-local virtual environment at .venv, which is how the CLI is installed
  on machines where the MSI cannot run without administrator rights.
#>
function Resolve-AzCli {
  $onPath = Get-Command az -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }

  $venvAz = Join-Path $PSScriptRoot '..\.venv\Scripts\az.bat'
  if (Test-Path $venvAz) { return (Resolve-Path $venvAz).Path }

  throw @'
Azure CLI not found.

Install it machine-wide:
    winget install Microsoft.AzureCLI

or into a project-local virtual environment (no administrator rights needed):
    python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install --use-feature=truststore azure-cli
'@
}

<#
.SYNOPSIS
  Points the Azure CLI at a CA bundle that includes the local trust store.

.DESCRIPTION
  The Azure CLI validates TLS against its own bundled certificate list rather
  than the Windows certificate store. On a network that intercepts TLS, every
  request then fails with CERTIFICATE_VERIFY_FAILED. Setting REQUESTS_CA_BUNDLE
  to a bundle that also contains the intercepting root fixes this without
  disabling verification.

  Silently does nothing when no bundle is present, which is the normal case on
  an unfiltered network.
#>
function Set-AzCaBundle {
  if ($env:REQUESTS_CA_BUNDLE) { return }

  $bundle = Join-Path $PSScriptRoot '..\.venv\ca-bundle.pem'
  if (Test-Path $bundle) {
    $env:REQUESTS_CA_BUNDLE = (Resolve-Path $bundle).Path
    Write-Host "Using CA bundle: $env:REQUESTS_CA_BUNDLE" -ForegroundColor DarkGray
  }
}

<#
.SYNOPSIS
  Rebuilds the CA bundle from the Windows certificate store.

.DESCRIPTION
  Combines the public roots shipped with certifi and every root and
  intermediate certificate in the Windows trust store. Re-run this if the
  corporate certificate changes and the CLI starts failing TLS again.
#>
function Update-AzCaBundle {
  $certifi = Join-Path $PSScriptRoot '..\.venv\Lib\site-packages\certifi\cacert.pem'
  $out = Join-Path $PSScriptRoot '..\.venv\ca-bundle.pem'

  if (-not (Test-Path $certifi)) {
    throw "certifi bundle not found at $certifi. Is the .venv created?"
  }

  Copy-Item $certifi $out -Force

  $seen = @{}
  $sb = New-Object System.Text.StringBuilder
  $added = 0

  foreach ($store in @('Cert:\LocalMachine\Root', 'Cert:\CurrentUser\Root', 'Cert:\LocalMachine\CA', 'Cert:\CurrentUser\CA')) {
    try { $certs = Get-ChildItem $store -ErrorAction Stop } catch { continue }
    foreach ($cert in $certs) {
      if ($seen.ContainsKey($cert.Thumbprint)) { continue }
      $seen[$cert.Thumbprint] = $true
      $b64 = [Convert]::ToBase64String($cert.RawData, 'InsertLineBreaks')
      [void]$sb.AppendLine("# $($cert.Subject)")
      [void]$sb.AppendLine('-----BEGIN CERTIFICATE-----')
      [void]$sb.AppendLine($b64)
      [void]$sb.AppendLine('-----END CERTIFICATE-----')
      $added++
    }
  }

  Add-Content -Path $out -Value $sb.ToString() -Encoding ascii
  Write-Host "Rebuilt CA bundle with $added certificates from the Windows trust store." -ForegroundColor DarkGray
}
