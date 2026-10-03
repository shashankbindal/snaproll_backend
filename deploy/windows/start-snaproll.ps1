$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
Set-Location $backendRoot
& $node (Join-Path $backendRoot 'src\server.js')
