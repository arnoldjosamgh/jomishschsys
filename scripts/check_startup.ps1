$sh = New-Object -ComObject WScript.Shell
$startupDir = [System.Environment]::GetFolderPath('Startup')
Write-Host "Startup folder: $startupDir"
$lnks = Get-ChildItem $startupDir -ErrorAction SilentlyContinue
foreach ($item in $lnks) {
    Write-Host "Item: $($item.Name) [$($item.Extension)]"
    if ($item.Extension -eq '.lnk') {
        $s = $sh.CreateShortcut($item.FullName)
        Write-Host "  TargetPath : $($s.TargetPath)"
        Write-Host "  Arguments  : $($s.Arguments)"
        Write-Host "  WorkingDir : $($s.WorkingDirectory)"
    }
}
