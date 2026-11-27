@echo off
setlocal
if defined SHE_HOME (
  set "SHE_HOME=%SHE_HOME%"
) else (
  set "SHE_HOME=%LOCALAPPDATA%\SHE"
)
if defined SHE_COMPANION_ROOT (
  set "INSTALL_ROOT=%SHE_COMPANION_ROOT%"
) else if exist "%SHE_HOME%\app\launcher.mjs" (
  set "INSTALL_ROOT=%SHE_HOME%\app"
) else if exist "%SHE_HOME%\companion\launcher.mjs" (
  set "INSTALL_ROOT=%SHE_HOME%\companion"
) else (
  set "INSTALL_ROOT=%SHE_HOME%\app"
)
if defined SHE_BIN_DIR (
  set "BIN_DIR=%SHE_BIN_DIR%"
) else if exist "%SHE_HOME%\bin" (
  set "BIN_DIR=%SHE_HOME%\bin"
) else (
  set "BIN_DIR=%LOCALAPPDATA%\she\bin"
)
if not defined SHE_CORE_ROOT set "SHE_CORE_ROOT=%SHE_HOME%\core"
if not defined SHE_CONFIG_HOME set "SHE_CONFIG_HOME=%SHE_HOME%\config"
if not defined SHE_STATE_HOME set "SHE_STATE_HOME=%SHE_HOME%\state"
if not defined SHE_RUNTIME_DIR set "SHE_RUNTIME_DIR=%SHE_HOME%\run"
if not defined SHE_WORKSPACE_ROOT set "SHE_WORKSPACE_ROOT=%SHE_HOME%\workspaces"

REM After the first install, run the local launcher directly. The launcher
REM owns environment checks, remote version checks, updates and supervision.
if /I not "%SHE_FORCE_LAUNCHER_REFRESH%"=="1" if exist "%INSTALL_ROOT%\launcher.mjs" (
  set "SHE_COMPANION_ROOT=%INSTALL_ROOT%"
  set "SHE_BIN_DIR=%BIN_DIR%"
  set "SHE_LAUNCHER_UPDATE_ON_START=1"
  node "%INSTALL_ROOT%\launcher.mjs"
  set "RC=%ERRORLEVEL%"
  echo.
  if not "%RC%"=="0" echo SHE launcher exited with code %RC%.
  pause
  exit /b %RC%
)

set "PS1=%TEMP%\she-start.ps1"
echo SHE launcher: no local app found; downloading start.ps1...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://pancong0711.github.io/she/start.ps1' -OutFile '%PS1%'; & '%PS1%'"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo SHE launcher exited with code %RC%.
pause
exit /b %RC%
