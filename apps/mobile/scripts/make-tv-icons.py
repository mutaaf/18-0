#!/usr/bin/env python3
"""
Generate the Apple TV brand assets from the same artwork as every other icon.

    python3 -m venv /tmp/imgvenv && /tmp/imgvenv/bin/pip install Pillow
    /tmp/imgvenv/bin/python scripts/make-tv-icons.py

An Apple TV icon is not a square. It is a landscape tile in two layers that
tvOS pulls apart when the icon has focus -- the parallax a remote's thumb
produces -- plus a Top Shelf banner shown above the dock row. The config-tv
plugin (`appleTVImages` in app.config.js) builds the asset catalog from these
files and Xcode refuses the build if any of them is the wrong size, so the
sizes are asserted here rather than discovered there.

Two layers, so the parallax has something to move:
  back  -- the lit ground and the field, opaque (tvOS rejects alpha here)
  front -- the crest alone, on transparency

Pillow is not a project dependency; this runs by hand when the brand changes.
"""
from pathlib import Path
from PIL import Image

from importlib import util

HERE = Path(__file__).resolve().parent
spec = util.spec_from_file_location('icons', HERE / 'make-icons.py')
icons = util.module_from_spec(spec)
spec.loader.exec_module(icons)

OUT = HERE.parent / 'assets' / 'tv'


def ground(w: int, h: int) -> Image.Image:
    """make-icons.ground, stretched to a landscape tile."""
    side = max(w, h)
    return icons.ground(side).resize((w, h), Image.BICUBIC)


def field(w: int, h: int, horizon: int) -> Image.Image:
    # Every tile is landscape. Drawn square at the width and cropped to the
    # bottom band, so the stripes keep the icon's perspective rather than
    # being squashed.
    square = icons.field(w, horizon + (w - h))
    return square.crop((0, w - h, w, w))


def back(w: int, h: int) -> Image.Image:
    canvas = ground(w, h).convert('RGBA')
    canvas.alpha_composite(field(w, h, int(h * 0.80)))
    return canvas.convert('RGB')


def front(piece: Image.Image, w: int, h: int, scale: float = 0.78) -> Image.Image:
    """The crest standing on the horizon, sized to the tile's height."""
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    target_h = int(h * scale)
    ratio = target_h / piece.size[1]
    art = piece.resize((int(piece.size[0] * ratio), target_h), Image.LANCZOS)
    if art.size[0] > w * 0.9:
        r = (w * 0.9) / art.size[0]
        art = art.resize((int(art.size[0] * r), int(art.size[1] * r)), Image.LANCZOS)
    horizon = int(h * 0.80)
    canvas.alpha_composite(art, ((w - art.size[0]) // 2, horizon - art.size[1] + int(h * 0.03)))
    return canvas


def flat(piece: Image.Image, w: int, h: int, scale: float) -> Image.Image:
    canvas = back(w, h).convert('RGBA')
    canvas.alpha_composite(front(piece, w, h, scale))
    return canvas.convert('RGB')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    piece = icons.crest(None)

    for name, (w, h) in {'icon-small': (400, 240), 'icon-small@2x': (800, 480), 'icon': (1280, 768)}.items():
        back(w, h).save(OUT / f'{name}-back.png')
        front(piece, w, h).save(OUT / f'{name}-front.png')

    # The Top Shelf is a banner, not an icon: the crest sits smaller and the
    # field carries the width.
    for name, (w, h) in {
        'top-shelf': (1920, 720), 'top-shelf@2x': (3840, 1440),
        'top-shelf-wide': (2320, 720), 'top-shelf-wide@2x': (4640, 1440),
    }.items():
        flat(piece, w, h, 0.62).save(OUT / f'{name}.png')

    for f in sorted(OUT.glob('*.png')):
        with Image.open(f) as im:
            print(f'{f.name:28} {im.size[0]}x{im.size[1]} {im.mode}')


if __name__ == '__main__':
    main()
