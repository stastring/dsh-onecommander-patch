@echo off
rem Show whether the installed app.asar carries the One Commander entry.
rem "menuReady": true means both the host catalog and the browser label
rem dictionary are patched. Read-only: nothing is written.
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'; $asar = Join-Path $root 'resources\app.asar'; if (-not (Test-Path $asar)) { Write-Host \"No archive at $asar\"; exit 2 }; node (Join-Path '%~dp0tools' 'repack-app-asar.mjs') --status --asar $asar"
set "code=%errorlevel%"
if not "%code%"=="0" echo.& echo [failed] exit code %code%
if "%~1"=="" pause
exit /b %code%
