$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'win-unpacked\Desktop for Step Code.exe'
$profile = Join-Path $PSScriptRoot 'manual-preview-profile'
if (!(Test-Path -LiteralPath $exe -PathType Leaf) -or
    !(Test-Path -LiteralPath (Join-Path $profile 'step-runtime\bvr\config.json') -PathType Leaf)) {
    throw 'The prepared BVR preview package is incomplete.'
}
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $exe
$start.WorkingDirectory = Split-Path -Parent $exe
$start.UseShellExecute = $false
$start.EnvironmentVariables['DESKTOP_TEST_USER_DATA'] = $profile
$start.EnvironmentVariables.Remove('DESKTOP_TEST_NO_FOCUS')
$start.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
[System.Diagnostics.Process]::Start($start) | Out-Null
