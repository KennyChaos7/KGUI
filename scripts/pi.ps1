$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path $projectRoot '.tools\node\node.exe'
$packageDirectory = Join-Path $projectRoot 'runtime\node_modules\@earendil-works\pi-coding-agent'
$package = Get-Content -Raw -LiteralPath (Join-Path $packageDirectory 'package.json') | ConvertFrom-Json
$entry = Join-Path $packageDirectory $package.bin.pi

& $nodePath $entry @args
exit $LASTEXITCODE
