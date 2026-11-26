# SHE companion one-click launcher for Windows.
# Downloads a checksum-verified companion bundle into the current user's data dir,
# starts the local companion, and opens the PWA. Never elevates or requests admin.
$ErrorActionPreference = 'Stop'

$Tag = if ($env:SHE_COMPANION_RELEASE_TAG) { $env:SHE_COMPANION_RELEASE_TAG } else { 'v0.3.8-companion.1' }
$Base = if ($env:SHE_COMPANION_RELEASE_BASE) { $env:SHE_COMPANION_RELEASE_BASE } else { "https://github.com/pancong0711/she/releases/download/$Tag" }
$InstallRoot = if ($env:SHE_COMPANION_ROOT) { $env:SHE_COMPANION_ROOT } else { Join-Path $env:LOCALAPPDATA 'she\companion' }
$BinDir = if ($env:SHE_BIN_DIR) { $env:SHE_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'she\bin' }
$Port = if ($env:SHE_PWA_PORT) { [int]$env:SHE_PWA_PORT } else { 8787 }

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "✗ SHE companion does not need administrator rights. Re-run from a normal user terminal." -ForegroundColor Red
    exit 1
  }
} catch {}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "✗ Node.js 22.19+ / 24+ is required. Install it yourself; SHE does not request admin rights." -ForegroundColor Red
  exit 1
}
& node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>=24 || (v[0]===22 && v[1]>=19) ? 0 : 1)"
if ($LASTEXITCODE -ne 0) { Write-Host "✗ Node.js must be ^22.19.0 || >=24.0.0" -ForegroundColor Red; exit 1 }
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { Write-Host "✗ tar.exe is required" -ForegroundColor Red; exit 1 }

New-Item -ItemType Directory -Force -Path $InstallRoot, $BinDir | Out-Null
$work = Join-Path $env:TEMP ("she-start-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
  Write-Host "SHE launcher: fetching release manifest..."
  $manifestPath = Join-Path $work 'companion-release-manifest.json'
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/companion-release-manifest.json" -OutFile $manifestPath
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schema -ne 1 -or -not $manifest.version -or -not $manifest.bundle) { throw 'invalid companion manifest' }
  $version = [string]$manifest.version
  $bundleFile = [string]$manifest.bundle.file
  $expectedSha = [string]$manifest.bundle.sha256
  Write-Host "SHE launcher: companion $version"

  $current = Join-Path $InstallRoot 'current'
  $currentVersion = ''
  if (Test-Path (Join-Path $current 'VERSION')) { $currentVersion = (Get-Content (Join-Path $current 'VERSION') -Raw).Trim() }
  if ($currentVersion -ne $version) {
    $bundlePath = Join-Path $work $bundleFile
    Write-Host "SHE launcher: downloading $bundleFile"
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$bundleFile" -OutFile $bundlePath
    $actualSha = (Get-FileHash $bundlePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -ne $expectedSha.ToLowerInvariant()) { throw "SHA-256 mismatch: expected $expectedSha got $actualSha" }
    tar -xzf $bundlePath -C $work
    $bundleDir = Get-ChildItem $work -Directory -Filter 'she-companion-*' | Select-Object -First 1
    if (-not $bundleDir) { throw 'invalid companion bundle' }
    $versions = Join-Path $InstallRoot 'versions'
    New-Item -ItemType Directory -Force -Path $versions | Out-Null
    $dest = Join-Path $versions $version
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Move-Item $bundleDir.FullName $dest
    if (Test-Path $current) { cmd /c rmdir "$current" }
    New-Item -ItemType Junction -Path $current -Target $dest | Out-Null
    $launcher = Join-Path $BinDir 'she-companion.cmd'
    "@echo off`r`nset SHE_COMPANION_ROOT=$InstallRoot`r`nset SHE_BIN_DIR=$BinDir`r`nnode `"$current\apps\companion\supervisor.mjs`" %*`r`n" | Set-Content -Path $launcher -Encoding ASCII
    Write-Host "SHE launcher: installed companion $version"
  }
  $existingVersion = $null
  try {
    $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/version" -TimeoutSec 2
    $existingVersion = [string]$existing.value.companion
  } catch {}
  if ($existingVersion) {
    if ($existingVersion -eq $version) {
      Write-Host "SHE launcher: companion $version is already running; opening the PWA."
      Start-Process "http://127.0.0.1:$Port"
      exit 0
    }
    Write-Host "✗ 检测到旧 companion 正在运行：$existingVersion" -ForegroundColor Red
    Write-Host "  已安装新版本：$version" -ForegroundColor Yellow
    Write-Host "  请先停止旧 companion 进程，然后重新运行 start.bat / start.ps1。" -ForegroundColor Yellow
    exit 1
  }
  Write-Host "SHE launcher: starting http://127.0.0.1:$Port"
  Start-Process "http://127.0.0.1:$Port"
  $env:SHE_PWA_PORT = [string]$Port
  $env:SHE_COMPANION_ROOT = $InstallRoot
  $env:SHE_BIN_DIR = $BinDir
  & node (Join-Path $current 'apps\companion\supervisor.mjs')
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
