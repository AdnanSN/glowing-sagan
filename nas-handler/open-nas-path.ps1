<#
    Opens a file on the office NAS from a link in the PM system, and
    picks one for it.

    Registered against the nhn:// URL scheme by install.ps1. The system
    renders links like

        nhn:///open?path=RIY-2024-017%2FDrawings%2FA-101.pdf
        nhn:///folder?path=RIY-2024-017%2FDrawings%2FA-101.pdf
        nhn:///pick
        nhn:///pick?path=RIY-2024-017

    and Windows hands the whole URL to this script.

    WHY PICKING HAPPENS HERE AND NOT IN THE BROWSER
      A web page cannot learn a file's path. A file input hands back
      the bytes and the name, and reports the path as the literal
      string "C:\fakepath\...", because letting sites read your folder
      layout was judged a bad idea long ago. That is not a setting.
      This script is a normal Windows program with no such limit, so
      the file dialog lives here and the path travels back through the
      clipboard.

    THE SHARE ROOT IS NOT IN THE LINK, AND MUST NOT BE
      The root is read from nas-root.txt sitting beside this script -
      local, trusted, set once at install. A root that arrived in the
      URL would be a root that whoever wrote the link gets to choose,
      which is the whole attack. Everything from the URL is treated as
      hostile until it has been proved to land inside the root.

    WHAT IS CHECKED, IN ORDER
      1. The scheme really is nhn, and the action is one of three words.
      2. The relative path has no "..", no leading separator, no drive
         letter. (The database refuses to store one too - see the
         constraint in migration_v12_nas_links.sql - but this script
         cannot assume it is talking to that database.)
      3. After joining and canonicalising, the result STILL starts with
         the share root. This is the check that actually holds: it
         catches anything the textual rules missed. A file chosen in
         the dialog goes through the same gate, because the dialog can
         browse anywhere the person can.
      4. The extension is on the allowlist before anything is launched.
         Anything else gets revealed in Explorer instead of opened, so
         a .exe on the share can never be started by a link.
#>

param([string]$Url)

$ErrorActionPreference = 'Stop'

function Show-Problem($message) {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    [System.Windows.Forms.MessageBox]::Show(
        $message, 'NHN Project System',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
    exit 1
}

# Wrapped in a function so the test harness can stand in for the dialog.
# Returns the chosen full path, or $null if the person cancelled.
function Get-PickedFile($startDir) {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Choose a file on the NAS'
    $dialog.Filter = 'All files (*.*)|*.*'
    $dialog.Multiselect = $false
    $dialog.CheckFileExists = $true
    if ($startDir) { $dialog.InitialDirectory = $startDir }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        return $dialog.FileName
    }
    return $null
}

# Only ever opened, never executed. Office documents, drawings, images
# and archives; no scripts, installers, shortcuts or binaries.
$Openable = @(
    '.pdf',
    '.dwg', '.dxf', '.dwf', '.rvt', '.rfa', '.rte', '.skp', '.3dm', '.ifc', '.pln', '.dgn',
    '.doc', '.docx', '.odt', '.rtf', '.txt', '.md',
    '.xls', '.xlsx', '.ods', '.csv',
    '.ppt', '.pptx', '.odp',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp', '.heic',
    '.zip', '.7z', '.rar',
    '.mp4', '.mov', '.avi',
    '.eml', '.msg'
)

