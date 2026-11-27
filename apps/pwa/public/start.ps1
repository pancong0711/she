# Stable SHE launcher entrypoint for Windows.
# If the app is already installed, this script starts the local launcher
# immediately (which checks for updates). Network bootstrap is only used for a
# first install or an explicit launcher refresh.
$ErrorActionPreference = 'Stop'

$Tag = $env:SHE_COMPANION_RELEASE_TAG
$Base = if ($env:SHE_COMPANION_RELEASE_BASE) {
  $env:SHE_COMPANION_RELEASE_BASE
} elseif ($Tag) {
  "https://github.com/pancong0711/she/releases/download/$Tag"
} else {
  ''
}
$SheHome = if ($env:SHE_HOME) { $env:SHE_HOME } else { Join-Path $env:LOCALAPPDATA 'SHE' }
$InstallRoot = if ($env:SHE_COMPANION_ROOT) {
  $env:SHE_COMPANION_ROOT
} elseif (Test-Path (Join-Path $SheHome 'app\launcher.mjs')) {
  Join-Path $SheHome 'app'
} elseif (Test-Path (Join-Path $SheHome 'companion\launcher.mjs')) {
  Join-Path $SheHome 'companion'
} else {
  Join-Path $SheHome 'app'
}
$BinDir = if ($env:SHE_BIN_DIR) {
  $env:SHE_BIN_DIR
} elseif (Test-Path (Join-Path $SheHome 'bin')) {
  Join-Path $SheHome 'bin'
} else {
  Join-Path $env:LOCALAPPDATA 'she\bin'
}
$CoreRoot = if ($env:SHE_CORE_ROOT) { $env:SHE_CORE_ROOT } else { Join-Path $SheHome 'core' }
$LegacyConfigRoot = Join-Path $env:USERPROFILE '.config\she'
$LegacyStateRoot = Join-Path $env:USERPROFILE '.local\state\she'
$ConfigRoot = if ($env:SHE_CONFIG_HOME) { $env:SHE_CONFIG_HOME } elseif (Test-Path (Join-Path $SheHome 'config')) { Join-Path $SheHome 'config' } elseif (Test-Path $LegacyConfigRoot) { $LegacyConfigRoot } else { Join-Path $SheHome 'config' }
$StateRoot = if ($env:SHE_STATE_HOME) { $env:SHE_STATE_HOME } elseif (Test-Path (Join-Path $SheHome 'state')) { Join-Path $SheHome 'state' } elseif (Test-Path $LegacyStateRoot) { $LegacyStateRoot } else { Join-Path $SheHome 'state' }
$RuntimeRoot = if ($env:SHE_RUNTIME_DIR) { $env:SHE_RUNTIME_DIR } elseif ($env:XDG_RUNTIME_DIR) { Join-Path $env:XDG_RUNTIME_DIR 'she' } else { Join-Path $SheHome 'run' }
$WorkspaceRoot = if ($env:SHE_WORKSPACE_ROOT) { $env:SHE_WORKSPACE_ROOT } else { Join-Path $SheHome 'workspaces' }
$Port = if ($env:SHE_PWA_PORT) { [int]$env:SHE_PWA_PORT } else { 8787 }
$env:SHE_HOME = $SheHome
$env:SHE_COMPANION_ROOT = $InstallRoot
$env:SHE_BIN_DIR = $BinDir
$env:SHE_CORE_ROOT = $CoreRoot
$env:SHE_CONFIG_HOME = $ConfigRoot
$env:SHE_STATE_HOME = $StateRoot
$env:SHE_RUNTIME_DIR = $RuntimeRoot
$env:SHE_WORKSPACE_ROOT = $WorkspaceRoot
$ManifestUrl = if ($env:SHE_COMPANION_MANIFEST_URL) {
  $env:SHE_COMPANION_MANIFEST_URL
} elseif ($env:SHE_COMPANION_RELEASE_BASE -or $Tag) {
  "$Base/companion-release-manifest.json"
} else {
  'https://pancong0711.github.io/she/companion-release-manifest.json'
}

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "✗ SHE companion does not need administrator rights. Re-run from a normal user terminal." -ForegroundColor Red
    exit 1
  }
} catch {}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host "✗ Node.js 22.19+ / 24+ is required. Install it yourself; SHE does not request admin rights." -ForegroundColor Red; exit 1 }
& node -e "const v=process.versions.node.split('.').map(Number); process.exit(v[0]>=24 || (v[0]===22 && v[1]>=19) ? 0 : 1)"
if ($LASTEXITCODE -ne 0) { Write-Host "✗ Node.js must be ^22.19.0 || >=24.0.0" -ForegroundColor Red; exit 1 }
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { Write-Host "✗ tar.exe is required" -ForegroundColor Red; exit 1 }

New-Item -ItemType Directory -Force -Path $InstallRoot, $BinDir | Out-Null

# Local-first: after the first install, this is the normal app entrypoint.
$localLauncher = Join-Path $InstallRoot 'launcher.mjs'
if ($env:SHE_FORCE_LAUNCHER_REFRESH -ne '1' -and (Test-Path $localLauncher)) {
  Write-Host 'SHE bootstrap: using installed launcher'
  $env:SHE_HOME = $SheHome
  $env:SHE_PWA_PORT = [string]$Port
  $env:SHE_COMPANION_ROOT = $InstallRoot
  $env:SHE_BIN_DIR = $BinDir
  $env:SHE_CORE_ROOT = $CoreRoot
  $env:SHE_CONFIG_HOME = $ConfigRoot
  $env:SHE_STATE_HOME = $StateRoot
  $env:SHE_RUNTIME_DIR = $RuntimeRoot
  $env:SHE_WORKSPACE_ROOT = $WorkspaceRoot
  $env:SHE_COMPANION_MANIFEST_URL = $ManifestUrl
  $env:SHE_LAUNCHER_UPDATE_ON_START = '1'
  & node $localLauncher
  exit $LASTEXITCODE
}

