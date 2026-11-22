$desktop = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$wshell = New-Object -ComObject WScript.Shell
$shortcut = $wshell.CreateShortcut("$desktop\avelly.lnk")
$shortcut.TargetPath = "c:\Users\Aditya\Downloads\AvellyOn\github\avellyclipping\run.bat"
$shortcut.WorkingDirectory = "c:\Users\Aditya\Downloads\AvellyOn\github\avellyclipping"
$shortcut.Description = "Launch avelly AI Clip Engine"
$shortcut.Save()

Write-Output "Created: $(Test-Path "$desktop\avelly.lnk")"
