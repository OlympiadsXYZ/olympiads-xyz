# probe.ps1 — what the ChatGPT desktop app exposes to UI Automation (window, composer, buttons, messages).
# Read-only: prints the accessibility tree of the ChatGPT window filtered to the control types we need.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$root = $AE::RootElement
$scope = [System.Windows.Automation.TreeScope]
$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'ChatGPT' -or $_.ProcessName -match '^(ChatGPT|Codex)' }
foreach ($p in $procs) { "process {0} pid {1} title '{2}' hwnd {3}" -f $p.ProcessName, $p.Id, $p.MainWindowTitle, $p.MainWindowHandle }
$win = $null
foreach ($p in $procs) {
  if ($p.MainWindowHandle -ne 0) { $win = $AE::FromHandle($p.MainWindowHandle); break }
}
if (-not $win) { $cond = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, 'ChatGPT'); $win = $root.FindFirst($scope::Children, $cond) }
if (-not $win) { Write-Output 'no ChatGPT window found'; exit 1 }
"window: name='{0}' class='{1}' pid={2}" -f $win.Current.Name, $win.Current.ClassName, $win.Current.ProcessId
$all = $win.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
"descendants: {0}" -f $all.Count
$types = @{}
foreach ($e in $all) { $t = $e.Current.ControlType.ProgrammaticName; if (-not $types.ContainsKey($t)) { $types[$t] = 0 }; $types[$t]++ }
$types.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { "  {0} x{1}" -f $_.Key, $_.Value }
"--- named interactive elements (Button, Edit, Document, MenuItem, ComboBox, Text with a name over 20 chars)"
foreach ($e in $all) {
  $c = $e.Current
  $t = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
  if ($t -in @('Button', 'Edit', 'Document', 'MenuItem', 'ComboBox', 'Group', 'Custom') -or ($t -eq 'Text' -and $c.Name.Length -gt 20)) {
    $n = $c.Name; if ($n.Length -gt 90) { $n = $n.Substring(0, 90) + '…' }
    $pat = ($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'Pattern(Identifiers)?\.Pattern$', '' -replace '^([A-Za-z]+)Pattern.*', '$1' }) -join ','
    if ($n -or $t -in @('Edit', 'Document')) { "  {0,-9} '{1}' auto='{2}' cls='{3}' [{4}] rect={5}" -f $t, $n, $c.AutomationId, $c.ClassName, $pat, $c.BoundingRectangle }
  }
}