$work = Join-Path $env:TEMP ("she-launcher-bootstrap-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Launch-LocalLauncher {
  $localLauncher = Join-Path $InstallRoot 'launcher.mjs'
  if (-not (Test-Path $localLauncher)) { return $false }
  Write-Host 'SHE bootstrap: using installed launcher'
  $env:SHE_HOME = $SheHome
  $env:SHE_PWA_PORT = [string]$Port
  $env:SHE_COMPANION_ROOT = $InstallRoot
  $env:SHE_BIN_DIR = $BinDir
  $env:SHE_CORE_ROOT = $CoreRoot
  $env:SHE_CONFIG_HOME = $ConfigRoot
  $env:SHE_STATE_HOME = $StateRoot
  $env:SHE_RUNTIME_DIR = $RuntimeRoot
  $env:SHE_WORKSPACE_ROOT = $WorkspaceRoot
  $env:SHE_COMPANION_MANIFEST_URL = $ManifestUrl
  $env:SHE_LAUNCHER_UPDATE_ON_START = '1'
  & node $localLauncher
  exit $LASTEXITCODE
}

function Download-File([string]$Uri, [string]$OutFile) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
    return $true
  } catch {
    Write-Host "SHE bootstrap: Invoke-WebRequest failed for $Uri; retrying with curl.exe" -ForegroundColor Yellow
  }
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { return $false }
  & $curl.Source -fL --http1.1 --retry 3 --retry-delay 1 --connect-timeout 20 --max-time 45 -o $OutFile $Uri
  return $LASTEXITCODE -eq 0
}

function Download-Launcher([string]$Uri) {
  Write-Host "SHE bootstrap: downloading launcher $launcherFile from $Uri"
  if (-not (Download-File $Uri $launcherPath)) { return $false }
  $actualSha = (Get-FileHash $launcherPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha -ne $expectedSha.ToLowerInvariant()) {
    Write-Host "✗ launcher SHA-256 mismatch: expected $expectedSha got $actualSha" -ForegroundColor Red
    return $false
  }
  & node --check $launcherPath
  return $LASTEXITCODE -eq 0
}

try {
  Write-Host 'SHE bootstrap: fetching launcher manifest...'
  $manifestPath = Join-Path $work 'companion-release-manifest.json'
  if (-not (Download-File $ManifestUrl $manifestPath)) {
    if (Launch-LocalLauncher) { exit 0 }
    throw 'cannot download launcher manifest and no local launcher exists'
  }
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $launcherFile = [string]$manifest.launcher.file
  $expectedSha = [string]$manifest.launcher.sha256
  $launcherUrl = [string]$manifest.launcher.url
  $launcherFallbackUrl = [string]$manifest.launcher.fallbackUrl
  if (-not $launcherFile -or -not $expectedSha) {
    if (Launch-LocalLauncher) { exit 0 }
    throw 'release manifest has no launcher artifact; run the latest start.ps1 once'
  }
  if ($launcherFile -match '[\\/]' -or $launcherFile -match '\.\.') { throw 'invalid launcher file name' }
  if (-not $launcherUrl) {
    if (-not $Base) { throw 'release manifest has no launcher URL and no release base was provided' }
    $launcherUrl = "$Base/$launcherFile"
  }
  if ($launcherUrl -notmatch '^https://') { throw 'launcher URL must use https://' }

  $launcherPath = Join-Path $work $launcherFile
  if (-not (Download-Launcher $launcherUrl)) {
    $fallbackUri = if ($launcherFallbackUrl) {
      $launcherFallbackUrl
    } else {
      [System.Uri]::new([System.Uri]$ManifestUrl, $launcherFile).AbsoluteUri
    }
    if ($fallbackUri -ne $launcherUrl) {
      Write-Host 'SHE bootstrap: primary launcher download failed; trying channel mirror'
      if (-not (Download-Launcher $fallbackUri)) {
        if (Launch-LocalLauncher) { exit 0 }
        throw 'cannot download a verified launcher and no local launcher exists'
      }
    } else {
      if (Launch-LocalLauncher) { exit 0 }
      throw 'cannot download a verified launcher and no local launcher exists'
    }
  }
  $target = Join-Path $InstallRoot 'launcher.mjs'
  $next = "$target.next"
  Copy-Item $launcherPath $next -Force
  Move-Item $next $target -Force

  $env:SHE_HOME = $SheHome
  $env:SHE_PWA_PORT = [string]$Port
  $env:SHE_COMPANION_ROOT = $InstallRoot
  $env:SHE_BIN_DIR = $BinDir
  $env:SHE_CORE_ROOT = $CoreRoot
  $env:SHE_CONFIG_HOME = $ConfigRoot
  $env:SHE_STATE_HOME = $StateRoot
  $env:SHE_RUNTIME_DIR = $RuntimeRoot
  $env:SHE_WORKSPACE_ROOT = $WorkspaceRoot
  $env:SHE_COMPANION_MANIFEST_URL = $ManifestUrl
  $env:SHE_LAUNCHER_UPDATE_ON_START = '1'
  & node $target
  exit $LASTEXITCODE
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
