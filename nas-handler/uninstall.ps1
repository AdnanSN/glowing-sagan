<#
    Removes the nhn:// registration and the copied handler.

        powershell -ExecutionPolicy Bypass -File uninstall.ps1

    Nothing in the PM system breaks: the Documents page keeps rendering
    the paths and the "copy path" button, which never needed any of
    this. Only the one-click open buttons stop working.
#>

$ErrorActionPreference = 'Stop'

$base = 'HKCU:\Software\Classes\nhn'
if (Test-Path -LiteralPath $base) {
    Remove-Item -LiteralPath $base -Recurse -Force
    Write-Host 'Removed the nhn:// registration.'
} else {
    Write-Host 'No nhn:// registration found.'
}

$target = Join-Path $env:LOCALAPPDATA 'NHN PM'
if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
    Write-Host "Removed $target."
}

Write-Host 'Done. Copy path still works everywhere.'
