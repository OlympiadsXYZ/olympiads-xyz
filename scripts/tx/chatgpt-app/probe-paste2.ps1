# probe-paste2.ps1 — does chunked pasting (3 x 8000 chars) stay inline? (per-paste threshold ~10k)
Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }
"@
$AE = [System.Windows.Automation.AutomationElement]; $scope = [System.Windows.Automation.TreeScope]; $CT = [System.Windows.Automation.ControlType]
$p = Get-Process ChatGPT | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$win = $AE::FromHandle($p.MainWindowHandle)
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep -Milliseconds 300
for ($i = 0; $i -lt 6; $i++) { foreach ($pane in $win.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Pane)))) { $null = $pane.FindAll($scope::Children, [System.Windows.Automation.Condition]::TrueCondition) }; if ($win.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition).Count -gt 40) { break }; Start-Sleep -Milliseconds 500 }
function Find-All($type, $name, $exact = $true) { $out = @(); foreach ($e in $win.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type)))) { $n = $e.Current.Name; if (($exact -and $n -eq $name) -or (-not $exact -and $n -match $name)) { $out += $e } }; return ,$out }
$composer = (Find-All $CT::Edit 'Message ChatGPT')[0]
$composer.SetFocus(); Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('^a{DEL}'); Start-Sleep -Milliseconds 200
$unit = "Line of sample text number {0} with some words in it and a newline.`n"
for ($k = 1; $k -le 3; $k++) {
  $chunk = ''; $i = 0; while ($chunk.Length -lt 8000) { $chunk += ($unit -f $i); $i++ }
  [System.Windows.Forms.Clipboard]::SetText($chunk); [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 1200
  $val = ''; try { $val = $composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {}
  "after chunk {0}: composer holds {1} chars; pasted-text attachments: {2}" -f $k, $val.Length, (Find-All $CT::Button '^Remove Pasted text' $false).Count
}
foreach ($b in (Find-All $CT::Button '^Remove ' $false)) { try { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 150 } catch {} }
$composer.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('^a{DEL}')
