@echo off
rem Launcher for scripts\undo.ps1: restores the stock app.asar from the
rem app.asar.dsh-pristine backup written by apply.cmd.
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\undo.ps1" %*
set "code=%errorlevel%"
if not "%code%"=="0" (
    echo.
    echo [failed] exit code %code% - see the output above.
)
if "%~1"=="" pause
exit /b %code%
