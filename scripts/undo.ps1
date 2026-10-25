<#
.SYNOPSIS
    Restore the stock app.asar of DeepSeek Harness.

.DESCRIPTION
    Overwrites resources\app.asar with app.asar.dsh-pristine (written by
    apply.ps1) and verifies the result. DeepSeek Harness must be stopped first.

.PARAMETER InstallRoot
    DeepSeek Harness install root. Defaults to
    %LOCALAPPDATA%\Programs\DeepSeek Harness.

.PARAMETER RemoveBackup
    Delete the pristine backup after a successful restore.

.EXAMPLE
    .\scripts\undo.ps1
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
    [switch]$RemoveBackup
)

$ErrorActionPreference = 'Stop'

$asar   = Join-Path $InstallRoot 'resources\app.asar'
$backup = "$asar.dsh-pristine"
$verify = Join-Path $PSScriptRoot '..\tools\verify-asar.mjs'

function Get-NodeExe {
    $bundled = Join-Path $InstallRoot 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    if (Test-Path -LiteralPath $bundled) { return $bundled }
    throw 'node.exe not found on PATH and not bundled with DeepSeek Harness.'
}

function Assert-AppStopped {
    $hits = @()
    foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
        $exePath = $null
        try { $exePath = $p.Path } catch { $exePath = $null }
        if ($exePath -and $exePath.StartsWith($InstallRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            $hits += "$($p.ProcessName) (PID $($p.Id))"
        }
    }
    if ($hits.Count -gt 0) {
        throw ("DeepSeek Harness is still running: " + ($hits -join ', ') + ".`nQuit it from the window and the tray, then run this script again.")
    }
}

try {
    if (-not (Test-Path -LiteralPath $backup)) { throw "No backup at $backup - nothing to restore. Reinstall DeepSeek Harness instead." }
    Assert-AppStopped

    Copy-Item -LiteralPath $backup -Destination $asar -Force
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash) {
        throw 'Restore verification failed; copy the backup over app.asar manually.'
    }

    $node = Get-NodeExe
    & $node $verify $asar | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'The restored archive failed verification; copy the backup over app.asar manually.' }

    Write-Host 'Restored the stock app.asar (One Commander entry removed).' -ForegroundColor Green
    if ($RemoveBackup) {
        Remove-Item -LiteralPath $backup -Force
        Write-Host "Deleted $backup"
    }
    exit 0
} catch {
    Write-Host ''
    Write-Host "[failed] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
