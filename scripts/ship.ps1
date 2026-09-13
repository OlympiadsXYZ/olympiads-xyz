# ship.ps1 — runs scripts/ship.mjs with the pipeline's tool directories on PATH.
# Registered as the Windows scheduled task "OlympiadsShip" (every 2 hours) while the
# catalogue and legacy runs promote papers; safe to run any time (nothing is committed
# unless every gate passes). Log: tmp/tx/ship.log
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:PATH = "C:\Users\Marik\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\rclone-v1.75.1-windows-amd64;C:\Users\Marik\miniconda3;C:\Users\Marik\miniconda3\Library\bin;C:\Users\Marik\miniconda3\Scripts;C:\Users\Marik\AppData\Local\Programs\MiKTeX\miktex\bin\x64;C:\Program Files\Git\mingw64\bin;C:\Program Files\Git\usr\bin;C:\Program Files\Git\cmd;C:\Program Files\nodejs;" + $env:PATH
$env:PYTHONUTF8 = "1"
$log = Join-Path $root "tmp\tx\ship.log"
"==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $log -Append -Encoding utf8
& node scripts/ship.mjs 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
"exit $LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8
