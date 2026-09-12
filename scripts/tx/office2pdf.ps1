# office2pdf.ps1 -In <file.doc|.docx|.rtf|.odt> -Out <file.pdf>
# Converts a Word document to PDF through the installed Microsoft Word (COM automation).
# Used by index.mjs (and prepare.mjs) for the archive's Word files, which poppler cannot
# read. Runs Word invisibly, never prompts, and exits non-zero when Word is missing.
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'
$inPath = (Resolve-Path -LiteralPath $In).Path
$outDir = Split-Path -Parent $Out
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$outPath = [System.IO.Path]::GetFullPath($Out)
$word = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  # Open read-only, no conversion dialog, no macros (msoAutomationSecurityForceDisable = 3)
  $word.AutomationSecurity = 3
  $doc = $word.Documents.Open($inPath, $false, $true, $false)
  # wdExportFormatPDF = 17
  $doc.ExportAsFixedFormat($outPath, 17)
  $doc.Close(0)
  if (-not (Test-Path -LiteralPath $outPath)) { throw "Word wrote no PDF for $inPath" }
  Write-Output $outPath
} finally {
  if ($word) { try { $word.Quit() } catch {} }
}
