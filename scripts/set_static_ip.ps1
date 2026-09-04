# Self-elevate to run as Administrator
if (!([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Write-Host "=========================================="
Write-Host "      JOMISH SUITE - STATIC IP SETUP      "
Write-Host "=========================================="
Write-Host "Detecting active network adapter..."

# FIX: Replaced deprecated Get-WmiObject with Get-CimInstance
$netAdapter = Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration -Filter "IPEnabled = 'True'" | Where-Object { $null -ne $_.DefaultIPGateway } | Select-Object -First 1

# FIX: $null on the left side is safer in PowerShell (avoids collection comparison bugs)
if ($null -eq $netAdapter) {
    Write-Host "ERROR: Could not find an active network adapter with a default gateway." -ForegroundColor Red
    Write-Host "Please ensure you are connected to the network (Wi-Fi or Ethernet)." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit
}

$currentIP      = $netAdapter.IPAddress[0]
$subnetMask     = $netAdapter.IPSubnet[0]
$defaultGateway = $netAdapter.DefaultIPGateway[0]

# FIX: Use InterfaceIndex from CimInstance to correctly match Get-NetAdapter
#      Previously used .Index (adapter config index) which does NOT match InterfaceIndex,
#      causing $ifAlias to be $null and all netsh commands to silently fail.
$ifIndex = $netAdapter.InterfaceIndex
$ifAlias = (Get-NetAdapter | Where-Object { $_.InterfaceIndex -eq $ifIndex } | Select-Object -First 1).Name

if ($null -eq $ifAlias) {
    Write-Host "ERROR: Could not resolve network adapter name for index $ifIndex." -ForegroundColor Red
    Write-Host "Static IP configuration aborted." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit
}

Write-Host "Active Adapter: $ifAlias"        -ForegroundColor Cyan
Write-Host "Current IP:     $currentIP"      -ForegroundColor Cyan
Write-Host "Subnet Mask:    $subnetMask"     -ForegroundColor Cyan
Write-Host "Gateway:        $defaultGateway" -ForegroundColor Cyan
Write-Host "------------------------------------------"

Write-Host "Configuring this PC to use $currentIP as a STATIC IP..."

# FIX: Replaced Invoke-Expression (security risk / injection vector) with direct & calls
#      Arguments passed as an array — safe, no shell injection possible.
& netsh interface ip set address name="$ifAlias" static $currentIP $subnetMask $defaultGateway

# Set DNS to Google DNS
& netsh interface ip set dns name="$ifAlias" static 8.8.8.8
& netsh interface ip add dns name="$ifAlias" 8.8.4.4 index=2

Write-Host ""
Write-Host "SUCCESS! The PC has been configured with a Static IP." -ForegroundColor Green
Write-Host "Your fixed Local Host Address is: http://${currentIP}:3005" -ForegroundColor Yellow
Write-Host "Other devices on the network can connect to this PC using the address above." -ForegroundColor Yellow
Write-Host "=========================================="
Read-Host "Press Enter to close this window"
exit
