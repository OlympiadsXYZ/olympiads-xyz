# driver.ps1 — one prompt through the ChatGPT desktop app, driven by Windows UI Automation.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tx/chatgpt-app/driver.ps1 `
#     -PromptFile prompt.txt -Files a.png,b.png -OutFile reply.md [-TimeoutSec 1200] [-SameChat] [-Debug]
#
# Steps: bring the app to the front → New chat (unless -SameChat) → attach the files through the app's own
# "Add photos & files" dialog → paste the prompt into the composer → Send → wait until the reply is complete
# (the "Regenerate response" button appears) → Copy → the clipboard text goes to -OutFile. Prints one JSON line
# with the outcome on stdout; details on stderr; a screenshot next to -OutFile when a step fails.
# The app's accessibility tree is Chromium's: it exposes the controls we need by name ("New chat",
# "Add files and more", "Message ChatGPT", "Send", "Copy", "Regenerate response").
param(
  [Parameter(Mandatory = $true)][string]$PromptFile,
  [string[]]$Files = @(),
  [string]$FileList = '',
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int]$TimeoutSec = 1200,
  [switch]$SameChat,
  [string]$ExpectChat = '',
  [int]$RequireIdleSec = 45,
  [switch]$DebugTree
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static double IdleSeconds() { var l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return (Environment.TickCount - (int)l.dwTime) / 1000.0; }
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
$AE = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$started = Get-Date
# files: -Files a,b (an array when called from PowerShell; one comma-joined string from other shells) or -FileList (one path per line)
if ($FileList) { $Files = @([System.IO.File]::ReadAllLines($FileList) | Where-Object { $_.Trim() }) }
elseif ($Files.Count -eq 1 -and $Files[0] -match ',' -and -not (Test-Path $Files[0])) { $Files = @($Files[0] -split ',') }
$Files = @($Files | ForEach-Object { $_.Trim() } | Where-Object { $_ })
trap { [Console]::Error.WriteLine("[chatgpt-app] unhandled: $($_.Exception.Message)`n$($_.ScriptStackTrace)"); Fail ("unhandled: " + $_.Exception.Message) }
function Log($s) { [Console]::Error.WriteLine(("[chatgpt-app {0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $s)) }
function Fail($s) {
  Log "FAIL: $s"
  try {
    $shot = [System.IO.Path]::ChangeExtension($OutFile, '.failed.png')
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); $bmp.Save($shot); $g.Dispose(); $bmp.Dispose()
    Log "screenshot: $shot"
  } catch {}
  Write-Output (@{ ok = $false; error = $s; seconds = [int]((Get-Date) - $started).TotalSeconds } | ConvertTo-Json -Compress)
  exit 1
}

# ---- the app window
function Get-AppWindow {
  $p = Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { return $null }
  return @{ proc = $p; el = $AE::FromHandle($p.MainWindowHandle) }
}
$app = Get-AppWindow
if (-not $app) {
  Log 'ChatGPT is not running; launching'
  Start-Process 'explorer.exe' 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App'
  for ($i = 0; $i -lt 60 -and -not $app; $i++) { Start-Sleep -Milliseconds 1000; $app = Get-AppWindow }
  if (-not $app) { Fail 'ChatGPT window did not appear within 60 s' }
  Start-Sleep -Seconds 5
}
$hwnd = $app.proc.MainWindowHandle
$win = $app.el
$pid_ = $app.proc.Id
function Show-App {
  if ([Win32]::IsIconic($hwnd)) { [Win32]::ShowWindow($hwnd, 9) | Out-Null }
  $fg = [Win32]::GetForegroundWindow()
  if ($fg -ne $hwnd) {
    $t1 = [Win32]::GetWindowThreadProcessId($fg, [IntPtr]::Zero); $t2 = [Win32]::GetCurrentThreadId()
    [Win32]::AttachThreadInput($t1, $t2, $true) | Out-Null
    [Win32]::SetForegroundWindow($hwnd) | Out-Null
    [Win32]::AttachThreadInput($t1, $t2, $false) | Out-Null
    Start-Sleep -Milliseconds 300
  }
}
# Chromium exposes its tree once a client walks the panes
function Wake-Tree {
  for ($round = 1; $round -le 8; $round++) {
    $panes = $win.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Pane)))
    foreach ($pane in $panes) { $null = $pane.FindAll($scope::Children, [System.Windows.Automation.Condition]::TrueCondition) }
    $all = $win.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    if ($all.Count -gt 40) { return }
    Start-Sleep -Milliseconds 700
  }
  Fail 'the app exposes no accessibility tree'
}
function Find-All($root, $type, $name, $exact = $true) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type)
  $els = $root.FindAll($scope::Descendants, $cond)
  $out = @()
  foreach ($e in $els) { $n = $e.Current.Name; if (($exact -and $n -eq $name) -or (-not $exact -and $n -match $name)) { $out += $e } }
  return ,$out
}
function Wait-For($what, [scriptblock]$probe, $seconds = 20) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) { $r = & $probe; if ($r) { return $r }; Start-Sleep -Milliseconds 500 }
  return $null
}
function Click-El($el) {
  $r = $el.Current.BoundingRectangle
  if ($r.Width -le 0) { throw "element '$($el.Current.Name)' has no rectangle to click" }
  Show-App
  [Win32]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
  Start-Sleep -Milliseconds 150
  [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
function Invoke-El($el) {
  # whatever the control offers: Invoke, ExpandCollapse, Toggle; else a real click at its centre.
  # Menu items and popup triggers of this app only react to a real click.
  $t = $el.Current.ControlType.ProgrammaticName
  if ($t -eq 'ControlType.MenuItem') { Click-El $el; return }
  $pats = @($el.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
  try {
    if ($pats -contains 'InvokePatternIdentifiers.Pattern') { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return }
    if ($pats -contains 'ExpandCollapsePatternIdentifiers.Pattern') { $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand(); return }
    if ($pats -contains 'TogglePatternIdentifiers.Pattern') { $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle(); return }
  } catch { Log ("pattern call refused on '{0}' ({1}); clicking instead" -f $el.Current.Name, $_.Exception.Message.Split("`n")[0]) }
  Click-El $el
}
function Count-Copy { (Find-All $win $CT::Button 'Copy').Count }
# the app's file dialog is a '#32770' window under the app window in the UIA tree (another process hosts it)
function Find-Dialog {
  foreach ($w in $win.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Window)))) { if ($w.Current.ClassName -eq '#32770') { return $w } }
  foreach ($w in $AE::RootElement.FindAll($scope::Children, [System.Windows.Automation.Condition]::TrueCondition)) { if ($w.Current.ClassName -eq '#32770' -and $w.Current.Name -match '^Open') { return $w } }
  return $null
}

