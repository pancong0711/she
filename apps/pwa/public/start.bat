@echo off
setlocal
set "PS1=%TEMP%\she-start.ps1"
echo SHE launcher: downloading start.ps1...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://pancong0711.github.io/she/start.ps1' -OutFile '%PS1%'; & '%PS1%'"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo SHE launcher exited with code %RC%.
pause
exit /b %RC%
