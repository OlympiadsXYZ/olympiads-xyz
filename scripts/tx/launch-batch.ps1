# scripts/tx/launch-batch.ps1 <logName> <batch.mjs args...>
# Starts one detached, hidden node run of scripts/tx/batch.mjs with the PATH the pipeline needs (rclone, conda
# python3, MiKTeX poppler, Git tools) and PYTHONUTF8=1; stdout/err go to tmp/tx/<logName>.out/.err.
# Example: powershell -NoProfile -File scripts/tx/launch-batch.ps1 batch-anthropic-a --catalogue --reader anthropic:claude-sonnet-5 ...
param([Parameter(Mandatory = $true)][string]$LogName, [Parameter(ValueFromRemainingArguments = $true)][string[]]$BatchArgs)
$root = 'D:\Projects\olympiads-xyz'
$prefix = @(
  'C:\Users\Marik\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\rclone-v1.75.1-windows-amd64',
  'C:\Users\Marik\miniconda3', 'C:\Users\Marik\miniconda3\Library\bin', 'C:\Users\Marik\miniconda3\Scripts',
  'C:\Users\Marik\AppData\Local\Programs\MiKTeX\miktex\bin\x64',
  'C:\Program Files\Git\mingw64\bin', 'C:\Program Files\Git\usr\bin'
) -join ';'
$env:PATH = "$prefix;$env:PATH"
$env:PYTHONUTF8 = '1'
$args2 = @("$root\scripts\tx\batch.mjs") + $BatchArgs
$p = Start-Process -FilePath node -ArgumentList $args2 -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\tmp\tx\$LogName.out" -RedirectStandardError "$root\tmp\tx\$LogName.err"
Write-Output ("launched pid " + $p.Id + ": node batch.mjs " + ($BatchArgs -join ' '))
