# Checksum-verified user-level installer for she-companion (Windows).
# Does not elevate and does not install Node.js or Docker.
param(
  [Parameter(Mandatory=$true)][string]$Bundle,
  [Parameter(Mandatory=$true)][string]$Sha256,
  [string]$InstallRoot = "$env:LOCALAPPDATA\she\companion",
  [string]$BinDir = "$env:LOCALAPPDATA\she\bin"
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Bundle)) { throw "bundle not found: $Bundle" }
$actual = (Get-FileHash $Bundle -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $Sha256.ToLowerInvariant()) { throw "SHA-256 mismatch" }
$tmp = Join-Path $env:TEMP ("she-companion-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  tar -xzf $Bundle -C $tmp
  $bundleDir = Get-ChildItem $tmp -Directory -Filter 'she-companion-*' | Select-Object -First 1
  if (-not $bundleDir -or -not (Test-Path (Join-Path $bundleDir.FullName 'VERSION'))) { throw 'invalid companion bundle' }
  $version = (Get-Content (Join-Path $bundleDir.FullName 'VERSION') -Raw).Trim()
  $dest = Join-Path $InstallRoot "versions\$version"
  New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
  if (Test-Path $dest) { throw "companion $version already installed" }
  Move-Item $bundleDir.FullName $dest
  $current = Join-Path $InstallRoot 'current'
  if (Test-Path $current) { Remove-Item $current -Force -Recurse }
  New-Item -ItemType Junction -Path $current -Target $dest | Out-Null
  $state = @{ schema = 1; current = $version; installedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
  Set-Content -Path (Join-Path $InstallRoot 'state.json') -Value $state
  $stableLauncher = Join-Path $InstallRoot 'launcher.mjs'
  if (Test-Path (Join-Path $dest 'bin\she-launcher.mjs')) {
    Copy-Item (Join-Path $dest 'bin\she-launcher.mjs') $stableLauncher -Force
  }
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $launcher = Join-Path $BinDir 'she-companion.cmd'
  "@echo off`r`nset `"SHE_COMPANION_ROOT=$InstallRoot`"`r`nset `"SHE_BIN_DIR=$BinDir`"`r`nnode `"$stableLauncher`" %*`r`n" | Set-Content -Path $launcher -Encoding ASCII
  Write-Host "✓ installed she-companion $version"
  Write-Host "  launcher: $launcher"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
