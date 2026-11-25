# User-level SHE bootstrap for Windows. Never elevates or installs Docker.
param(
  [ValidateSet('check','install-pnpm','install-deps')]
  [string]$Mode = 'check'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$PackageJson = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$PnpmSpec = [string]$PackageJson.packageManager
if (-not $PnpmSpec.StartsWith('pnpm@')) { $PnpmSpec = 'pnpm@11.22.0' }
$PnpmVersion = $PnpmSpec.Substring(5)
$UserPrefix = Join-Path $env:LOCALAPPDATA 'she\tooling'
$UserBin = Join-Path $UserPrefix 'node_modules\.bin'
$env:PATH = "$UserBin;$env:PATH"

function Ok($message) { Write-Host "✓ $message" }
function Warn($message) { Write-Host "! $message" }
function Bad($message) { Write-Host "✗ $message" }

$node = Get-Command node -ErrorAction SilentlyContinue
$nodeOk = $false
if ($node) {
  $nodeVersion = (& node --version).Trim()
  $parsed = & node -e "const v=process.versions.node.split('.').map(Number); process.exit((v[0]>=24 || (v[0]===22 && v[1]>=19))?0:1)"
  if ($LASTEXITCODE -eq 0) { $nodeOk = $true; Ok "Node.js $nodeVersion" } else { Bad "Node.js $nodeVersion is too old" }
} else {
  Bad "Node.js not found"
}

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
$pnpmOk = $false
if ($pnpm) {
  $found = (& pnpm --version).Trim()
  if ($found -eq $PnpmVersion) { $pnpmOk = $true; Ok "pnpm $found" } else { Warn "pnpm $found found; expected $PnpmVersion" }
} else {
  Bad "pnpm not found"
}

if (Get-Command git -ErrorAction SilentlyContinue) { Ok ((git --version).Trim()) } else { Warn "git not found; clone/update requires manual setup" }
if (Get-Command docker -ErrorAction SilentlyContinue) {
  try {
    $security = docker info --format '{{json .SecurityOptions}}' 2>$null
    if ($security -match 'rootless') { Ok "rootless Docker runtime detected" } else { Warn "Docker accessible but rootless not detected; may be root-equivalent" }
  } catch { Warn "Docker command failed" }
} else {
  Warn "Docker not found; install Docker Desktop/WSL2 yourself if sandbox features are needed"
}

if (-not $nodeOk) {
  Write-Host "Node.js must be installed by the user; SHE does not request admin rights."
  exit 1
}

if ($Mode -eq 'install-pnpm' -and -not $pnpmOk) {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $npm) { Bad "npm unavailable; cannot install pnpm"; exit 1 }
  New-Item -ItemType Directory -Force -Path $UserPrefix | Out-Null
  Write-Host "Installing $PnpmSpec into user prefix..."
  & npm install --prefix $UserPrefix $PnpmSpec
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Ok "pnpm installed into $UserBin"
  Write-Host "Ensure $UserBin is on PATH."
}

if ($Mode -eq 'install-deps') {
  if (-not $pnpmOk) { Bad "pnpm is not ready; run install-pnpm first"; exit 1 }
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Ok "dependencies installed"
}

if ($Mode -eq 'check') {
  Write-Host "Check complete."
}
