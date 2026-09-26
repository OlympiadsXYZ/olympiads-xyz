#!/usr/bin/env python3
"""Build the self-hosted Inter subsets in static/fonts/ (served at /fonts/).

The site used to load the whole Inter 4.1 variable family from rsms.me: about
725 KB on a problem page (roman + italic, every script, two axes). This cuts
it down to what the pages print:

  * weight kept variable over 400-900 (nothing on the site asks for lighter
    than font-normal);
  * the optical size axis (which the browser sets from the font size, so large
    headings get Inter's tighter display cut) kept only in the roman core file,
    the one that sets headings and body text; elsewhere it is pinned at 14,
    Inter's text cut, which is what italics and symbols at text size get anyway.
    Pinning it everywhere would halve the core file but visibly widens the
    headings (a problem title that fits on one line wraps onto two);
  * each style split by unicode-range into core (ASCII, Latin-1, Bulgarian and
    Russian Cyrillic, general punctuation), symbols (Greek, super/subscripts,
    arrows, maths, shapes) and ext (Latin Extended, IPA, combining marks, the
    rest of Cyrillic). A browser fetches a file only when the page prints one
    of its characters, so a typical Bulgarian page gets core alone.

The unicode ranges below must match the @font-face rules in src/html.js. The
file names carry the Inter version; change it (and html.js) when upgrading, as
/fonts/* is served immutable (vercel.json).

Inputs are the upstream variable fonts (SIL OFL 1.1, static/fonts/Inter-LICENSE.txt):
  https://rsms.me/inter/font-files/InterVariable.woff2?v=4.1
  https://rsms.me/inter/font-files/InterVariable-Italic.woff2?v=4.1

  python scripts/subset-inter.py <dir with the two upstream files> [out_dir]

Needs fontTools and brotli (pip install fonttools brotli).
"""
import io, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

VERSION = '4.1'
SOURCES = {'roman': 'InterVariable.woff2', 'italic': 'InterVariable-Italic.woff2'}
AXES = {'wght': (400, 900)}
PINNED_OPSZ = 14
KEEP_OPSZ = {('roman', 'core')}
# Kept on top of fontTools' default layout features: tabular figures
# (tabular-nums), case-sensitive forms and the fraction/super/subscript ones.
FEATURES = ['tnum', 'case', 'zero', 'frac', 'numr', 'dnom', 'sups', 'subs', 'ordn']
RANGES = {
    'core': 'U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+0400-045F,U+0490-0491,'
            'U+2000-206F,U+20AC,U+2116,U+2122,U+2212',
    'symbols': 'U+0370-03FF,U+2070-209F,U+20A0-20AB,U+20AD-20CF,U+2100-2115,U+2117-2121,U+2123-214F,'
               'U+2150-218F,U+2190-21FF,U+2200-2211,U+2213-22FF,U+2460-24FF,U+25A0-25FF,'
               'U+2605,U+2713,U+2717,U+2756',
    'ext': 'U+0100-0130,U+0132-0151,U+0154-024F,U+0250-02C5,U+02C7-02D9,U+02DB,U+02DD-02FF,'
           'U+0300-036F,U+0460-048F,U+0492-052F,U+1D00-1DBF,U+1E00-1EFF',
}


def instance(path, axes):
    font = instancer.instantiateVariableFont(TTFont(path), axes)
    # Round-trip through bytes: the subsetter trips over the instancer's lazily
    # loaded gvar otherwise.
    buf = io.BytesIO()
    font.flavor = None
    font.save(buf)
    return buf.getvalue()


def write_subset(data, unicodes, out):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = opts.layout_features + FEATURES
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    font = TTFont(io.BytesIO(data))
    subsetter = subset.Subsetter(opts)
    subsetter.populate(unicodes=subset.parse_unicodes(unicodes))
    subsetter.subset(font)
    subset.save_font(font, out, opts)
    return os.path.getsize(out)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src_dir = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'static', 'fonts')
    os.makedirs(out_dir, exist_ok=True)
    for style, name in SOURCES.items():
        path = os.path.join(src_dir, name)
        with_opsz = instance(path, AXES)
        pinned = instance(path, {**AXES, 'opsz': PINNED_OPSZ})
        for part, unicodes in RANGES.items():
            data = with_opsz if (style, part) in KEEP_OPSZ else pinned
            out = os.path.join(out_dir, f'inter-{VERSION}-{style}-{part}.woff2')
            print(f'{os.path.basename(out)}: {write_subset(data, unicodes, out)} bytes')


if __name__ == '__main__':
    main()
