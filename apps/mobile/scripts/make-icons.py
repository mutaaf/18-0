#!/usr/bin/env python3
"""
Generate every launcher asset from the one piece of brand artwork.

    python3 -m venv /tmp/imgvenv && /tmp/imgvenv/bin/pip install Pillow
    /tmp/imgvenv/bin/python scripts/make-icons.py

The app shipped with Expo's default blue chevron for a while, because the
config pointed at `assets/icon.png` and nobody looked at what was in it. The
dimensions were right, the alpha channel was right, and the picture was
somebody else's. This script exists so the icons are derived from
`assets/brand/lockup.png` rather than being files that happen to sit in the
right place.

Pillow is not a project dependency — this runs by hand when the brand changes,
which is rarely.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
SOURCE = ASSETS / 'brand' / 'lockup.png'

# The app's own background, so the icon and the first frame of the app agree.
VOID = (7, 9, 12)


def artwork() -> Image.Image:
    """The crest with its transparent margin removed."""
    art = Image.open(SOURCE).convert('RGBA')
    return art.crop(art.getbbox())


def fit(piece: Image.Image, size: int, pad: int) -> tuple[Image.Image, tuple[int, int]]:
    avail = size - pad * 2
    scale = min(avail / piece.size[0], avail / piece.size[1])
    resized = piece.resize((int(piece.size[0] * scale), int(piece.size[1] * scale)), Image.LANCZOS)
    return resized, ((size - resized.size[0]) // 2, (size - resized.size[1]) // 2)


def on_void(piece: Image.Image, size: int, pad: int) -> Image.Image:
    """Flattened onto the brand black. iOS rejects an icon with alpha."""
    canvas = Image.new('RGB', (size, size), VOID)
    art, at = fit(piece, size, pad)
    canvas.paste(art, at, art)
    return canvas


def transparent(piece: Image.Image, size: int, pad: int) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    art, at = fit(piece, size, pad)
    canvas.paste(art, at, art)
    return canvas


def main() -> None:
    art = artwork()

    # iOS and the store listing. No alpha, no rounding — the system does that.
    on_void(art, 1024, 40).save(ASSETS / 'icon.png')

    # Android adaptive foreground. Only the middle ~66% of the canvas survives
    # the launcher's mask, so the crest is kept well inside it.
    transparent(art, 1024, 250).save(ASSETS / 'android-icon-foreground.png')
    Image.new('RGB', (1024, 1024), VOID).save(ASSETS / 'android-icon-background.png')

    # Themed icons: a flat silhouette, tinted by the launcher.
    silhouette = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    shape, at = fit(art, 1024, 250)
    white = Image.new('RGBA', shape.size, (255, 255, 255, 255))
    silhouette.paste(white, at, shape)
    silhouette.save(ASSETS / 'android-icon-monochrome.png')

    # The splash plugin composites this over `backgroundColor`, so it keeps its
    # transparency and sits smaller than the icon.
    transparent(art, 1024, 180).save(ASSETS / 'splash-icon.png')

    # Browser tab.
    on_void(art, 96, 4).save(ASSETS / 'favicon.png')

    for name in ('icon.png', 'android-icon-foreground.png', 'android-icon-background.png',
                 'android-icon-monochrome.png', 'splash-icon.png', 'favicon.png'):
        image = Image.open(ASSETS / name)
        print(f'{name:32} {image.size[0]}x{image.size[1]}  {image.mode}')


if __name__ == '__main__':
    main()
