# Fix Jomish Suite startup shortcuts

$startupDir = [System.Environment]::GetFolderPath('Startup')

# ---- 1. Remove old SecPortal leftover ----
$secPortal = Join-Path $startupDir 'SecPortal.lnk'
if (Test-Path $secPortal) {
    Remove-Item $secPortal -Force
    Write-Host "REMOVED: SecPortal.lnk (old secretary portal leftover)" -ForegroundColor Green
} else {
    Write-Host "SecPortal.lnk not found (already gone)" -ForegroundColor Yellow
}

# ---- 2. Fix JomishSuite.lnk to use wscript.exe properly ----
$sh      = New-Object -ComObject WScript.Shell
$lnkPath = Join-Path $startupDir 'JomishSuite.lnk'
$vbsPath = 'C:\Users\arnol\Desktop\123\jomish business suite\unified-jomish-suite\Start_Jomish_Suite.vbs'
$workDir = 'C:\Users\arnol\Desktop\123\jomish business suite\unified-jomish-suite'

$shortcut                 = $sh.CreateShortcut($lnkPath)
$shortcut.TargetPath      = 'wscript.exe'
$shortcut.Arguments       = '//B "' + $vbsPath + '"'
$shortcut.WorkingDirectory = $workDir
$shortcut.WindowStyle     = 7   # minimized / hidden
$shortcut.Save()

Write-Host "FIXED: JomishSuite.lnk -> wscript.exe //B `"Start_Jomish_Suite.vbs`"" -ForegroundColor Green

# ---- Verify ----
$verify = $sh.CreateShortcut($lnkPath)
Write-Host ""
Write-Host "--- Verification ---" -ForegroundColor Cyan
Write-Host "  TargetPath : $($verify.TargetPath)"
Write-Host "  Arguments  : $($verify.Arguments)"
Write-Host "  WorkingDir : $($verify.WorkingDirectory)"
Write-Host ""
Write-Host "Done. Startup will now launch correctly on next reboot." -ForegroundColor Green
