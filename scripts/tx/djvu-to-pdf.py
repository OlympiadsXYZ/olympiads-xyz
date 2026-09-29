"""Decode every DjVu page with DjVuLibre and retain exact input/hash/page mapping."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def wsl_path(p):
    return subprocess.check_output(['wsl.exe', '--exec', 'wslpath', '-a', str(Path(p).resolve()).replace('\\', '/')], text=True).strip()

def command(tool, *args):
    native = shutil.which(tool)
    if native: return [native, *map(str, args)]
    runtime = os.environ.get('OLYMPIADS_DJVU_WSL_ROOT')
    if os.name == 'nt' and runtime:
        # Caller provisions DjVuLibre from a trusted package manager; never install automatically.
        root = wsl_path(runtime)
        values = [wsl_path(x) if isinstance(x, Path) else str(x) for x in args]
        return ['wsl.exe', '--exec', 'env', 'LD_LIBRARY_PATH=' + root + '/usr/lib/x86_64-linux-gnu', root + '/usr/bin/' + tool, *values]
    raise RuntimeError('DjVuLibre is required; set OLYMPIADS_DJVU_WSL_ROOT to an existing portable runtime on Windows')

def convert(source, output):
    import fitz
    from PIL import Image
    source, output = Path(source).resolve(), Path(output).resolve()
    before = digest(source)
    count = int(subprocess.check_output(command('djvused', source, '-e', 'n'), text=True).strip())
    if count < 1: raise ValueError('DjVu has no pages')
    pages = []
    pdf = fitz.open()
    with tempfile.TemporaryDirectory(prefix='olympiads-djvu-') as temp:
        for i in range(1, count + 1):
            image = Path(temp) / ('page-%d.tiff' % i)
            subprocess.run(command('ddjvu', '-format=tiff', '-page=%d' % i, source, image), check=True, capture_output=True)
            with Image.open(image) as im:
                im.load()
                width, height = im.size
                dpi = im.info.get('dpi', (300, 300))
                dx, dy = float(dpi[0]), float(dpi[1])
                if dx <= 0 or dy <= 0: raise ValueError('Invalid DjVu page resolution')
                pixels = io.BytesIO()
                im.save(pixels, format='PNG')
                page = pdf.new_page(width=width * 72 / dx, height=height * 72 / dy)
                page.insert_image(page.rect, stream=pixels.getvalue())
                pages.append({'page': i, 'sourcePage': i, 'widthPx': width, 'heightPx': height, 'dpiX': dx, 'dpiY': dy})
        pdf.set_metadata({'producer': 'DjVuLibre lossless page decode', 'title': source.name})
        pdf.save(output, deflate=True, no_new_id=True)
        pdf.close()
    if digest(source) != before: raise ValueError('Original DjVu changed during decoding')
    return {'from': 'djvu', 'renderer': 'djvulibre-pages-v1', 'sourceSha256': before, 'pdfSha256': digest(output), 'pages': pages}

if __name__ == '__main__':
    print(json.dumps(convert(sys.argv[1], sys.argv[2])))
