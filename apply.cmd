@echo off
rem Launcher for scripts\apply.ps1.
rem The default Windows execution policy is Restricted, so the script is started
rem with -ExecutionPolicy Bypass instead of being run in-place.
rem Double-click to run, or pass options from a terminal:
rem   apply.cmd -InstallRoot "D:\Apps\DeepSeek Harness"
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\apply.ps1" %*
set "code=%errorlevel%"
if not "%code%"=="0" (
    echo.
    echo [failed] exit code %code% - see the output above.
)
if "%~1"=="" pause
exit /b %code%
