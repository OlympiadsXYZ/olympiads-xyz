param(
  [Parameter(Mandatory=$true)][string]$In,
  [Parameter(Mandatory=$true)][string]$Directory,
  [Parameter(Mandatory=$true)][string]$Inventory
)
$ErrorActionPreference = 'Stop'
$excel = $null; $book = $null; $seed = $null; $ownsInstance = $false
$source = Get-Content -LiteralPath $Inventory -Raw -Encoding UTF8 | ConvertFrom-Json
function Read-FormulaValues($workbook, $inventory) {
  foreach ($sheetInfo in $inventory.sheets) {
    if ($sheetInfo.formulas.Count -eq 0) { continue }
    $worksheet = $workbook.Worksheets.Item($sheetInfo.name)
    foreach ($formula in $sheetInfo.formulas) {
      $cell = $worksheet.Range($formula.address)
      [ordered]@{sheet=$sheetInfo.name;address=$formula.address;value=$cell.Value2;text=$cell.Text}
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($cell)
    }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($worksheet)
  }
}
try {
  # Create an isolated instance; never attach to a user's running workbook.
  $excel = New-Object -ComObject Excel.Application
  if ($excel.Workbooks.Count -ne 0) { throw 'Refusing nonempty Excel instance' }
  $ownsInstance = $true
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AutomationSecurity = 3
  $excel.AskToUpdateLinks = $false
  # Excel needs an open workbook before Calculation can be set. Keep this blank
  # workbook open so the source cannot impose automatic calculation on first open.
  $seed = $excel.Workbooks.Add()
  $excel.Calculation = -4135
  $excel.CalculateBeforeSave = $false
  $book = $excel.Workbooks.Open([IO.Path]::GetFullPath($In),0,$true,[Type]::Missing,'','',$true,[Type]::Missing,[Type]::Missing,$false,$false,[Type]::Missing,$false)
  if (-not $book.ReadOnly -or $excel.Calculation -ne -4135) { throw 'Read-only/manual-calculation contract failed' }
  if ($book.Connections.Count -ne 0) { throw 'Unexpected workbook connections' }
  $before = @(Read-FormulaValues $book $source)
  $sheets = @(); $charts = @(); $pageCursor = 1
  for ($i = 1; $i -le $book.Sheets.Count; $i++) {
    $sheet = $book.Sheets.Item($i)
    $sourceSheet = $source.sheets[$i - 1]
    $visible = $sheet.Visible -eq -1
    $count = 0
    if ($visible) { $count = [int]$sheet.PageSetup.Pages.Count }
    $entry = [ordered]@{index=$i;name=$sheet.Name;visible=$visible;kind=$sourceSheet.kind;nativePageCount=$count;firstPage=$null;lastPage=$null;printArea=$null;orientation=$sheet.PageSetup.Orientation;paperSize=$sheet.PageSetup.PaperSize;zoom=$sheet.PageSetup.Zoom;fitToPagesWide=$sheet.PageSetup.FitToPagesWide;fitToPagesTall=$sheet.PageSetup.FitToPagesTall}
    if ($visible -and $count -gt 0) { $entry.firstPage=$pageCursor; $entry.lastPage=$pageCursor+$count-1; $pageCursor += $count }
    if ($sourceSheet.kind -eq 'worksheet') {
      $entry.printArea = $sheet.PageSetup.PrintArea
      $entry.usedRange = $sheet.UsedRange.Address()
      $outside = @()
      if ($entry.printArea) {
        $printRange = $sheet.Range($entry.printArea)
        foreach ($address in $sourceSheet.nonEmptyCells) {
          $cell = $sheet.Range($address)
          $inside = $false
          foreach ($area in $printRange.Areas) {
            if ($cell.Row -ge $area.Row -and $cell.Row -lt ($area.Row + $area.Rows.Count) -and $cell.Column -ge $area.Column -and $cell.Column -lt ($area.Column + $area.Columns.Count)) { $inside = $true }
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($area)
          }
          if (-not $inside) { $outside += $address }
          [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($cell)
        }
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($printRange)
      }
      $entry.cellsOutsidePrintArea = @($outside)
      $entry.omittedContent = @()
      if (-not $visible) { $entry.omittedContent += 'hidden sheet' }
      if ($outside.Count -gt 0) { $entry.omittedContent += 'nonempty cells outside print area' }
      if ($sourceSheet.hiddenRows.Count -gt 0) { $entry.omittedContent += 'hidden rows' }
      if ($sourceSheet.hiddenColumns.Count -gt 0) { $entry.omittedContent += 'hidden columns' }
      $objects = $sheet.ChartObjects()
      for ($j=1; $j -le $objects.Count; $j++) {
        $object = $objects.Item($j)
        $charts += [ordered]@{sheet=$sheet.Name;sheetIndex=$i;chartIndex=$j;kind='embedded';name=$object.Name;left=$object.Left;top=$object.Top;width=$object.Width;height=$object.Height;visible=[bool]$object.Visible;printObject=[bool]$object.PrintObject;appendixEligible=($visible -and [bool]$object.Visible);pdf=$null}
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object)
      }
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($objects)
    } else {
      $charts += [ordered]@{sheet=$sheet.Name;sheetIndex=$i;chartIndex=1;kind='chartsheet';name=$sheet.Name;visible=$visible;appendixEligible=$false;pdf=$null}
      $entry.omittedContent = @()
      if (-not $visible) { $entry.omittedContent += 'hidden chart sheet' }
    }
    $sheets += $entry
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)
  }
  # Preserve source PageSetup and print areas. No scaling or sheet visibility edits.
  $book.ExportAsFixedFormat(0,(Join-Path $Directory 'workbook.pdf'),0,$false,$false,[Type]::Missing,[Type]::Missing,$false)
  foreach ($chart in $charts) {
    if (-not $chart.appendixEligible) { continue }
    $sheet = $book.Worksheets.Item($chart.sheet)
    $object = $sheet.ChartObjects().Item($chart.chartIndex)
    # Activate is essential: without it Excel exports the whole sheet instead.
    [void]$object.Activate()
    $chart.pdf = 'chart-{0}-{1}.pdf' -f $chart.sheetIndex,$chart.chartIndex
    $object.Chart.ExportAsFixedFormat(0,(Join-Path $Directory $chart.pdf),0,$false,$false,[Type]::Missing,[Type]::Missing,$false)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)
  }
  $after = @(Read-FormulaValues $book $source)
  [ordered]@{excelVersion=$excel.Version;excelBuild=$excel.Build;calculation=$excel.Calculation;sourceReadOnly=$book.ReadOnly;updateLinks=0;includeDocumentProperties=$false;sheets=@($sheets);charts=@($charts);formulaValuesBefore=@($before);formulaValuesAfter=@($after)} | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $Directory 'native.json') -Encoding UTF8
} finally {
  if ($book) { $book.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) }
  if ($seed) { $seed.Close($false); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($seed) }
  if ($excel) {
    if ($ownsInstance) { $excel.Quit() }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
  }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
