@echo off
setlocal
set "ROOT=%~dp0"
node "%ROOT%run-core.mjs" %*
