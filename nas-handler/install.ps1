<#
    Registers the nhn:// links on this PC.

    No administrator rights are needed: the scheme goes under
    HKCU\Software\Classes, which is this user's own corner of the
    registry, and nothing is written outside the user profile.

    THREE WAYS TO RUN IT

    1. Double-click install.cmd from the share. It reads the root from
       nas-root.txt sitting beside it, so whoever clicks types nothing.
       This is the one to tell staff to use.

    2. Central - keep the handler on the share, point every PC at it:

           powershell -ExecutionPolicy Bypass -File install.ps1 -FromShare

       Nothing is copied. Fixing the handler later is one edit on the
       NAS instead of a visit to every machine. The trade-off is that
       anyone who can write to that folder can change a script that
       then runs on every PC, so keep it somewhere only whoever
       maintains this can write to.

    3. Local - copy the handler into the user's profile:

           powershell -ExecutionPolicy Bypass -File install.ps1 -NasRoot "\\NAS01\Projects"

       Survives the share being unreachable, but a change to the
       handler means running this again everywhere.

    Add -DryRun to any of them to print what would happen and change
    nothing. Worth doing once before running it on twelve machines.

    THE ROOT IS CONFIGURED TWICE, DELIBERATELY
    The app has its own copy (Documents -> the gear) which is what gets
    displayed and copied to the clipboard. This copy is the one the
    handler trusts, because a root arriving from a web page would be a
    root an attacker could pick. If the share is renamed, change both.
#>

param(
    # Falls back to nas-root.txt beside this script.
    [string]$NasRoot,
    # Register the handler where it already sits instead of copying it.
    [switch]$FromShare,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ---- the share root ------------------------------------------------
if (-not $NasRoot) {
    $configFile = Join-Path $PSScriptRoot 'nas-root.txt'
    if (-not (Test-Path -LiteralPath $configFile)) {
        throw "No -NasRoot given and no nas-root.txt beside this script. Create $configFile containing the share root, e.g. \\NAS01\Projects"
    }
    $NasRoot = (Get-Content -LiteralPath $configFile -Raw -Encoding UTF8).Trim()
}

$root = $NasRoot.Trim().TrimEnd('\', '/')
if ([string]::IsNullOrWhiteSpace($root)) { throw 'The share root is empty.' }
if ($root -match '^[A-Za-z]:') {
    throw "Use the network path (\\NAS01\Projects), not a mapped drive letter. Drive letters differ from machine to machine, and this setting is shared across all of them."
}
if (-not (Test-Path -LiteralPath $root)) {
    Write-Warning "$root is not reachable from this PC right now. Carrying on - it may just be off the network at the moment."
}

# ---- where the handler will live -----------------------------------
if ($FromShare) {
    $target = $PSScriptRoot
    $handler = Join-Path $target 'open-nas-path.ps1'
    if (-not (Test-Path -LiteralPath $handler)) {
        throw 'open-nas-path.ps1 is not beside this script, so there is nothing to point at.'
    }
} else {
    $target = Join-Path $env:LOCALAPPDATA 'NHN PM'
    $handler = Join-Path $target 'open-nas-path.ps1'
}

$powershell = Join-Path $PSHOME 'powershell.exe'
$command = "`"$powershell`" -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$handler`" -Url `"%1`""
$base = 'HKCU:\Software\Classes\nhn'
$mode = if ($FromShare) { 'central (runs from the share)' } else { 'local copy' }

if ($DryRun) {
    Write-Host ''
    Write-Host 'DRY RUN - nothing was changed.' -ForegroundColor Yellow
    Write-Host "  Mode       : $mode"
    Write-Host "  Share root : $root"
    Write-Host "  Handler    : $handler"
    if (-not $FromShare) {
        Write-Host "  Would copy : open-nas-path.ps1 into $target"
    }
    Write-Host "  Root file  : $(Join-Path $target 'nas-root.txt')"
    Write-Host "  Registry   : $base\shell\open\command"
    Write-Host "  Command    : $command"
    Write-Host ''
    return
}

# ---- install -------------------------------------------------------
if (-not $FromShare) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'open-nas-path.ps1') -Destination $target -Force
}

# The handler reads the root from beside itself. In central mode that
# is the file on the share, so there is one copy rather than one per
# machine.
Set-Content -LiteralPath (Join-Path $target 'nas-root.txt') -Value $root -Encoding utf8

New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name '(Default)' -Value 'URL:NHN Project System'
Set-ItemProperty -Path $base -Name 'URL Protocol' -Value ''

New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$base\shell\open\command" -Name '(Default)' -Value $command

Write-Host ''
Write-Host 'Installed.' -ForegroundColor Green
Write-Host "  Mode       : $mode"
Write-Host "  Share root : $root"
Write-Host "  Handler    : $handler"
Write-Host ''
Write-Host 'Open a project, go to Documents, and click Browse to test.'
Write-Host 'The browser asks once whether to allow the link to open the app -'
Write-Host 'tick "always allow" so it stops asking.'
