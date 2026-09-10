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



def radius_of(piece: Image.Image, size: int, pad: int) -> float:
    """
    How far the artwork actually reaches from the centre, in pixels.

    Measured from the alpha channel rather than from the bounding box. The crest
    is a crest -- its corners are empty -- so a box-corner measurement would
    demand padding for pixels that are not there and shrink the icon for
    nothing.
    """
    art, at = fit(piece, size, pad)
    alpha = art.getchannel('A')
    cx, cy = size / 2, size / 2
    far = 0.0
    # Every fourth pixel. The artwork is hundreds of pixels wide here and the
    # answer moves by well under a pixel at this stride.
    for y in range(0, art.size[1], 4):
        for x in range(0, art.size[0], 4):
            if alpha.getpixel((x, y)) > 8:
                far = max(far, ((at[0] + x - cx) ** 2 + (at[1] + y - cy) ** 2) ** 0.5)
    return far


SAFE = 0.40
"""
The maskable safe zone, as a fraction of the icon's width.

A `purpose: "maskable"` icon is not shown as drawn. Android and Chrome crop it
to whatever shape the launcher uses -- a circle on some, a squircle on others --
and the only region guaranteed to survive is a centred circle of 80% diameter,
which is 0.40 of the width as a radius.

The shipped one was framed identically to the plain icon, whose artwork reaches
1.05x the icon width. The crown tips, both stadium lights and the ends of the
banner were being cut off on every Android home screen.
"""


def maskable(piece: Image.Image, size: int) -> tuple[Image.Image, int]:
    """The crest, shrunk until every lit pixel of it is inside the safe circle."""
    # Grown from the plain icon's padding rather than solved for. It runs once,
    # it is obvious, and it cannot be wrong about the shape.
    pad = int(size * 0.04)
    while pad < size // 2 and radius_of(piece, size, pad) > size * SAFE:
        pad += max(1, size // 100)
    return on_void(piece, size, pad), pad


def pwa(art: Image.Image) -> None:
    """
    The icons the installed web app uses.

    These four sat in `public/icons/` with nothing generating them -- exactly
    the state this script exists to end, and it went unnoticed because they
    look right in a browser tab, which is the one place a maskable icon is
    never masked.
    """
    icons = ROOT / 'public' / 'icons'

    # `purpose: "any"`. Drawn as given, so it keeps the full-bleed framing.
    on_void(art, 512, 20).save(icons / 'icon-512.png')
    on_void(art, 192, 8).save(icons / 'icon-192.png')

    # iOS applies its own superellipse and promises no safe zone, so this
    # matches the App Store icon rather than the maskable one.
    on_void(art, 180, 7).save(icons / 'apple-touch-icon.png')

    mask, pad = maskable(art, 512)
    mask.save(icons / 'maskable-512.png')

    reach = radius_of(art, 512, pad) / 512
    assert reach <= SAFE, f'maskable artwork reaches {reach:.3f}, past the {SAFE} safe zone'
    print(f'maskable-512  padded {pad}px, artwork reaches {reach:.3f} of {SAFE} allowed')


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

    pwa(art)

    for name in ('icon.png', 'android-icon-foreground.png', 'android-icon-background.png',
                 'android-icon-monochrome.png', 'splash-icon.png', 'favicon.png'):
        image = Image.open(ASSETS / name)
        print(f'{name:32} {image.size[0]}x{image.size[1]}  {image.mode}')

    for name in ('icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'):
        image = Image.open(ROOT / 'public' / 'icons' / name)
        print(f'public/icons/{name:19} {image.size[0]}x{image.size[1]}  {image.mode}')


if __name__ == '__main__':
    main()
