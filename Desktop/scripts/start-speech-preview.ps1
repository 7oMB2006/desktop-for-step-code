param(
    [string]$Profile = 'D:\DFSC-Preview-QA\native-speech-manual-20261109'
)
$ErrorActionPreference = 'Stop'
$desktop = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $desktop 'node_modules\electron\dist\electron.exe'
if (!(Test-Path -LiteralPath $electron -PathType Leaf) -or
    !(Test-Path -LiteralPath (Join-Path $desktop 'dist\main.cjs') -PathType Leaf) -or
    !(Test-Path -LiteralPath (Join-Path $desktop 'runtime\manifest.json') -PathType Leaf)) {
    throw 'Build Desktop and stage its runtime before opening the speech preview.'
}
$profilePath = [System.IO.Path]::GetFullPath($Profile)
New-Item -ItemType Directory -Path $profilePath -Force | Out-Null
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $electron
$start.Arguments = '.'
$start.WorkingDirectory = $desktop
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
$start.EnvironmentVariables['DESKTOP_TEST_USER_DATA'] = $profilePath
$start.EnvironmentVariables['DESKTOP_STEPPAGE_BUNDLE'] = Join-Path $profilePath 'no-personal-steppage.mjs'
foreach ($name in @('DESKTOP_TEST_NO_FOCUS', 'DESKTOP_DEV_URL', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE')) {
    $start.EnvironmentVariables.Remove($name)
}
$preview = [System.Diagnostics.Process]::Start($start)
Write-Output "Speech preview PID: $($preview.Id)"
Write-Output "Isolated profile: $profilePath"
