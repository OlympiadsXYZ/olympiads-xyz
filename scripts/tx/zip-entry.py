"""Read one explicitly named passive document from an archive; never extract paths."""
import hashlib
import json
import pathlib
import stat
import sys
import zipfile

archive, entry = sys.argv[1:3]
parts = entry.split('/')
if not entry or '\\' in entry or any(p in ('', '.', '..') for p in parts) or ':' in entry:
    sys.exit('unsafe archive entry')
if pathlib.PurePosixPath(entry).suffix.lower() not in ('.pdf', '.docx'):
    sys.exit('only PDF and DOCX archive entries are supported')
with zipfile.ZipFile(archive) as z:
    matches = [i for i in z.infolist() if i.filename == entry]
    if len(matches) != 1:
        sys.exit('archive entry must occur exactly once')
    info = matches[0]
    mode = info.external_attr >> 16
    if info.is_dir() or info.flag_bits & 1 or (stat.S_IFMT(mode) and not stat.S_ISREG(mode)):
        sys.exit('encrypted or nonregular archive entry')
    if info.file_size > 64 * 1024 * 1024:
        sys.exit('archive entry exceeds 64 MiB limit')
    data = z.read(info)
    if len(data) != info.file_size:
        sys.exit('archive entry size mismatch')
    if entry.lower().endswith('.pdf') and not data.startswith(b'%PDF-'):
        sys.exit('archive entry is not a PDF')
    if entry.lower().endswith('.docx') and not data.startswith(b'PK'):
        sys.exit('archive entry is not a DOCX package')
    if len(sys.argv) > 3:
        pathlib.Path(sys.argv[3]).write_bytes(data)
    print(json.dumps({'entry': entry, 'entrySha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}))
