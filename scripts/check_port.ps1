Write-Host '=== Checking port 3005 ==='
$conn = netstat -ano | Select-String ':3005'
if ($conn) {
    Write-Host 'Port 3005 is OPEN:' -ForegroundColor Green
    $conn | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host 'Port 3005 is NOT listening' -ForegroundColor Red
}

Write-Host ''
Write-Host '=== Running node processes ==='
$procs = Get-Process -Name node -ErrorAction SilentlyContinue
if ($procs) {
    $procs | Select-Object Id, CPU, WorkingSet, StartTime | Format-Table -AutoSize
} else {
    Write-Host 'No node processes found' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== HTTP check on :3005 ==='
try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3005/api/discover' -UseBasicParsing -TimeoutSec 5
    Write-Host "Server responded: HTTP $($r.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "Server not responding: $_" -ForegroundColor Red
}
