"""Real PDF regression: lossless clockwise turns, unchanged page coordinates."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import fitz
from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / 'pdfcrop.py'


class CropRotationTest(unittest.TestCase):
    def test_original_coordinates_default_bytes_and_all_pixels(self):
        with tempfile.TemporaryDirectory(prefix='pdfcrop-rotation-') as folder:
            root = Path(folder)
            doc = fitz.open()
            doc.new_page(width=300, height=240)
            page = doc.new_page(width=300, height=240)
            # Asymmetric corners expose clockwise/counterclockwise or mirroring errors.
            for rect, color in [((36, 24, 132, 84), (1, 0, 0)), ((132, 24, 228, 84), (0, 1, 0)),
                                ((36, 84, 132, 144), (0, 0, 1)), ((132, 84, 228, 144), (1, 1, 0))]:
                page.draw_rect(rect, color=color, fill=color)
            page.insert_text((47, 56), 'SOURCE', fontsize=13)
            pdf = root / 'source.pdf'
            doc.save(pdf)
            clip = fitz.Rect(36, 24, 228, 144)
            page.get_pixmap(clip=clip, dpi=72, alpha=False).save(root / 'legacy.png')
            # Preview coordinates use 144 dpi; source rectangle remains PDF points.
            box = 'page=2,x0=72,y0=48,x1=456,y1=288,id=crop'
            images = {}
            for angle in [None, 0, 90, 180, 270]:
                target = root / str(angle)
                spec = box + (f',rotation={angle}' if angle is not None else '')
                result = subprocess.run([sys.executable, str(SCRIPT), str(pdf), str(target), '--dpi', '72', '--preview-dpi', '144', '--box', spec], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                meta = json.loads((target / 'figures.json').read_text())[0]
                self.assertEqual(meta['page'], 2)
                self.assertEqual(meta['pdfRect'], [36, 24, 228, 144])
                self.assertEqual(meta['rotation'], angle or 0)
                im = Image.open(target / 'crop.png').convert('RGB')
                self.assertEqual(meta['px'], list(im.size))
                self.assertEqual(meta['bytes'], (target / 'crop.png').stat().st_size)
                images[angle] = im
            legacy = (root / 'legacy.png').read_bytes()
            self.assertEqual((root / 'None/crop.png').read_bytes(), legacy)
            self.assertEqual((root / '0/crop.png').read_bytes(), legacy)
            original = images[0]
            width, height = original.size
            for angle in [90, 180, 270]:
                rotated = images[angle]
                self.assertEqual(rotated.size, (height, width) if angle != 180 else (width, height))
                for y in range(height):
                    for x in range(width):
                        target = {90: (height - 1 - y, x), 180: (width - 1 - x, height - 1 - y), 270: (y, width - 1 - x)}[angle]
                        self.assertEqual(rotated.getpixel(target), original.getpixel((x, y)), (angle, x, y))

    def test_unsupported_angles_rejected(self):
        spec = importlib.util.spec_from_file_location('pdfcrop', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for angle in ['45', '-90', '360', '90.5', 'ninety']:
            with self.assertRaises(ValueError):
                module.parse_box(f'page=1,x0=0,y0=0,x1=20,y1=30,rotation={angle}')


if __name__ == '__main__':
    unittest.main()