# -- The share root: local configuration, never from the link --------
$rootFile = Join-Path $PSScriptRoot 'nas-root.txt'
if (-not (Test-Path -LiteralPath $rootFile)) {
    Show-Problem "This PC has no share root configured.`n`nExpected: $rootFile`n`nRe-run install.ps1 from the nas-handler folder."
}
$Root = (Get-Content -LiteralPath $rootFile -Raw -Encoding UTF8).Trim().TrimEnd('\', '/')
if ([string]::IsNullOrWhiteSpace($Root)) {
    Show-Problem "The share root in $rootFile is empty.`n`nRe-run install.ps1 with the correct path."
}
$RootPrefix = $Root.TrimEnd('\') + '\'

# Turns a relative path from the link into a full path, refusing
# anything that does not end up inside the share. Used for the file a
# link names, and for the folder the picker starts in.
function Resolve-InShare($relative) {
    $value = $relative -replace '/', '\'
    if ([string]::IsNullOrWhiteSpace($value)) { Show-Problem 'The link carries an empty file path.' }
    if ($value -match '(^|\\)\.\.(\\|$)')      { Show-Problem "That link tries to step outside the share:`n$value" }
    if ($value -match '^[\\/]')                { Show-Problem "That link is not a path inside the share:`n$value" }
    if ($value -match '^[A-Za-z]:')            { Show-Problem "That link points at a drive letter rather than the share:`n$value" }

    $resolved = [System.IO.Path]::GetFullPath((Join-Path $Root $value))
    if (-not $resolved.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Show-Problem "That link resolves outside the share and was not opened.`n`n$resolved"
    }
    return $resolved
}

# -- 1. Scheme and action --------------------------------------------
if ([string]::IsNullOrWhiteSpace($Url)) { Show-Problem 'No link was passed to the handler.' }

try { $uri = [System.Uri]$Url } catch { Show-Problem "That link is not a valid address:`n$Url" }
if ($uri.Scheme -ne 'nhn') { Show-Problem "Unexpected link type '$($uri.Scheme)'." }

$action = $uri.AbsolutePath.Trim('/').ToLowerInvariant()
if ($action -ne 'open' -and $action -ne 'folder' -and $action -ne 'pick') {
    Show-Problem "Unknown action '$action' in the link."
}

$relative = $null
if ($uri.Query -match '^\?path=(.+)$') {
    $relative = [System.Uri]::UnescapeDataString($Matches[1])
} elseif ($action -ne 'pick') {
    # open and folder name a file; pick may start anywhere.
    Show-Problem 'The link carries no file path.'
}

# -- 2. Pick: choose a file and hand its path back -------------------
if ($action -eq 'pick') {
    $startDir = $Root
    if ($relative) {
        $candidate = Resolve-InShare $relative
        if (Test-Path -LiteralPath $candidate) { $startDir = $candidate }
    }

    $picked = Get-PickedFile $startDir
    # Cancelled. Nothing chosen is not a problem worth a dialog about.
    if (-not $picked) { exit 0 }

    $pickedFull = [System.IO.Path]::GetFullPath($picked)
    if (-not $pickedFull.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Show-Problem "That file is not on the project share, so the system cannot link to it.`n`n$pickedFull`n`nEverything the practice links to has to live under:`n$Root"
    }

    $pickedRelative = $pickedFull.Substring($RootPrefix.Length)

    # The clipboard is the way back: Windows can launch this script but
    # gives it no way to answer the page that asked. The timestamp lets
    # the page tell a fresh pick from whatever was on the clipboard
    # already, so a cancelled dialog cannot quietly attach the last
    # drawing somebody chose.
    $stamp = [System.DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Set-Clipboard -Value "nhn-pick:${stamp}:${pickedRelative}"
    exit 0
}

# -- 3. Open or reveal the file the link names -----------------------
$full = Resolve-InShare $relative

if (-not (Test-Path -LiteralPath $full)) {
    Show-Problem "This file is no longer where the system expects it:`n`n$full`n`nIt was probably moved or renamed on the NAS. Ask whoever maintains the project folders, or update the link in the Documents page."
}

$isDirectory = (Get-Item -LiteralPath $full).PSIsContainer

if ($action -eq 'folder' -or $isDirectory) {
    if ($isDirectory) {
        Start-Process -FilePath 'explorer.exe' -ArgumentList "`"$full`""
    } else {
        # /select puts the file under the cursor with its siblings
        # visible, which is what somebody after "the other revisions"
        # actually wants.
        Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$full`""
    }
    exit 0
}

$extension = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
if ($Openable -notcontains $extension) {
    # Not refused, just not launched - Explorer reveals it and the
    # person decides. A link must never be able to start a program.
    Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$full`""
    exit 0
}

Start-Process -FilePath $full
