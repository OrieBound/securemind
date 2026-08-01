# Run ONCE as Administrator to add Windows Defender exclusions for this project.
# After adding them you can flip turbopackFileSystemCacheForDev back to true in
# next.config.ts for faster repeated restarts.
#
# Usage (elevated PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\fix-defender.ps1

#Requires -RunAsAdministrator

$projectRoot = Split-Path -Parent $PSScriptRoot

$paths = @(
    $projectRoot,
    "$projectRoot\node_modules",
    "$projectRoot\.next",
    "$projectRoot\.turbo"
)

Write-Host ""
Write-Host "Adding Windows Defender exclusions for SecureMind..."
foreach ($p in $paths) {
    Write-Host "  + $p"
    Add-MpPreference -ExclusionPath $p -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Done. Open a new terminal and run npm run dev."
Write-Host "The slow-filesystem warning should disappear."
Write-Host "Then set turbopackFileSystemCacheForDev to true in next.config.ts."
Write-Host ""
