$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'use-tools.ps1')
Push-Location (Join-Path $projectRoot 'desktop')
try {
    & (Join-Path $projectRoot '.tools\bun\bun.exe') run dev
    if ($LASTEXITCODE -ne 0) { throw 'KGUI development process failed.' }
} finally {
    Pop-Location
}
