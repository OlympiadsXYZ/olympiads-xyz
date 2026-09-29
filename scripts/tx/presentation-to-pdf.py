"""Static native slide export with original bytes and explicit dynamic limitations."""
import hashlib
import json
import os
from pathlib import Path
import posixpath
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def inventory(source):
    with zipfile.ZipFile(source) as z:
        names = z.namelist()
        if any(any(x in n.lower() for x in ('vbaproject', 'activex/', 'embeddings/')) for n in names):
            raise ValueError('Executable or embedded-object presentation requires separate handling')
        external = []
        for name in names:
            if not name.endswith('.rels'): continue
            for r in ET.fromstring(z.read(name)):
                if r.get('TargetMode') == 'External':
                    # Ordinary hyperlinks are not fetched during export; linked media is unsupported.
                    if not r.get('Type', '').endswith('/hyperlink'):
                        raise ValueError('Externally linked presentation content: ' + name)
                    external.append({'part': name, 'target': r.get('Target'), 'type': 'hyperlink'})
        rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('ppt/_rels/presentation.xml.rels'))}
        root = ET.fromstring(z.read('ppt/presentation.xml'))
        slides = []
        for i, s in enumerate(root.findall(f'{{{P}}}sldIdLst/{{{P}}}sldId'), 1):
            target = rels[s.get(f'{{{R}}}id')]
            part = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('ppt', target))
            slide = ET.fromstring(z.read(part))
            slides.append({'page': i, 'sourcePage': i, 'part': part, 'hidden': slide.get('show') == '0',
                           'hasTiming': slide.find(f'{{{P}}}timing') is not None,
                           'hasTransition': slide.find(f'{{{P}}}transition') is not None,
                           'text': '\n'.join(t.text or '' for t in slide.iter(f'{{{A}}}t'))})
        if not slides: raise ValueError('Presentation has no slides')
        media = [{'part': n, 'sha256': hashlib.sha256(z.read(n)).hexdigest(), 'bytes': len(z.read(n))}
                 for n in names if n.startswith('ppt/media/')]
        # A still page cannot preserve video/audio or animated images.
        unsupported = [m['part'] for m in media if Path(m['part']).suffix.lower() in
                       ('.mp4', '.mov', '.avi', '.wmv', '.mp3', '.wav', '.m4a', '.wma', '.gif')]
        if unsupported: raise ValueError('Dynamic media requires separate extraction: ' + ', '.join(unsupported))
        return {'pages': slides, 'media': media, 'hyperlinks': external,
                'notesParts': [n for n in names if n.startswith('ppt/notesSlides/notesSlide') and n.endswith('.xml')]}

def convert(source, output):
    import fitz
    if os.name != 'nt': raise RuntimeError('Native presentation export requires Microsoft PowerPoint on Windows')
    inv = inventory(source)
    before = digest(source)
    command = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
               str(Path(__file__).with_name('powerpoint2pdf.ps1')), '-In', str(Path(source).resolve()), '-Out', str(Path(output).resolve())]
    r = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode: raise RuntimeError((r.stderr or r.stdout)[-2000:])
    if digest(source) != before: raise ValueError('Original presentation changed during export')
    with fitz.open(output) as pdf:
        if len(pdf) != len(inv['pages']): raise ValueError('Native PDF does not cover every slide, including hidden slides')
        for item, page in zip(inv['pages'], pdf):
            item.update({'widthPt': page.rect.width, 'heightPt': page.rect.height})
    return {'from': 'presentation', 'renderer': 'powerpoint-fixed-format-v1', 'sourceSha256': before,
            'pdfSha256': digest(output), **inv,
            'limitations': ['Static slide views only; transitions/timing are inventoried, not replayed. Speaker notes are not rendered.']}

if __name__ == '__main__':
    print(json.dumps(convert(sys.argv[1], sys.argv[2]), ensure_ascii=True))
