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


def wordmark(size: int, pad: float = 0.10) -> Image.Image:
    """The name, fitted to the box, for sizes too small to carry the crest."""
    from PIL import ImageDraw, ImageFont

    fonts = ROOT.parent.parent / 'node_modules' / '@expo-google-fonts'
    face = fonts / 'rajdhani' / '700Bold' / 'Rajdhani_700Bold.ttf'

    scale = 10  # drawn large and downsampled, so the curves stay smooth
    box = size * scale
    canvas = Image.new('RGB', (box, box), VOID)
    draw = ImageDraw.Draw(canvas)

    # Binary search the point size rather than guessing one: the mark should
    # touch the padding, and a guess either clips or floats.
    avail = box * (1 - pad * 2)
    low, high = 4, box
    while low < high:
        mid = (low + high + 1) // 2
        bounds = draw.textbbox((0, 0), '18-0', font=ImageFont.truetype(str(face), mid))
        if bounds[2] - bounds[0] <= avail and bounds[3] - bounds[1] <= avail:
            low = mid
        else:
            high = mid - 1

    font = ImageFont.truetype(str(face), low)
    parts = (('18-', (242, 245, 250)), ('0', (255, 180, 0)))
    width = sum(draw.textlength(text, font=font) for text, _ in parts)
    bounds = draw.textbbox((0, 0), '18-0', font=font)
    x = (box - width) / 2
    y = (box - (bounds[3] - bounds[1])) / 2 - bounds[1]
    for text, colour in parts:
        draw.text((x, y), text, font=font, fill=colour)
        x += draw.textlength(text, font=font)

    return canvas.resize((size, size), Image.LANCZOS)


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
    #
    # NOT the crest. A favicon is rendered at 16 and 32 pixels, and at that size
    # the crown, the stadium lights and the banner lettering turn to mush -- it
    # read as a brown smudge in the tab. The wordmark has four shapes and
    # survives the downsample, and the gold zero is the one detail that still
    # reads when everything else has blurred.
    wordmark(96).save(ASSETS / 'favicon.png')

    for name in ('icon.png', 'android-icon-foreground.png', 'android-icon-background.png',
                 'android-icon-monochrome.png', 'splash-icon.png', 'favicon.png'):
        image = Image.open(ASSETS / name)
        print(f'{name:32} {image.size[0]}x{image.size[1]}  {image.mode}')


if __name__ == '__main__':
    main()
