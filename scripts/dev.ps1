# Kill any stale process holding port 3000 before starting the dev server.
$port = 3000
$connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($connections) {
    $stalePids = $connections.OwningProcess | Sort-Object -Unique
    foreach ($p in $stalePids) {
        try {
            $proc = Get-Process -Id $p -ErrorAction Stop
            Write-Host "  Killing stale :$port process -- PID $p ($($proc.ProcessName))"
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        } catch {}
    }
    Start-Sleep -Milliseconds 600
} else {
    Write-Host "  Port $port is free."
}

Set-Location $PSScriptRoot\..
Write-Host "  Generating Prisma client..."
& ".\node_modules\.bin\prisma.cmd" generate | Out-Null
& ".\node_modules\.bin\next.cmd" dev
