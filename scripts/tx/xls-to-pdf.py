"""Bounded BIFF8 value/chart workbook support, with native Excel rendering.

Reject executable/refreshable/unknown records before Excel opens the file. Formula
cells and defined names remain unsupported; source values are checked before and
again after native export. The existing XLSX renderer is unchanged.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import struct

RENDERER = 'excel-biff8-values-v1'
# MS-XLS records used by static worksheet/chart files. This deliberately excludes
# Formula, Name, ExternName, FilePass, queries, connection records and macros.
SAFE = {int(x,16) for x in '''809 e1 c1 e2 5c 42 161 1c0 13d 9c 19 12 13 1af 1bc
3d 40 8d 22 e 1b7 da 31 41e e0 293 160 85 8c 1ae 17 1c1 eb fc ff 863 a 20b d c f
11 10 5f 2a 2b 82 80 225 81 14 15 83 84 a1 55 7d 200 208 fd 203 d7 ec 5d 33 1060
1001 1002 1033 a0 1064 1032 1007 100a 1034 1003 1051 1006 105f 1045 1044 1024 1025
104f 1026 1046 1041 101d 101f 101e 1021 1035 1014 101b 1022 100b 105d 1009 1065 23e
1d ef 3c bd be 27e 201 205 204 26 27 28 29 92 18c'''.split()}


def records(data):
    offset = 0
    while offset < len(data):
        if len(data) - offset < 4: raise ValueError('Truncated BIFF header')
        code, size = struct.unpack_from('<HH', data, offset)
        if offset + 4 + size > len(data): raise ValueError('Truncated BIFF record')
        yield code, data[offset+4:offset+4+size]
        offset += 4 + size


def preflight(data):
    charts = 0
    for code, raw in records(data):
        if code not in SAFE: raise ValueError(f'Unsupported XLS record 0x{code:04x}; formulas/names/refreshable content are not supported')
        if code == 0x809:
            version, kind = struct.unpack_from('<HH', raw)
            if version != 0x600 or kind not in (5,16,32): raise ValueError('Only BIFF8 workbook, worksheet and chart substreams supported')
            charts += kind == 32
        if code == 0x85 and (len(raw)<8 or raw[5] != 0): raise ValueError('Only worksheet-bound sheets supported; macro/chart sheets rejected')
        # MS-XLS 2.4.271: cch 0x0401 denotes self-referencing supporting link.
        if code == 0x1ae and (len(raw)!=4 or struct.unpack_from('<H',raw,2)[0] != 0x401): raise ValueError('External/add-in/OLE/DDE supporting link rejected')
        if code == 0x1b7 and (len(raw)!=2 or struct.unpack('<H',raw)[0]): raise ValueError('RefreshAll enabled')
        if code == 0x5d:
            # Only static charts (FtCmo object type 5) with no assigned macro.
            parts = list(records(raw))
            if not parts or parts[0][0] != 0x15 or len(parts[0][1])<2 or struct.unpack_from('<H',parts[0][1])[0] != 5: raise ValueError('Only chart objects supported')
            if any(ft not in (0x15,0) for ft,_ in parts): raise ValueError('Chart object has unsupported subrecords')
    return charts


def inventory(path):
    import xlrd
    import xlrd.compdoc
    if Path(path).stat().st_size > 64*1024*1024: raise ValueError("Workbook exceeds 64 MiB bound")
    binary = Path(path).read_bytes()
    if not binary.startswith(bytes.fromhex('D0CF11E0A1B11AE1')): raise ValueError('Source must be a real OLE BIFF8 .xls file')
    compound = xlrd.compdoc.CompDoc(binary)
    allowed = {'Root Entry','Workbook','\x05SummaryInformation','\x05DocumentSummaryInformation'}
    entries = [e for e in compound.dirlist if e.etype]
    if any(e.name not in allowed or (e.name != 'Root Entry' and e.etype != 2) for e in entries): raise ValueError('Unsupported OLE streams/storage; VBA/embedded/connection content rejected')
    stream = compound.get_named_stream('Workbook')
    if stream is None: raise ValueError('Missing BIFF8 Workbook stream')
    charts = preflight(stream)
    book = xlrd.open_workbook(file_contents=binary, formatting_info=True)
    if book.biff_version != 80: raise ValueError('Only BIFF8 is supported')
    if book.nsheets > 64: raise ValueError('Too many sheets')
    sheets = []
    for sheet in book.sheets():
        if sheet.nrows * sheet.ncols > 200000: raise ValueError("Worksheet exceeds 200000-cell bound")
        cells = []
        for row in range(sheet.nrows):
            for col in range(sheet.ncols):
                cell = sheet.cell(row,col)
                if cell.ctype in (xlrd.XL_CELL_EMPTY,xlrd.XL_CELL_BLANK): continue
                kind = {xlrd.XL_CELL_TEXT:'str',xlrd.XL_CELL_NUMBER:'n',xlrd.XL_CELL_DATE:'n',xlrd.XL_CELL_BOOLEAN:'b',xlrd.XL_CELL_ERROR:'e'}.get(cell.ctype)
                if kind is None: raise ValueError('Unsupported cell kind')
                value = xlrd.error_text_from_code[cell.value] if kind=='e' else bool(cell.value) if kind=='b' else cell.value
                cells.append({'address':xlrd.cellname(row,col),'type':kind,'cachedValue':value})
        sheets.append({'name':sheet.name,'state':'visible' if sheet.visibility==0 else 'hidden','kind':'worksheet',
                       'nonEmptyCells':[c['address'] for c in cells],
                       'formulas':cells, # Existing native helper checks these addresses, whether formula or literal.
                       'valueVerificationScope':'all nonempty source cells; formula records rejected',
                       'hiddenRows':[str(r+1) for r,v in sheet.rowinfo_map.items() if v.hidden],
                       'hiddenColumns':[str(c+1) for c,v in sheet.colinfo_map.items() if v.hidden]})
    import hashlib
    return {'sourceSha256':hashlib.sha256(binary).hexdigest(),'biffVersion':80,'sheets':sheets,
            'chartParts':[f'biff-chart-{i+1}' for i in range(charts)],'definedNames':[],
            'calculationProperties':{'sourceFormulaRecords':0},'preflight':'allowlisted BIFF8 static value/chart records; no macro/external/refreshable sources'}


def convert(source, output):
    spec = importlib.util.spec_from_file_location('native_xlsx', Path(__file__).with_name('xlsx-to-pdf.py'))
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    native.inventory = inventory
    native.RENDERER = RENDERER
    result = native.convert(source, output)
    result['from'] = 'xls'
    result['calculation'] = 'manual; every nonempty source value verified before and after export; formula records rejected'
    return result


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('output',nargs='?');parser.add_argument('--inventory',action='store_true');args=parser.parse_args()
    try: print(json.dumps(inventory(args.source) if args.inventory else convert(args.source,args.output),ensure_ascii=True))
    except Exception as error: parser.exit(1,str(error)+'\n')
