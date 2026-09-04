Start-Sleep -Seconds 3
$logPath = 'data\server.log'
if (Test-Path $logPath) {
    Write-Host '=== Last 20 lines of server.log ==='
    Get-Content $logPath -Tail 20
} else {
    Write-Host 'server.log not found'
}
Write-Host ''
Write-Host '=== Running node processes ==='
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, CPU, WorkingSet, StartTime
