param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
$controlPath = Join-Path $output 'preview-control.json'
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($output))).Replace('-', '') }
finally { $sha.Dispose() }
$mutex = [Threading.Mutex]::new($false, "Local\DFSC-Tool-Preview-$hash")
$held = $false
function Show-ExistingPreview {
  if (!(Test-Path -LiteralPath $controlPath)) { return $false }
  try {
    $control = Get-Content -LiteralPath $controlPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($control.project -ne $project -or $control.port -lt 1 -or $control.port -gt 65535) { return $false }
    $reply = Invoke-RestMethod -Uri "http://127.0.0.1:$($control.port)/preview/reveal" -Method Post `
      -Headers @{ 'x-preview-token' = $control.token } -TimeoutSec 3
    if ($reply.pid -ne $control.pid -or !$reply.visible -or $reply.minimized) { return $false }
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.AppActivate([int]$reply.pid)
    return $true
  } catch { return $false }
}
try {
  $held = $mutex.WaitOne(0)
  if (!$held) { return }
  if (Show-ExistingPreview) { return }
  if (!(Test-Path -LiteralPath (Join-Path $project 'dist\main.cjs'))) { throw 'Build the preview source before opening it.' }
  $null = New-Item -ItemType Directory -Path $output -Force
  $env:DESKTOP_PREVIEW_OUTPUT = $output
  $node = (Get-Command node.exe).Source
  $process = Start-Process -FilePath $node -ArgumentList 'scripts/preview-runtime-startup-status.mjs' `
    -WorkingDirectory $project -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $output 'preview.log') -RedirectStandardError (Join-Path $output 'preview-error.log')
  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    if (Show-ExistingPreview) { return }
    $process.Refresh()
    if ($process.HasExited) { throw "Preview exited. See $(Join-Path $output 'preview-error.log')" }
  } while ((Get-Date) -lt $deadline)
  throw "Preview did not become ready. See $(Join-Path $output 'preview-error.log')"
} catch {
  $null = New-Item -ItemType Directory -Path $output -Force
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $output 'launcher-error.log') -Encoding utf8
  Add-Type -AssemblyName System.Windows.Forms
  $null = [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'DFSC Tool Status Preview')
} finally {
  if ($held) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
