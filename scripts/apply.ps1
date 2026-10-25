<#
.SYNOPSIS
    Add "One Commander" to DeepSeek Harness's "open with" menu.

.DESCRIPTION
    The DeepSeek Harness desktop build compiles the open-with application catalog
    into resources\app.asar and exposes no configuration surface for extending it
    (upstream lists this as a known limitation). This script rebuilds that archive
    in place, adding one catalog entry in the host bundle and its display name in
    the browser bundle, then recomputes every member offset and SHA256.

    Safety steps before the archive is touched:
      1. DeepSeek Harness must be fully stopped (app.asar is held open);
      2. the stock archive is preserved as app.asar.dsh-pristine;
      3. the patched archive is built and fully verified in %TEMP%;
      4. the installed archive is re-verified after the copy and rolled back on
         any mismatch.

.PARAMETER InstallRoot
    DeepSeek Harness install root. Defaults to
    %LOCALAPPDATA%\Programs\DeepSeek Harness.

.EXAMPLE
    .\scripts\apply.ps1

.EXAMPLE
    .\scripts\apply.ps1 -InstallRoot 'D:\Apps\DeepSeek Harness'
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness')
)

$ErrorActionPreference = 'Stop'

$asar   = Join-Path $InstallRoot 'resources\app.asar'
$repack = Join-Path $PSScriptRoot '..\tools\repack-app-asar.mjs'
$verify = Join-Path $PSScriptRoot '..\tools\verify-asar.mjs'
$backup = "$asar.dsh-pristine"
$work   = Join-Path $env:TEMP 'dsh-onecommander'
$built  = Join-Path $work 'app.asar'

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
        throw ("DeepSeek Harness is still running: " + ($hits -join ', ') + ".`nQuit it from the window and the tray (end lingering 'DeepSeek Harness' processes in Task Manager if needed), then run this script again.")
    }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Get-PatchStatus([string]$Archive) {
    $raw = (& $node $repack --status --asar $Archive) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Could not read archive status (exit $LASTEXITCODE)`n$raw" }
    return ($raw | ConvertFrom-Json)
}

function Format-Status($Status) {
    return (($Status.files.PSObject.Properties | ForEach-Object { "$($_.Name.Split('/')[-1])=$($_.Value.state)" }) -join ', ')
}

try {
    Write-Host "Install root: $InstallRoot"
    if (-not (Test-Path -LiteralPath $asar)) { throw "No archive at $asar (pass -InstallRoot if DeepSeek Harness lives elsewhere)." }
    if (-not (Test-Path -LiteralPath $repack)) { throw "Missing $repack - keep the scripts\ and tools\ folders together." }

    $node = Get-NodeExe
    Write-Host "node: $node"

    Assert-AppStopped

    $status = Get-PatchStatus $asar
    Write-Host "Current archive: $(Format-Status $status)"

    if ($status.menuReady) {
        Write-Host 'This app.asar already carries the One Commander entry - nothing to do.' -ForegroundColor Green
        exit 0
    }

    # Patch source: always the pristine backup when one exists. Rebuilding from a
    # half-patched archive would fail (one anchor already consumed).
    if (Test-Path -LiteralPath $backup) {
        $source = $backup
        Write-Host "Patch source: $backup"
    } else {
        $source = $asar
        Write-Host "Patch source: $asar (no backup yet)"
    }

    $sourceStatus = Get-PatchStatus $source
    if (-not $sourceStatus.pristine) {
        throw "The patch source is not a stock archive ($(Format-Status $sourceStatus)). Delete it and re-run, or reinstall DeepSeek Harness."
    }

    if (-not (Test-Path -LiteralPath $backup)) {
        Copy-Item -LiteralPath $asar -Destination $backup
        Write-Host "Backed up the stock archive to $backup"
    } else {
        Write-Host "Using the existing stock backup: $backup"
    }

    # Build and verify in %TEMP% first; the install directory is untouched until
    # the rebuilt archive passes a full member-by-member verification.
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    if (Test-Path -LiteralPath $built) { Remove-Item -LiteralPath $built -Force }

    & $node $repack --out $built --asar $source | Out-Host
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $built)) { throw "Repack failed (exit $LASTEXITCODE)." }

    & $node $verify $built | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'The rebuilt archive failed verification; nothing was written.' }

    Copy-Item -LiteralPath $built -Destination $asar -Force
    if ((Get-Sha256 $built) -ne (Get-Sha256 $asar)) {
        Copy-Item -LiteralPath $backup -Destination $asar -Force
        throw 'Copy verification failed; rolled back to the stock archive.'
    }

    & $node $verify $asar | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Copy-Item -LiteralPath $backup -Destination $asar -Force
        throw 'Post-install verification failed; rolled back to the stock archive.'
    }

    # Drop the 174 MB build artifact only after everything verified.
    if (Test-Path -LiteralPath $built) { Remove-Item -LiteralPath $built -Force }

    Write-Host ''
    Write-Host 'Done: One Commander is now in the open-with menu.' -ForegroundColor Green
    Write-Host 'Start DeepSeek Harness, open the Files panel on the right, and click the open button'
    Write-Host 'next to the path bar: One Commander should sit right after File Explorer (default).'
    Write-Host ''
    Write-Host "Roll back: .\undo.cmd -InstallRoot '$InstallRoot'"
    Write-Host 'Note: desktop auto-update replaces app.asar, so re-run apply.cmd after an update.'
    exit 0
} catch {
    Write-Host ''
    Write-Host "[failed] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
