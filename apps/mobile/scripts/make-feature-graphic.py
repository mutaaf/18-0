#!/usr/bin/env python3
"""
Build the Google Play feature graphic.

    /tmp/imgvenv/bin/python scripts/make-feature-graphic.py

Play demands exactly 1024x500 and rejects the upload outright if the PNG
carries an alpha channel — the same trap `make-icons.py` records for iOS. So
the canvas is RGB from the first line rather than an RGBA composite flattened
at the end, where a stray paste would put the channel back.

This is not `make-og.py` at another size. The OG card is 1200x630 and is shown
whole; the feature graphic is 1024x500 and is *cropped*, differently, on every
surface Play uses it on — the store header, the search carousel, the TV row.
Only roughly the middle 924x400 survives all of them, so the crest and every
line of type live inside that box and the edges carry nothing but texture.
That is also why the domain is not on this one: it was the first thing to be
sliced off, and a URL that reads "18-0.C" is worse than no URL at all.

Pillow is not a project dependency; this runs by hand when the brand changes.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT.parent.parent / 'node_modules' / '@expo-google-fonts'

W, H = 1024, 500
VOID = (6, 8, 15)
GOLD = (255, 180, 0)
GOLD_BRIGHT = (255, 209, 82)
TEXT = (242, 245, 250)
DIM = (154, 164, 184)

# The centred region Play's crops agree on. Everything that has to be read has
# to fit here.
SAFE = (50, 50, W - 50, H - 50)


def font(family: str, style: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / family / style / f'{family.capitalize()}_{style}.ttf'), size)


def background() -> Image.Image:
    card = Image.new('RGB', (W, H), VOID)
    draw = ImageDraw.Draw(card)

    # Yard lines, barely there — texture at full size, invisible at thumbnail
    # size, which is the right way round.
    for x in range(0, W, 60):
        draw.line([(x, 0), (x, H)], fill=(13, 17, 28), width=1)

    # A gold glow behind where the crest sits, blurred so it reads as light
    # rather than as a circle. Wider and flatter than the OG card's: at 500
    # tall a circle big enough to sit behind the crest runs off both edges and
    # lights the corners the crop is going to eat.
    glow = Image.new('RGB', (W, H), VOID)
    ImageDraw.Draw(glow).ellipse([-120, -60, 560, 560], fill=(58, 40, 4))
    card = Image.blend(card, glow.filter(ImageFilter.GaussianBlur(90)), 0.85)

    # A single red rule along the bottom: the broadcast palette's live colour.
    # Decorative on purpose — it is outside the safe area, so a crop that takes
    # it costs nothing.
    ImageDraw.Draw(card).rectangle([0, H - 7, W, H], fill=(213, 10, 10))
    return card


def main() -> None:
    card = background()

    crest = Image.open(ROOT / 'assets' / 'brand' / 'lockup.png').convert('RGBA')
    crest = crest.crop(crest.getbbox())
    # Sized by height, not width. The OG card scales the crest to a width and
    # gets away with it at 630 tall; here the same width overshoots the safe
    # area top and bottom and the crown loses its points.
    scale = 310 / crest.size[1]
    crest = crest.resize((int(crest.size[0] * scale), int(crest.size[1] * scale)), Image.LANCZOS)
    card.paste(crest, (76, (H - crest.size[1]) // 2 - 6), crest)

    draw = ImageDraw.Draw(card)
    # Set so the longest line ends the same 76px from the right that the crest
    # keeps on the left. What has to look centred is the block, not the canvas.
    x = 552

    head = font('rajdhani', '700Bold', 58)
    lines = [
        # "PERFECT ROSTER" stays on one line. Broken over two it clears the
        # safe area easily, but then the headline is 200px narrower than the
        # line under it and the whole right half of the graphic reads as a hole.
        (176, 'BUILD THE', head, TEXT),
        (230, 'PERFECT ROSTER', head, GOLD_BRIGHT),
        # One supporting line, not the card's two. The second line is the first
        # thing that stops being legible in the search carousel's thumbnail.
        (306, 'Seven spins. One undefeated season.', font('montserrat', '400Regular', 21), DIM),
    ]
    for y, text, face, colour in lines:
        draw.text((x, y), text, font=face, fill=colour)

    # Checked rather than eyeballed: rewording the headline is a one-word edit
    # that silently pushes it under Play's crop, and the failure only shows up
    # in the store listing after review.
    widest = max(x + draw.textlength(text, font=face) for _, text, face, _ in lines)
    if widest > SAFE[2] or lines[0][0] < SAFE[1] or lines[-1][0] + 30 > SAFE[3]:
        raise SystemExit(f'type leaves the safe area {SAFE}: right edge {widest:.0f}, '
                         f'top {lines[0][0]}, bottom {lines[-1][0] + 30}')

    out = ROOT / 'assets' / 'store' / 'play-feature-graphic.png'
    out.parent.mkdir(parents=True, exist_ok=True)
    card.save(out, optimize=True)
    print(f'{out.relative_to(ROOT.parent.parent)}  {card.size[0]}x{card.size[1]}  {card.mode}  '
          f'{out.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
