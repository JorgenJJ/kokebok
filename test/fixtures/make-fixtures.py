#!/usr/bin/env python3
"""Lager PNG-fixturer av gjengitte oppskriftssider for OCR-integrasjonstesten.

Kjør:  python3 test/fixtures/make-fixtures.py
Krever Pillow og DejaVu-fontene. Resultatet sjekkes inn i git slik at testen
kan kjøre uten Pillow.
"""
import json
import pathlib

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).parent
SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

PAGE = (1240, 1754)  # A4 @ 150 dpi
# NB: innholdet legges godt innenfor rammen appen beskjærer til (x 5–95 %, y 8–95 %).
MARGIN = 90


def render(name, title, meta, left, right):
    img = Image.new("L", PAGE, 255)
    d = ImageDraw.Draw(img)

    f_title = ImageFont.truetype(SERIF_BOLD, 64)
    f_meta = ImageFont.truetype(SANS, 26)
    f_body = ImageFont.truetype(SANS, 28)

    d.text((MARGIN, 260), title, font=f_title, fill=0)
    d.text((MARGIN, 370), meta, font=f_meta, fill=0)

    col_w = (PAGE[0] - 2 * MARGIN - 80) // 2
    for x, lines in ((MARGIN, left), (MARGIN + col_w + 80, right)):
        y = 480
        for line in lines:
            d.text((x, y), line, font=f_body, fill=0)
            y += 46

    out = HERE / f"{name}.png"
    img.save(out, optimize=True)
    print("skrev", out, img.size)


PAGES = {
    "ramen": dict(
        title="RAMEN",
        meta="4-5 porsjoner    40 min",
        left=[
            "600 g larfilet av kylling",
            "3 ss olje til steking",
            "1 ts salt",
            "Kraft",
            "8 torket shiitakesopp",
            "2 dl vann",
            "25 g ingefaer i strimler",
            "2 varlok",
            "4 ss soyasaus",
            "2 ss mirin",
            "Tilbehor",
            "Ramen-nudler",
            "Ristede sesamfro",
        ],
        right=[
            "1. Blotlegg soppen i kokende",
            "vann i 20 minutter.",
            "2. Salt kyllingen og stek den",
            "i en stekepanne.",
            "3. Stek varloken sammen med",
            "ingefaer i oljen.",
            "4. Legg pa lokk og la kraften",
            "koke i ca 10 minutter.",
            "5. Sil kraften og server med",
            "nudler og sesamfro.",
        ],
    ),
}

if __name__ == "__main__":
    for name, page in PAGES.items():
        render(name, **page)
    (HERE / "pages.json").write_text(json.dumps(PAGES, indent=2, ensure_ascii=False) + "\n")
