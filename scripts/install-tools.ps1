$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

$releases = @(
    @{ Name = 'node'; Version = 'v24.22.1'; Size = 37748064; Folder = 'node-v24.22.1-win-x64'; Executable = 'node.exe'; Url = 'https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip' },
    @{ Name = 'go'; Version = 'go1.27.3'; Size = 79010309; Folder = 'go'; Executable = 'bin\go.exe'; Url = 'https://go.dev/dl/go1.27.3.windows-amd64.zip' },
    @{ Name = 'bun'; Version = '1.4.4'; Size = 54731706; Folder = 'bun-windows-x64'; Executable = 'bun.exe'; Url = 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-windows-x64.zip' }
)

foreach ($release in $releases) {
    $destination = Join-Path $toolsRoot $release.Name
    if (Test-Path -LiteralPath (Join-Path $destination $release.Executable)) {
        Write-Output ($release.Name + ': already installed')
        continue
    }
    $archive = Join-Path $toolsRoot ($release.Name + '-' + $release.Version + '.zip')
    Write-Output ('Downloading ' + $release.Name + ' ' + $release.Version)
    # Full transfers stall on this network; bounded Range requests work.
    $archiveStream = [System.IO.File]::Create($archive)
    try {
        for ($offset = 0; $offset -lt $release.Size; $offset += 4194304) {
            $end = [Math]::Min($offset + 4194303, $release.Size - 1)
            $part = $archive + '.part'
            # Keep certificate validation; tolerate only an unavailable revocation service.
            & curl.exe --ssl-revoke-best-effort --fail --location --silent --show-error --connect-timeout 20 --max-time 60 --range ($offset.ToString() + '-' + $end.ToString()) --output $part $release.Url
            if ($LASTEXITCODE -ne 0) { throw ('Download failed: ' + $release.Name) }
            $bytes = [System.IO.File]::ReadAllBytes($part)
            if ($bytes.Length -ne ($end - $offset + 1)) { throw ('Incomplete download segment: ' + $release.Name) }
            $archiveStream.Write($bytes, 0, $bytes.Length)
            Write-Output ($release.Name + ': ' + ($end + 1) + '/' + $release.Size + ' bytes')
        }
    } finally {
        $archiveStream.Dispose()
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $toolsRoot
    if ($release.Folder -ne $release.Name) {
        Rename-Item -LiteralPath (Join-Path $toolsRoot $release.Folder) -NewName $release.Name
    }
    Write-Output ('Installed ' + $release.Name)
}

& (Join-Path $toolsRoot 'node\node.exe') --version
& (Join-Path $toolsRoot 'node\npm.cmd') --version
& (Join-Path $toolsRoot 'go\bin\go.exe') version
& (Join-Path $toolsRoot 'bun\bun.exe') --version
