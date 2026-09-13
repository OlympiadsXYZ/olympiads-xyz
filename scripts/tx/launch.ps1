# scripts/tx/launch.ps1 <logName> <run.mjs args...>   (PowerShell: powershell -NoProfile -File scripts/tx/launch.ps1 <log> <id> --continue …)
# Starts one detached, hidden node run of scripts/tx/run.mjs with the PATH the pipeline needs (rclone, conda python3,
# MiKTeX poppler, Git tools) and PYTHONUTF8=1; stdout/err go to tmp/tx/<logName>.out/.err.
param([Parameter(Mandatory = $true)][string]$LogName, [Parameter(ValueFromRemainingArguments = $true)][string[]]$RunArgs)
$root = 'D:\Projects\olympiads-xyz'
$prefix = @(
  'C:\Users\Marik\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\rclone-v1.75.1-windows-amd64',
  'C:\Users\Marik\miniconda3', 'C:\Users\Marik\miniconda3\Library\bin', 'C:\Users\Marik\miniconda3\Scripts',
  'C:\Users\Marik\AppData\Local\Programs\MiKTeX\miktex\bin\x64',
  'C:\Program Files\Git\mingw64\bin', 'C:\Program Files\Git\usr\bin'
) -join ';'
$env:PATH = "$prefix;$env:PATH"
$env:PYTHONUTF8 = '1'
$args2 = @("$root\scripts\tx\run.mjs") + $RunArgs
$p = Start-Process -FilePath node -ArgumentList $args2 -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\tmp\tx\$LogName.out" -RedirectStandardError "$root\tmp\tx\$LogName.err"
Write-Output ("launched pid " + $p.Id + ": node run.mjs " + ($RunArgs -join ' '))
