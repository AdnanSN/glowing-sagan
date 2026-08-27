<#
    Registers the nhn:// links on this PC.

    Run once per office machine. No administrator rights needed: the
    scheme goes under HKCU\Software\Classes, which is this user's own
    corner of the registry, and the handler is copied into LOCALAPPDATA.

        powershell -ExecutionPolicy Bypass -File install.ps1 -NasRoot "\\NAS01\Projects"

    The root must match the one set in the app (Documents -> the gear
    beside "Add Document"). They are two copies on purpose - the app's
    copy is what gets displayed and copied to the clipboard, and this
    copy is what the handler trusts, because a root arriving from a web
    page would be a root an attacker could pick. If the share is ever
    renamed, both need changing.
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$NasRoot
)

$ErrorActionPreference = 'Stop'

$root = $NasRoot.Trim().TrimEnd('\', '/')
if ([string]::IsNullOrWhiteSpace($root)) { throw 'NasRoot cannot be empty.' }
if ($root -match '^[A-Za-z]:') {
    throw "Use the network path (\\NAS01\Projects), not a mapped drive letter. Drive letters differ from machine to machine, and this file is shared across all of them."
}
if (-not (Test-Path -LiteralPath $root)) {
    Write-Warning "$root is not reachable from this PC right now. Carrying on - it may just be off the network at the moment."
}

$target = Join-Path $env:LOCALAPPDATA 'NHN PM'
New-Item -ItemType Directory -Path $target -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'open-nas-path.ps1') -Destination $target -Force
Set-Content -LiteralPath (Join-Path $target 'nas-root.txt') -Value $root -Encoding utf8

$handler = Join-Path $target 'open-nas-path.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'
$command = "`"$powershell`" -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$handler`" -Url `"%1`""

$base = 'HKCU:\Software\Classes\nhn'
New-Item -Path $base -Force | Out-Null
Set-ItemProperty -Path $base -Name '(Default)' -Value 'URL:NHN Project System'
Set-ItemProperty -Path $base -Name 'URL Protocol' -Value ''

New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$base\shell\open\command" -Name '(Default)' -Value $command

Write-Host ''
Write-Host 'Installed.' -ForegroundColor Green
Write-Host "  Share root : $root"
Write-Host "  Handler    : $handler"
Write-Host ''
Write-Host 'Open the Documents page and click the drive icon on any document to test.'
Write-Host 'The browser will ask once whether to allow the link to open the app - tick'
Write-Host '"always allow" so it stops asking.'
