from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SIZES = (16, 32, 48, 128)


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def make_gradient(size: int, top_color: tuple[int, int, int], bottom_color: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    for y in range(size):
        mix = y / max(size - 1, 1)
        color = tuple(int(top_color[i] * (1 - mix) + bottom_color[i] * mix) for i in range(3))
        for x in range(size):
            pixels[x, y] = (*color, 255)
    return image


def rounded_panel(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, image.size[0] - 1, image.size[1] - 1), radius=radius, fill=255)
    image.putalpha(mask)
    return image


def draw_download_icon(size: int) -> Image.Image:
    canvas = make_gradient(size, (18, 112, 89), (9, 61, 52))
    canvas = rounded_panel(canvas, max(3, size // 5))
    draw = ImageDraw.Draw(canvas)

    inset = size * 0.12
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=size * 0.16,
        outline=(240, 244, 236, 170),
        width=max(1, size // 24),
    )

    arrow_top = size * 0.24
    arrow_bottom = size * 0.64
    center_x = size / 2
    shaft_width = max(2, size // 9)
    draw.rounded_rectangle(
        (center_x - shaft_width / 2, arrow_top, center_x + shaft_width / 2, arrow_bottom),
        radius=shaft_width / 2,
        fill=(253, 248, 238, 255),
    )
    head_half = size * 0.16
    draw.polygon(
        [
            (center_x - head_half, arrow_bottom - size * 0.03),
            (center_x + head_half, arrow_bottom - size * 0.03),
            (center_x, arrow_bottom + size * 0.18),
        ],
        fill=(253, 248, 238, 255),
    )

    tray_y = size * 0.74
    tray_width = size * 0.44
    tray_height = max(2, size // 14)
    draw.rounded_rectangle(
        (
            center_x - tray_width / 2,
            tray_y,
            center_x + tray_width / 2,
            tray_y + tray_height,
        ),
        radius=tray_height / 2,
        fill=(229, 213, 184, 255),
    )

    sparkle_radius = max(1, size // 18)
    draw.ellipse((size * 0.72, size * 0.18, size * 0.72 + sparkle_radius * 2, size * 0.18 + sparkle_radius * 2), fill=(245, 212, 116, 255))
    return canvas


def draw_markdown_icon(size: int) -> Image.Image:
    canvas = make_gradient(size, (143, 53, 24), (83, 28, 14))
    canvas = rounded_panel(canvas, max(3, size // 5))
    draw = ImageDraw.Draw(canvas)

    paper_margin = size * 0.16
    paper = (paper_margin, size * 0.12, size - paper_margin, size - size * 0.12)
    draw.rounded_rectangle(paper, radius=size * 0.12, fill=(255, 250, 241, 255))

    fold = [
      (paper[2] - size * 0.18, paper[1]),
      (paper[2], paper[1]),
      (paper[2], paper[1] + size * 0.18),
    ]
    draw.polygon(fold, fill=(239, 221, 196, 255))

    stroke = max(1, size // 20)
    line_color = (143, 53, 24, 255)
    mid_y = size * 0.48
    left = size * 0.28
    right = size * 0.72
    peak = size * 0.40
    bottom = size * 0.60
    draw.line([(left, bottom), (left, peak), (size * 0.39, bottom), (size * 0.50, peak), (size * 0.50, bottom)], fill=line_color, width=stroke, joint="curve")
    draw.line([(size * 0.58, peak), (right, peak)], fill=line_color, width=stroke)
    draw.line([(size * 0.66, peak), (size * 0.66, bottom)], fill=line_color, width=stroke)

    accent_y = size * 0.72
    draw.rounded_rectangle((size * 0.28, accent_y, size * 0.72, accent_y + stroke * 1.8), radius=stroke, fill=(211, 121, 82, 255))
    return canvas


def save_icon_set(target_dir: Path, renderer) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        image = renderer(size)
        image.save(target_dir / f"icon-{size}.png")


if __name__ == "__main__":
    save_icon_set(ROOT / "image-downloader" / "icons", draw_download_icon)
    save_icon_set(ROOT / "page-to-markdown" / "icons", draw_markdown_icon)
