# probe3.ps1 [regex] — the ChatGPT app's UIA elements whose name matches the regex (default: the composer and the
# message-area controls we drive), with control type, patterns and rectangle; plus the Edit control's value.
param([string]$Pattern = 'Message|Send|Stop|Copy|Attach|Add photos|Add files|Upload|file|photo|Dictate|Voice|Model|Thinking|Regenerate|Good response|Bad response|Read aloud|Edit message|Retry|Share')
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$p = Get-Process ChatGPT | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$win = $AE::FromHandle($p.MainWindowHandle)
for ($round = 1; $round -le 6; $round++) {
  $panes = $win.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Pane)))
  foreach ($pane in $panes) { $null = $pane.FindAll($scope::Children, [System.Windows.Automation.Condition]::TrueCondition) }
  $all = $win.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  if ($all.Count -gt 40) { break }
  Start-Sleep -Milliseconds 800
}
"descendants: {0}" -f $all.Count
foreach ($e in $all) {
  $c = $e.Current
  $t = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
  if ($t -eq 'Edit' -or $t -eq 'Document' -or ($c.Name -match $Pattern)) {
    $n = $c.Name; if ($n.Length -gt 100) { $n = $n.Substring(0, 100) + '…' }
    $pat = ($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers\.Pattern$', '' }) -join ','
    $val = ''
    try { if ($t -eq 'Edit') { $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $val = ' value=' + $vp.Current.Value.Substring(0, [Math]::Min(60, $vp.Current.Value.Length)) } } catch {}
    "  {0,-9} '{1}' auto='{2}' cls='{3}' [{4}] rect={5} enabled={6}{7}" -f $t, $n, $c.AutomationId, $c.ClassName, $pat, $c.BoundingRectangle, $c.IsEnabled, $val
  }
}
