"""Generate one synthetic receipt; edit the demo data below for your own examples.

Uses Pillow from the existing Python worker environment. From the repository root:
    python_worker/.venv/bin/python scripts/generate-demo-receipts.py
    python_worker/.venv/bin/python scripts/generate-demo-receipts.py --output /tmp/demo.png

Optionally pass --font /path/to/a/monospace.ttf. Output defaults to demo-receipt.png
in the current directory. No OCR, AI provider or database connection is needed.
"""

import argparse
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


@dataclass(frozen=True)
class Item:
    """Represents a single line item on the receipt."""
    name: str
    unit_price_cents: int
    quantity: str = "1"
    unit: str = "pcs"
    # Positive cents deducted from this item's line total, printed underneath it.
    discounts: tuple[tuple[str, int], ...] = ()

    @property
    def total_cents(self) -> int:
        return int(
            (Decimal(self.quantity) * self.unit_price_cents).quantize(
                Decimal(1), rounding=ROUND_HALF_UP
            )
        )


# Customize this one example to create other receipts. Reuse the same product
# name and package size on multiple dates to demonstrate product price history.
MERCHANT = "DEMO MARKET"
ADDRESS = ("12 Example Street", "12345 Sample Town")
PURCHASE_DATE = "2026-09-08"
PURCHASE_TIME = "10:24"
CURRENCY = "EUR"
ITEMS = (
    Item("Mineral Water 1,5 L", 79, quantity="2", discounts=(("Item discount", 20),)),
    Item("Fruit Yogurt 150 g", 89, quantity="2"),
    Item("Apples", 249, quantity="0.750", unit="kg"),
    Item("Coffee Filters 100 pcs", 249, discounts=(("Item coupon", 30),)),
    Item("Bottle deposit", 25, quantity="2"),
    Item("Deposit return", -25, quantity="2"),
)
# Positive cents deducted once from the whole receipt.
RECEIPT_DISCOUNTS = (("Receipt coupon", 50),)


def money(cents: int) -> str:
    """Format cents as a currency string with the configured currency symbol."""
    sign = "-" if cents < 0 else ""
    amount = abs(cents)
    return f"{sign}{amount // 100}.{amount % 100:02d} {CURRENCY}"


def load_font(size: int, requested: Path | None) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load a font from the requested path or fall back to common system fonts.

    Args:
        size: The font size to load.
        requested: The path to the requested font file, or None to use system defaults.

    Returns:
        An ImageFont instance for the requested or fallback font.
    """
    if requested is not None:
        return ImageFont.truetype(str(requested), size)
    # Common Linux, macOS and Windows locations; Pillow supplies a fallback.
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
        "/usr/share/fonts/liberation/LiberationMono-Regular.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "C:/Windows/Fonts/consola.ttf",
    ):
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def generate_receipt(output: Path, font_path: Path | None = None) -> int:
    """Render the configured data and return the final total in cents.

    Args:
        output: The path to save the generated receipt image.
        font_path: The path to the font file to use, or None to use system defaults.

    Returns:
        The final total of the receipt in cents.
    """
    if not ITEMS:
        raise ValueError("Add at least one item to the receipt")
    for item in ITEMS:
        if Decimal(item.quantity) <= 0 or item.unit not in ("pcs", "kg", "g", "l", "ml"):
            raise ValueError(f"Invalid quantity or unit for {item.name}")
        if any(amount <= 0 for _, amount in item.discounts):
            raise ValueError("Enter discounts as positive integer cents")
        if item.discounts and sum(amount for _, amount in item.discounts) > item.total_cents:
            raise ValueError(f"Discounts exceed the line total for {item.name}")
    if any(amount <= 0 for _, amount in RECEIPT_DISCOUNTS):
        raise ValueError("Enter receipt discounts as positive integer cents")

    subtotal = sum(
        item.total_cents - sum(amount for _, amount in item.discounts)
        for item in ITEMS
    )
    total = subtotal - sum(amount for _, amount in RECEIPT_DISCOUNTS)
    if total < 0:
        raise ValueError("Receipt discounts and returns exceed the purchase total")

    regular = load_font(28, font_path)
    small = load_font(23, font_path)
    heading = load_font(34, font_path)
    # Each row is (left text, right text, font, centered).
    rows: list[tuple[str, str, ImageFont.FreeTypeFont | ImageFont.ImageFont, bool] | None] = [
        (MERCHANT, "", heading, True)
    ]
    rows += [(line, "", small, True) for line in ADDRESS]
    rows.append((PURCHASE_DATE, PURCHASE_TIME, small, False))
    rows.append(None)
    for item in ITEMS:
        rows.append((item.name, money(item.total_cents), regular, False))
        if item.quantity != "1" or item.unit != "pcs":
            rows.append((
                f"  {item.quantity} {item.unit} x {money(item.unit_price_cents)}/{item.unit}",
                "", small, False,
            ))
        rows += [
            (f"  {label}", money(-amount), small, False)
            for label, amount in item.discounts
        ]
    rows.append(None)
    rows.append(("SUBTOTAL", money(subtotal), regular, False))
    rows += [
        (label, money(-amount), small, False)
        for label, amount in RECEIPT_DISCOUNTS
    ]
    rows.append(None)
    rows += [
        ("TOTAL", money(total), heading, False),
        ("Card payment", money(total), small, False),
    ]
    rows.append(None)
    rows += [
        ("Thank you for shopping!", "", small, True),
        ("SYNTHETIC DEMO RECEIPT", "", small, True),
        ("NOT A REAL PURCHASE", "", small, True),
    ]

    width, margin, row_height = 1000, 65, 48
    image = Image.new("RGB", (width, margin * 2 + len(rows) * row_height), "white")
    draw = ImageDraw.Draw(image)
    y = margin
    for row in rows:
        if row is None:
            draw.line((margin, y + 18, width - margin, y + 18), fill="black", width=2)
        else:
            left, right, font, centered = row
            left_width = draw.textlength(left, font=font)
            right_width = draw.textlength(right, font=font)
            gap = 30 if right else 0
            if left_width + right_width + gap > width - 2 * margin:
                raise ValueError(f"Text too wide; shorten the label: {left}")
            x = (width - left_width) / 2 if centered else margin
            draw.text((x, y), left, font=font, fill="black")
            if right:
                draw.text((width - margin - right_width, y), right, font=font, fill="black")
        y += row_height

    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="PNG")
    return total


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--output", type=Path, default=Path("demo-receipt.png"))
    parser.add_argument("--font", type=Path, help="Optional TrueType/OpenType font path")
    args = parser.parse_args()
    total = generate_receipt(args.output, args.font)
    print(f"Created {args.output} (total: {money(total)})")
