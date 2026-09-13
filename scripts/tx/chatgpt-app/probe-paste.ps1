# probe-paste.ps1 — at which pasted length does the composer turn a paste into a "Pasted text.txt" attachment?
# Pastes texts of growing length into the composer, reads back, clears. Read-only for the chat (nothing is sent).
param([int[]]$Sizes = @(1000, 2500, 5000, 8000, 12000, 20000))
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
# clear leftover attachments and text first
foreach ($b in (Find-All $CT::Button '^Remove ' $false)) { try { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 150 } catch {} }
$composer = (Find-All $CT::Edit 'Message ChatGPT')[0]
$composer.SetFocus(); Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('^a{DEL}'); Start-Sleep -Milliseconds 200
foreach ($n in $Sizes) {
  $unit = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '; $text = ($unit * [Math]::Ceiling($n / $unit.Length + 1)).Substring(0, $n)
  $composer.SetFocus(); Start-Sleep -Milliseconds 200
  [System.Windows.Forms.Clipboard]::SetText($text)
  [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 1500
  $val = ''; try { $val = $composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {}
  $pasted = (Find-All $CT::Button '^Remove Pasted text' $false).Count
  "{0,6} chars: composer holds {1,6} chars; pasted-text attachments: {2}" -f $n, $val.Length, $pasted
  foreach ($b in (Find-All $CT::Button '^Remove ' $false)) { try { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 150 } catch {} }
  $composer.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('^a{DEL}'); Start-Sleep -Milliseconds 300
}
