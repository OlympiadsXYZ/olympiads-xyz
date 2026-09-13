# probe2.ps1 — nudge Chromium into exposing its accessibility tree (a UIA client touching the render widget
# usually switches it on), then list the composer, buttons and message text.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$p = Get-Process ChatGPT | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$win = $AE::FromHandle($p.MainWindowHandle)
# touch every pane (Chromium enables accessibility when a client asks for children of the render widget)
for ($round = 1; $round -le 6; $round++) {
  $panes = $win.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Pane)))
  foreach ($pane in $panes) { $null = $pane.FindAll($scope::Children, [System.Windows.Automation.Condition]::TrueCondition); $null = $pane.GetSupportedPatterns() }
  $docs = $win.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
  $all = $win.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  "round {0}: {1} descendants, {2} documents" -f $round, $all.Count, $docs.Count
  if ($all.Count -gt 40) { break }
  Start-Sleep -Milliseconds 800
}
$types = @{}
foreach ($e in $all) { $t = $e.Current.ControlType.ProgrammaticName; if (-not $types.ContainsKey($t)) { $types[$t] = 0 }; $types[$t]++ }
$types.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { "  {0} x{1}" -f $_.Key, $_.Value }
"--- interactive elements"
foreach ($e in $all) {
  $c = $e.Current
  $t = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
  if ($t -in @('Button', 'Edit', 'Document', 'MenuItem', 'ComboBox') -or ($t -eq 'Text' -and $c.Name.Length -gt 30)) {
    $n = $c.Name; if ($n.Length -gt 80) { $n = $n.Substring(0, 80) + '…' }
    $pat = ($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers\.Pattern$', '' }) -join ','
    "  {0,-9} '{1}' auto='{2}' [{3}] rect={4}" -f $t, $n, $c.AutomationId, $pat, $c.BoundingRectangle
  }
}
