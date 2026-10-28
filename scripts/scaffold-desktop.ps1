$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'use-tools.ps1')
Push-Location $projectRoot
try {
    & (Join-Path $projectRoot '.tools\bun\bun.exe') x --bun mygo-cli init desktop
    if ($LASTEXITCODE -ne 0) { throw 'MyGo scaffold failed.' }
} finally {
    Pop-Location
}
