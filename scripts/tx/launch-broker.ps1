# scripts/tx/launch-broker.ps1 [broker args...]
# Starts the Anthropic Message Batches broker (scripts/tx/anthropic-batch-broker.mjs) detached and hidden, from THIS
# checkout (the scheduler must run from the same one: tmp/tx is checkout-relative); log tmp/tx/broker.out/.err and
# tmp/tx/anthropic-batch/broker.log. One broker per machine (broker.lock).
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$BrokerArgs)
$root = 'D:\Projects\olympiads-xyz'
$env:PYTHONUTF8 = '1'
$p = Start-Process -FilePath node -ArgumentList (@("$root\scripts\tx\anthropic-batch-broker.mjs") + $BrokerArgs) -WorkingDirectory $root -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$root\tmp\tx\broker.out" -RedirectStandardError "$root\tmp\tx\broker.err"
Write-Output ("launched broker pid " + $p.Id)
