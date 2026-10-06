$ErrorActionPreference = 'Stop'
$node = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../runtime/node/node.exe'))
$script = Join-Path $PSScriptRoot 'run-queue-demo.mjs'
$exe = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../Desktop for Step Code.exe'))
foreach ($path in @($node, $script, $exe)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing demo resource: $path" }
}
Start-Process -FilePath $node -ArgumentList @("`"$script`"", "`"$exe`"") -WindowStyle Hidden
