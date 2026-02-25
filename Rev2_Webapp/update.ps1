# =============================================================
# SIT — Update Script (Windows PowerShell)
# =============================================================
# Pulls latest app code from git without touching campaign data.
# Usage: .\update.ps1
# =============================================================

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "  ┌─────────────────────────────────────────────┐"
Write-Host "  │  SIT — Update                               │"
Write-Host "  └─────────────────────────────────────────────┘"
Write-Host ""

# Safety check
if (-not (Test-Path "server.js")) {
    Write-Host "ERROR: Run this from the SIT project directory." -ForegroundColor Red
    exit 1
}

# Check campaign/ exists
if (Test-Path "campaign") {
    Write-Host "  ✓ Campaign data found (will NOT be touched)" -ForegroundColor Green
} else {
    Write-Host "  ℹ No campaign/ folder yet (will be created on next server start)" -ForegroundColor Yellow
}

# Stop running server
$nodeProcs = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcs) {
    Write-Host "  Stopping running server..."
    Stop-Process -Name node -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Pull latest code
Write-Host ""
Write-Host "  Pulling latest code..."
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  ⚠ Git pull failed. You may have local changes." -ForegroundColor Yellow
    Write-Host "    Try: git stash ; .\update.ps1 ; git stash pop"
    exit 1
}

# Install dependencies
Write-Host "  Installing dependencies..."
npm install --production
Write-Host ""

Write-Host "  ✓ Update complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Start the server with: node server.js" -ForegroundColor Cyan
Write-Host ""
