# Dot-source this script: . .\scripts\use-tools.ps1
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:PATH = @(
    (Join-Path $projectRoot '.tools\node'),
    (Join-Path $projectRoot '.tools\go\bin'),
    (Join-Path $projectRoot '.tools\bun'),
    $env:PATH
) -join ';'
$env:npm_config_cache = Join-Path $projectRoot '.local\npm-cache'
$env:GOCACHE = Join-Path $projectRoot '.local\go-build'
$env:GOMODCACHE = Join-Path $projectRoot '.local\go-mod'
$env:BUN_INSTALL_CACHE_DIR = Join-Path $projectRoot '.local\bun-cache'
