@echo off
setlocal
if defined SHE_COMPANION_ROOT (
  set "INSTALL_ROOT=%SHE_COMPANION_ROOT%"
) else (
  set "INSTALL_ROOT=%LOCALAPPDATA%\she\companion"
)

REM After the first install, run the local launcher directly. The launcher
REM owns environment checks, remote version checks, updates and supervision.
if /I not "%SHE_FORCE_LAUNCHER_REFRESH%"=="1" if exist "%INSTALL_ROOT%\launcher.mjs" (
  set "SHE_COMPANION_ROOT=%INSTALL_ROOT%"
  if not defined SHE_BIN_DIR set "SHE_BIN_DIR=%LOCALAPPDATA%\she\bin"
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
