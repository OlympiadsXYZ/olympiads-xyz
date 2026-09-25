"""Native Excel rendering; retains original bytes, caches, print layout and provenance."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import posixpath
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

RENDERER = 'excel-fixed-format-v1'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def inventory(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        # Reject refreshable or executable workbooks before Excel sees them. UpdateLinks=0
        # alone does not suppress every connection's refresh-on-open behavior.
        forbidden = [n for n in names if any(x in n.lower() for x in
                     ('externallinks/', 'connections.xml', 'querytables/', 'vbaproject', 'macrosheets/'))]
        if forbidden:
            raise ValueError('Workbook requires unsupported external/macro handling: ' + ', '.join(forbidden))
        workbook = ET.fromstring(z.read('xl/workbook.xml'))
        rels = {r.get('Id'): posixpath.normpath(posixpath.join('xl', r.get('Target').lstrip('/')))
                if not r.get('Target').startswith('/') else r.get('Target').lstrip('/')
                for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        strings = []
        if 'xl/sharedStrings.xml' in names:
            strings = [''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        sheets = []
        for sheet in workbook.findall('s:sheets/s:sheet', NS):
            part = rels[sheet.get(REL)]
            root = ET.fromstring(z.read(part))
            cells = root.findall('.//s:sheetData/s:row/s:c', NS)
            formulas = []
            for c in cells:
                if c.find('s:f', NS) is None:
                    continue
                value = c.find('s:v', NS)
                kind = c.get('t', 'n')
                if value is None or (value.text is None and kind != 'str'):
                    raise ValueError(f'Missing cached formula value: {sheet.get("name")}!{c.get("r")}')
                val = value.text or ''
                if kind == 's': val = strings[int(val)]
                elif kind == 'b': val = val == '1'
                elif kind == 'n': val = float(val)
                formulas.append({'address': c.get('r'), 'type': kind, 'cachedValue': val})
            sheets.append({'name': sheet.get('name'), 'state': sheet.get('state', 'visible'),
                           'part': part, 'kind': 'worksheet' if root.tag.endswith('}worksheet') else 'chartsheet',
                           'nonEmptyCells': [c.get('r') for c in cells if c.find('s:v', NS) is not None or c.find('s:is', NS) is not None or c.find('s:f', NS) is not None],
                           'formulas': formulas,
                           'hiddenRows': [r.get('r') for r in root.findall('s:sheetData/s:row', NS) if r.get('hidden') == '1'],
                           'hiddenColumns': [dict(c.attrib) for c in root.findall('s:cols/s:col', NS) if c.get('hidden') == '1']})
        return {'sourceSha256': digest(path), 'sheets': sheets,
                'chartParts': [n for n in names if n.startswith('xl/charts/chart') and n.endswith('.xml')],
                'definedNames': [{'name': n.get('name'), 'localSheetId': n.get('localSheetId'), 'value': n.text}
                                 for n in workbook.findall('s:definedNames/s:definedName', NS)],
                'calculationProperties': dict(workbook.find('s:calcPr', NS).attrib) if workbook.find('s:calcPr', NS) is not None else {}}


def check_values(source, actual):
    expected = {(s['name'], f['address']): f for s in source['sheets'] for f in s['formulas']}
    observed = {(s['sheet'], s['address']): s for s in actual}
    if set(expected) != set(observed):
        raise ValueError('Native formula coverage does not match workbook inventory')
    for key, f in expected.items():
        a = observed[key]
        value = a['text'] if f['type'] == 'e' else a['value']
        same = math.isclose(value, f['cachedValue'], rel_tol=1e-13, abs_tol=1e-13) if f['type'] == 'n' and isinstance(value, (int, float)) else value == f['cachedValue']
        if not same:
            raise ValueError(f'Excel changed cached formula value at {key[0]}!{key[1]}')


def convert(source, output):
    import fitz
    if os.name != 'nt':
        raise RuntimeError('XLSX conversion requires installed Microsoft Excel on Windows; no lossy fallback')
    original = inventory(source)
    with tempfile.TemporaryDirectory(prefix='olympiads-excel-') as temp:
        folder = Path(temp)
        input_json = folder / 'inventory.json'
        input_json.write_text(json.dumps(original, ensure_ascii=False), encoding='utf-8')
        command = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(Path(__file__).with_name('excel2pdf.ps1')),
                   '-In', str(Path(source).resolve()), '-Directory', str(folder), '-Inventory', str(input_json)]
        result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if result.returncode:
            raise RuntimeError('Native Excel export failed: ' + (result.stderr or result.stdout)[-2000:])
        native = json.loads((folder / 'native.json').read_text(encoding='utf-8-sig'))
        native['pdfSha256'] = digest(folder / 'workbook.pdf')
        check_values(original, native.pop('formulaValuesBefore'))
        check_values(original, native.pop('formulaValuesAfter'))
        if digest(source) != original['sourceSha256']:
            raise ValueError('Source workbook changed during native export')
        pdf = fitz.open(folder / 'workbook.pdf')
        native_pages = len(pdf)
        if len(native['charts']) != len(original['chartParts']):
            raise ValueError('Native chart inventory does not cover every source chart part')
        if sum(s['nativePageCount'] for s in native['sheets'] if s['visible']) != native_pages:
            raise ValueError('Native workbook page count does not match per-sheet inventory')
        appendices = []
        for chart in native['charts']:
            if not chart.get('pdf'): continue
            chart_pdf = fitz.open(folder / chart.pop('pdf'))
            first = len(pdf) + 1
            for source_page in chart_pdf:
                page = pdf.new_page(width=source_page.rect.width, height=source_page.rect.height + 36)
                page.show_pdf_page(fitz.Rect(0, 36, source_page.rect.width, source_page.rect.height + 36), chart_pdf, source_page.number)
                # A derived-render label, not a source caption. Unicode names stay in JSON/bookmarks.
                label = f'Derived chart appendix | sheet {chart["sheetIndex"]}, chart {chart["chartIndex"]}'
                page.insert_text((18, 23), label, fontsize=9)
            appendices.append({'sheet': chart['sheet'], 'chart': chart['name'], 'firstPage': first, 'lastPage': len(pdf), 'sourceSha256': original['sourceSha256']})
            chart_pdf.close()
        pdf.set_metadata({'producer': 'olympiads-xyz / native Microsoft Excel PDF + chart appendices', 'creator': RENDERER})
        toc = [[1, 'Native workbook print pages', 1]]
        toc += [[1, f'Derived chart: {a["sheet"]} / {a["chart"]}', a['firstPage']] for a in appendices]
        pdf.set_toc(toc)
        temp_output = folder / 'assembled.pdf'
        pdf.save(temp_output, garbage=4, deflate=True)
        pages = len(pdf)
        pdf.close()
        with fitz.open(temp_output) as verified:
            if len(verified) != pages: raise ValueError('Assembled PDF verification failed')
        Path(output).write_bytes(temp_output.read_bytes())
        return {'from': 'xlsx', 'renderer': RENDERER, 'sourceSha256': original['sourceSha256'],
                'pdfSha256': digest(output), 'nativePrintPages': native_pages, 'pages': pages,
                'calculation': 'manual; cached formula values verified before and after export',
                'workbook': original, 'native': native, 'chartAppendices': appendices}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output', nargs='?')
    parser.add_argument('--inventory', action='store_true')
    args = parser.parse_args()
    try:
        answer = inventory(args.source) if args.inventory else convert(args.source, args.output)
        print(json.dumps(answer, ensure_ascii=True))
    except Exception as error:
        parser.exit(1, str(error) + '\n')
