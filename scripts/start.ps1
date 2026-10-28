$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
# Launch the interactive desktop window; subprocess consoles are hidden by the app.
Start-Process -FilePath (Join-Path $projectRoot 'desktop\build\windows-amd64\KGUI.exe') -WorkingDirectory $projectRoot
