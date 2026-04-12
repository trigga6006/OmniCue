#!/usr/bin/env pwsh
# OmniCue Installer — run with:
#   irm https://raw.githubusercontent.com/trigga6006/OmniCue/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$repo = "trigga6006/OmniCue"

Write-Host ""
Write-Host "  OmniCue Installer" -ForegroundColor Cyan
Write-Host "  =================" -ForegroundColor DarkGray
Write-Host ""

# Fetch latest release info from GitHub API
Write-Host "  Fetching latest release..." -ForegroundColor Gray
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
} catch {
    Write-Host "  ERROR: Could not reach GitHub. Check your internet connection." -ForegroundColor Red
    exit 1
}

$version = $release.tag_name
$asset = $release.assets | Where-Object { $_.name -match '\.exe$' } | Select-Object -First 1

if (-not $asset) {
    Write-Host "  ERROR: No installer found in release $version" -ForegroundColor Red
    exit 1
}

$url = $asset.browser_download_url
$fileName = $asset.name
$tempDir = Join-Path $env:TEMP "omnicue-install"
$tempFile = Join-Path $tempDir $fileName

Write-Host "  Version:  $version" -ForegroundColor White
Write-Host "  File:     $fileName" -ForegroundColor White
Write-Host ""

# Download
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

Write-Host "  Downloading..." -ForegroundColor Gray
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $url -OutFile $tempFile -UseBasicParsing
$ProgressPreference = 'Continue'

$size = [math]::Round((Get-Item $tempFile).Length / 1MB, 1)
Write-Host "  Downloaded ($size MB)" -ForegroundColor Green
Write-Host ""

# Run installer
Write-Host "  Launching installer..." -ForegroundColor Gray
Start-Process -FilePath $tempFile -Wait

# Clean up
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  Done! OmniCue should now be installed." -ForegroundColor Green
Write-Host "  Look for OmniCue on your Desktop or Start Menu." -ForegroundColor Gray
Write-Host ""