# Margulan may be at the keyboard: wait until the mouse and keyboard have been idle for a while before taking over
if ($RequireIdleSec -gt 0) {
  $waited = 0
  while ([Win32]::IdleSeconds() -lt $RequireIdleSec) { if ($waited -eq 0) { Log ("waiting for {0} s of keyboard/mouse idle" -f $RequireIdleSec) }; Start-Sleep -Seconds 5; $waited += 5; if ($waited -gt 3600) { Fail 'the PC was in use for an hour; giving up this call' } }
}
Show-App
Wake-Tree
for ($k = 0; $k -lt 4; $k++) {
  $left = Find-Dialog
  if (-not $left) { break }
  Log ("closing a leftover dialog '{0}'" -f $left.Current.Name)
  $dh = [IntPtr]$left.Current.NativeWindowHandle; if ($dh -ne [IntPtr]::Zero) { [Win32]::SetForegroundWindow($dh) | Out-Null; Start-Sleep -Milliseconds 200 }
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 800
}
if ($DebugTree) { foreach ($e in $win.FindAll($scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) { $c = $e.Current; if ($c.Name) { Log ("  {0} '{1}'" -f ($c.ControlType.ProgrammaticName -replace '^ControlType\.', ''), $c.Name.Substring(0, [Math]::Min(70, $c.Name.Length))) } } }

# ---- the chat: a new one, or the one the previous call left open (-SameChat), checked by title when known
function Current-Title { try { $d = Find-All $win $CT::Document '' $false; if ($d.Count) { return $d[0].Current.Name } } catch {}; return '' }
if ($SameChat -and $ExpectChat) {
  $t = Current-Title
  if ($t -ne $ExpectChat) {
    Log ("the open chat is '{0}', expected '{1}'; opening it from the sidebar" -f $t, $ExpectChat)
    $btn = Find-All $win $CT::Button $ExpectChat
    if (-not $btn.Count) { Fail "chat '$ExpectChat' is not in the sidebar" }
    Invoke-El $btn[0]
    $ok = Wait-For 'expected chat' { if ((Current-Title) -eq $ExpectChat) { $true } } 15
    if (-not $ok) { Fail "could not open chat '$ExpectChat'" }
  }
}
if (-not $SameChat) {
  $nc = (Find-All $win $CT::Button 'New chat')
  if (-not $nc.Count) { Fail 'no "New chat" button' }
  Invoke-El $nc[0]
  $ok = Wait-For 'empty chat' { if ((Count-Copy) -eq 0) { $true } } 15
  if (-not $ok) { Fail 'the new chat still shows messages' }
  Log 'new chat'
}
# the composer keeps its draft across "New chat": drop leftover attachments and text (a failed attempt's, or the user's)
$leftover = Find-All $win $CT::Button '^Remove ' $false
if ($leftover.Count) { Log ("removing {0} leftover attachment(s)" -f $leftover.Count); foreach ($b in $leftover) { try { Invoke-El $b; Start-Sleep -Milliseconds 200 } catch {} }; Start-Sleep -Milliseconds 500 }
$composer0 = Wait-For 'composer' { $e = Find-All $win $CT::Edit 'Message ChatGPT'; if (-not $e.Count) { $e = @($win.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Edit))) | Where-Object { $_.Current.ClassName -eq 'ProseMirror' }) }; if ($e.Count) { $e[0] } } 10
if ($composer0) { $v0 = ''; try { $v0 = $composer0.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {}; if ($v0.Trim() -and $v0.Trim() -ne 'Message ChatGPT') { Show-App; $composer0.SetFocus(); Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('^a{DEL}'); Start-Sleep -Milliseconds 300; Log 'cleared leftover text' } }
$copiesBefore = Count-Copy

# ---- attachments, through the app's own Open dialog (files are copied into one folder: the dialog's
# multi-select syntax is "a" "b" relative to one folder)
if ($Files.Count) {
  $outDir = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($OutFile))
  $stage = Join-Path $outDir ('attach-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  $names = @()
  foreach ($f in $Files) { $src = (Resolve-Path $f).Path; $dst = Join-Path $stage ([System.IO.Path]::GetFileName($src)); Copy-Item $src $dst -Force; $names += ('"' + [System.IO.Path]::GetFileName($src) + '"') }
  # the composer re-renders after "New chat": look the button up right before the click, and again if it went stale
  $item = $null
  for ($try = 1; $try -le 3 -and -not $item; $try++) {
    $add = Wait-For 'add button' { $b = Find-All $win $CT::Button 'Add files and more'; if ($b.Count -and $b[0].Current.BoundingRectangle.Width -gt 0) { $b[0] } } 10
    if (-not $add) { Fail 'no "Add files and more" button' }
    try { Click-El $add } catch { Log "click on the add button failed ($($_.Exception.Message)); retrying"; Start-Sleep -Milliseconds 700; continue }
    $item = Wait-For 'menu' { $m = Find-All $win $CT::MenuItem 'Add photos & files'; if (-not $m.Count) { $m = Find-All $win $CT::MenuItem '^Add (photos|files)' $false }; if (-not $m.Count) { $m = Find-All $win $CT::Button '^Add (photos|files)' $false }; if ($m.Count) { $m[0] } } 6
  }
  if (-not $item) { Fail 'no "Add photos & files" menu item' }
  # a Radix menu item reacts to a pointer click only now and then; hovering it and pressing Enter is reliable
  $r = $item.Current.BoundingRectangle
  [Win32]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null; Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  $dlg = Wait-For 'open dialog' { Find-Dialog } 8
  if (-not $dlg) { Log 'no dialog after Enter; clicking the item'; Click-El $item; $dlg = Wait-For 'open dialog' { Find-Dialog } 12 }
  if (-not $dlg) { Fail 'the Open dialog did not appear' }
  # the dialog is modal and in front: Alt+N focuses its file-name box whatever the mouse did (a UIA SetValue on that
  # box times out, and a click there raced the dialog's layout: Ctrl+A then landed in the file list and Enter attached
  # every file of the folder it opened in)
  $dh = [IntPtr]$dlg.Current.NativeWindowHandle
  if ($dh -ne [IntPtr]::Zero) { [Win32]::SetForegroundWindow($dh) | Out-Null; Start-Sleep -Milliseconds 300 }
  $typeInto = { param($t) [System.Windows.Forms.SendKeys]::SendWait('%n'); Start-Sleep -Milliseconds 250; [System.Windows.Forms.SendKeys]::SendWait('{HOME}+{END}'); Start-Sleep -Milliseconds 100; [System.Windows.Forms.Clipboard]::SetText($t); [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
  & $typeInto $stage            # navigate to the staging folder (it holds exactly the files to attach)
  Start-Sleep -Milliseconds 1200
  if ($Files.Count -le 8) {
    & $typeInto ($names -join ' ')   # the quoted names (the box takes ~260 characters: enough for a handful)
  } else {
    # many files: select everything in the folder from the file list (click the first item, Ctrl+A, Open)
    $first = [System.IO.Path]::GetFileName($Files[0])
    $item0 = Wait-For 'first file in the list' { $dlg2 = Find-Dialog; if ($dlg2) { $dlg = $dlg2 }; $li = Find-All $dlg $CT::ListItem $first; if (-not $li.Count) { $li = Find-All $dlg $CT::ListItem ('^' + [regex]::Escape($first)) $false }; if ($li.Count -and $li[0].Current.BoundingRectangle.Width -gt 0) { $li[0] } } 10
    if (-not $item0) { Fail "the file list does not show $first" }
    Click-El $item0; Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait('%o')
  }
  $gone = Wait-For 'dialog closed' { if (-not (Find-Dialog)) { $true } } 20
  if (-not $gone) { Fail 'the Open dialog stayed open (file names refused?)' }
  # wait until the chips are in the composer and no upload is in flight
  $attached = Wait-For 'attachments' {
    $chips = 0
    foreach ($f in $Files) { $n = [System.IO.Path]::GetFileName($f); if ((Find-All $win $CT::Text $n).Count -or (Find-All $win $CT::Button ("^Remove " + [regex]::Escape($n)) $false).Count -or (Find-All $win $CT::Image $n).Count) { $chips++ } }
    if ($chips -ge $Files.Count) { $true }
  } 25
  if (-not $attached) { Log 'attachment chips not all found by name; continuing after a pause' }
  Start-Sleep -Seconds ([Math]::Min(20, 2 + 2 * $Files.Count))
  Log ("attached {0} file(s)" -f $Files.Count)
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}

# ---- the prompt: pasted (the composer is a ProseMirror editor; a UIA SetValue does not reach it)
$promptText = [System.IO.File]::ReadAllText($PromptFile)
$composer = Wait-For 'composer' { $e = Find-All $win $CT::Edit 'Message ChatGPT'; if (-not $e.Count) { $e = @($win.FindAll($scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Edit))) | Where-Object { $_.Current.ClassName -eq 'ProseMirror' }) }; if ($e.Count) { $e[0] } } 10
if (-not $composer) { Fail 'no composer' }
Show-App
$composer.SetFocus(); Start-Sleep -Milliseconds 300
# a single paste of 10,000+ characters becomes a "Pasted text.txt" attachment (measured: 8,000 stays inline, 10,000
# does not); pasted in chunks under that, the text accumulates inline (24k measured)
$normalised = $promptText -replace "`r`n", "`n"
$chunks = @(); $pos = 0; $LIMIT = 7500
while ($pos -lt $normalised.Length) {
  $len = [Math]::Min($LIMIT, $normalised.Length - $pos)
  if ($pos + $len -lt $normalised.Length) { $cut = $normalised.LastIndexOf("`n", $pos + $len - 1, $len); if ($cut -gt $pos + 1000) { $len = $cut - $pos + 1 } }
  $chunks += $normalised.Substring($pos, $len); $pos += $len
}
foreach ($chunk in $chunks) { [System.Windows.Forms.Clipboard]::SetText($chunk); [System.Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds ([Math]::Max(500, [Math]::Min(2000, $chunk.Length / 8))) }
Start-Sleep -Milliseconds 500
$typed = Wait-For 'prompt in composer' { try { $v = $composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value; if ($v.Length -ge $normalised.Length * 0.9) { $true } } catch {} } 15
if (-not $typed) { $vlen = -1; try { $vlen = $composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value.Length } catch {}; Fail ("the prompt did not land in the composer ({0} of {1} characters, {2} chunk(s))" -f $vlen, $normalised.Length, $chunks.Count) }
Log ("prompt pasted: {0} characters in {1} chunk(s)" -f $normalised.Length, $chunks.Count)
$send = Wait-For 'send button' { $b = Find-All $win $CT::Button 'Send'; if ($b.Count -and $b[0].Current.IsEnabled) { $b[0] } } 30
if (-not $send) { Fail 'the Send button never enabled (uploads still running?)' }
Invoke-El $send
$sentAt = Get-Date
Log 'sent'

# ---- wait for the reply: a new assistant "Copy" button and "Regenerate response" present, no "Stop"
$done = Wait-For 'reply' {
  if ((Find-All $win $CT::Button '^(Stop|Stop streaming|Stop generating)$' $false).Count) { return $null }
  # the app sometimes offers to hand the task to its "Work" mode instead of answering: stay in chat
  $stay = Find-All $win $CT::Button 'Stay in Chat'
  if ($stay.Count) { Log 'the app offered Work mode; staying in chat'; try { Invoke-El $stay[0] } catch {}; Start-Sleep -Seconds 2; return $null }
  $regen = Find-All $win $CT::Button 'Regenerate response'
  if ($regen.Count -and (Count-Copy) -gt $copiesBefore) { return $true }
  $err = Find-All $win $CT::Text '(Something went wrong|error generating|Too many requests|reached your|limit)' $false
  if ($err.Count) { return 'error:' + $err[0].Current.Name }
} $TimeoutSec
if (-not $done) { Fail "no reply within $TimeoutSec s" }
if ("$done" -like 'error:*') { Fail ("the app reported: " + "$done".Substring(6)) }
$seconds = [int]((Get-Date) - $sentAt).TotalSeconds
# ---- copy the last reply
$copies = Find-All $win $CT::Button 'Copy'
try { [System.Windows.Forms.Clipboard]::Clear() } catch {}
Invoke-El $copies[$copies.Count - 1]
Start-Sleep -Milliseconds 600
$text = Wait-For 'clipboard' { try { $t = [System.Windows.Forms.Clipboard]::GetText(); if ($t.Length -gt 0) { $t } } catch { $null } } 15
if (-not $text) { Fail 'the Copy button put nothing on the clipboard' }
[System.IO.File]::WriteAllText($OutFile, $text, (New-Object System.Text.UTF8Encoding($false)))
$title = ''
try { $doc = Find-All $win $CT::Document '' $false; if ($doc.Count) { $title = $doc[0].Current.Name } } catch {}
Log ("reply: {0} chars in {1}s (chat '{2}')" -f $text.Length, $seconds, $title)
Write-Output (@{ ok = $true; chars = $text.Length; replySeconds = $seconds; seconds = [int]((Get-Date) - $started).TotalSeconds; chat = $title; files = $Files.Count } | ConvertTo-Json -Compress)
