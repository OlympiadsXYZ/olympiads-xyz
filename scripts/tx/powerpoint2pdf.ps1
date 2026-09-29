param([Parameter(Mandatory=$true)][string]$In, [Parameter(Mandatory=$true)][string]$Out)
$ErrorActionPreference = 'Stop'
$inputFile = (Resolve-Path -LiteralPath $In).Path
$outputFile = [System.IO.Path]::GetFullPath($Out)
$app = $null
$deck = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  $app.AutomationSecurity = 3
  $app.DisplayAlerts = 1
  # Read only, never start the slideshow, no visible window.
  $deck = $app.Presentations.Open($inputFile, -1, 0, 0)
  # All slides including hidden slides, slide-sized pages, no handouts.
  # https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentation.exportasfixedformat
  $range = $deck.PrintOptions.Ranges.Add(1, $deck.Slides.Count)
  $deck.ExportAsFixedFormat($outputFile, 2, 2, 0, 1, 1, -1, $range, 4)
  if (-not (Test-Path -LiteralPath $outputFile)) { throw 'PowerPoint wrote no PDF' }
} finally {
  if ($deck) { try { $deck.Close() } catch {} }
  if ($app) { try { $app.Quit() } catch {} }
}
