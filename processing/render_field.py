#!/usr/bin/env python3
"""Render an abstract soul-field JSON file into a GitHub-friendly PNG.

The input contains only synthetic particles derived from aggregate histograms.
It never reads or renders raw LiDAR coordinates.
"""

import argparse
import json
import math
import os
from datetime import datetime

from PIL import Image, ImageDraw, ImageFilter, ImageFont


WIDTH = 1600
HEIGHT = 900
BACKGROUND = (2, 6, 12, 255)


def font(size):
    candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    )
    for candidate in candidates:
        if os.path.exists(candidate):
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                pass
    return ImageFont.load_default()


def format_duration(seconds):
    seconds = max(0, int(seconds))
    return "{:02d}:{:02d}:{:02d}".format(seconds // 3600, (seconds % 3600) // 60, seconds % 60)


def project(particle, scale):
    x, y, z, energy, size = particle
    angle = 0.58
    rotated_x = x * math.cos(angle) - y * math.sin(angle)
    depth = x * math.sin(angle) + y * math.cos(angle)
    vertical = z + depth * 0.10
    perspective = 1.0 / max(0.65, 1.7 + depth / scale)
    px = WIDTH * 0.5 + rotated_x / scale * 470 * perspective
    py = HEIGHT * 0.50 - vertical / scale * 470 * perspective
    return px, py, depth, float(energy), float(size)


def render(source_path, output_path):
    with open(source_path, "r", encoding="utf-8") as source:
        data = json.load(source)

    if data.get("schema") != "soul-field/v1":
        raise ValueError("unsupported field schema")
    particles = data.get("particles") or []
    if not particles:
        raise ValueError("field contains no particles")

    coordinate_max = max(abs(value) for particle in particles for value in particle[:3])
    scale = max(2.5, coordinate_max)

    image = Image.new("RGBA", (WIDTH, HEIGHT), BACKGROUND)
    grid = Image.new("RGBA", image.size, (0, 0, 0, 0))
    grid_draw = ImageDraw.Draw(grid)
    for x in range(80, WIDTH, 80):
        grid_draw.line((x, 0, x, HEIGHT), fill=(73, 150, 190, 14), width=1)
    for y in range(50, HEIGHT, 80):
        grid_draw.line((0, y, WIDTH, y), fill=(73, 150, 190, 12), width=1)
    image = Image.alpha_composite(image, grid)

    projected = sorted((project(particle, scale) for particle in particles), key=lambda item: item[2])
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    points = Image.new("RGBA", image.size, (0, 0, 0, 0))
    point_draw = ImageDraw.Draw(points)

    for x, y, depth, energy, size in projected:
        if not (-40 <= x <= WIDTH + 40 and -40 <= y <= HEIGHT + 40):
            continue
        warm = energy > 0.80
        color = (255, 196, 126) if warm else (112, 216, 255)
        radius = max(1.0, size * (1.2 + energy))
        glow_radius = radius * 4.2
        glow_draw.ellipse(
            (x - glow_radius, y - glow_radius, x + glow_radius, y + glow_radius),
            fill=color + (max(10, int(energy * 45)),),
        )
        point_draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius),
            fill=color + (max(55, int(90 + energy * 165)),),
        )

    glow = glow.filter(ImageFilter.GaussianBlur(radius=9))
    image = Image.alpha_composite(image, glow)
    image = Image.alpha_composite(image, points)

    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.text((72, 62), "SOUL EXTRACTOR / EXISTENCE FIELD", font=font(18), fill=(132, 217, 255, 220))
    draw.text((72, 96), "MID-70 ABSTRACT MEMORY", font=font(11), fill=(89, 117, 137, 220))
    draw.line((72, 130, 410, 130), fill=(105, 190, 230, 65), width=1)

    status = str(data.get("status", "unknown")).upper()
    active = format_duration(data.get("active_seconds", 0))
    energy = int(max(0, min(1, data.get("energy", 0))) * 100)
    details = "{}  /  {:,} PARTICLES  /  {}  /  ENERGY {:02d}%".format(
        status, len(particles), active, energy
    )
    draw.text((72, HEIGHT - 88), details, font=font(13), fill=(179, 220, 237, 220))
    updated = data.get("updated_at") or datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    draw.text((72, HEIGHT - 55), "LAST TRACE  {}".format(updated), font=font(10), fill=(70, 100, 117, 220))
    notice = "ARTISTIC RECORD / AGGREGATE DESCRIPTORS ONLY / NO RAW POINT CLOUD"
    draw.text((WIDTH - 650, HEIGHT - 55), notice, font=font(10), fill=(70, 100, 117, 190))
    image = Image.alpha_composite(image, overlay)

    output_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(output_dir, exist_ok=True)
    temporary = output_path + ".tmp.png"
    image.convert("RGB").save(temporary, "PNG", optimize=True)
    os.replace(temporary, output_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="soul-field/v1 JSON input")
    parser.add_argument("output", help="PNG output path")
    args = parser.parse_args()
    render(args.source, args.output)


if __name__ == "__main__":
    main()
