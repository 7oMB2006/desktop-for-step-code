$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -Path (Join-Path $PSScriptRoot 'file-associations.cs') -ReferencedAssemblies 'System.Drawing'
  switch ($request.action) {
    'list' { ConvertTo-Json -InputObject @([FileAssociations]::List($request.extension)) -Depth 4 -Compress }
    'open' { [FileAssociations]::Open($request.path, $request.id); '{"ok":true}' }
    'other' { [FileAssociations]::Choose($request.path, $request.window); '{"ok":true}' }
    default { throw 'Invalid association operation' }
  }
} catch {
  [Console]::Error.WriteLine('File association operation failed')
  exit 1
}
