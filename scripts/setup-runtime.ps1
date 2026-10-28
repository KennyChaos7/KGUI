$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'use-tools.ps1')

Push-Location (Join-Path $projectRoot 'runtime')
try {
    if (Test-Path -LiteralPath 'package-lock.json') {
        & (Join-Path $projectRoot '.tools\node\npm.cmd') ci --ignore-scripts
    } else {
        & (Join-Path $projectRoot '.tools\node\npm.cmd') install --ignore-scripts
    }
    if ($LASTEXITCODE -ne 0) { throw 'Pi dependency installation failed.' }
} finally {
    Pop-Location
}
