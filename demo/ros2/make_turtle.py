#!/usr/bin/env python3
"""Replace turtlesim's turtle sprites with a photo of the real rover.

    make_turtle.py <source-image> <turtlesim-images-dir>

Two things about turtlesim make this less obvious than dropping a file in.

**The sprite list is hardcoded.** `turtle_frame.cpp` appends eleven fixed
filenames (ardent.png ... rolling.png) and loads exactly those, so a new file in
that directory is simply ignored. The only way in is to overwrite the existing
names -- and since `spawnTurtle` picks `rand() % turtle_images_.size()`, every
one of them has to be replaced or the rover shows up only sometimes.

**The sprite's height is the world scale.** `meter_ = turtle_images_[0].height()`,
and the window is a fixed 500 px, so turtlesim's 45 px turtles are what make the
map 500/45 ~ 11.08 units across. Every landmark coordinate in rover_node.py, and
the map drawing itself, is expressed in those units. Writing a differently sized
sprite silently rescales the whole world and puts the lake somewhere else. So the
output size is taken from the images being replaced rather than hardcoded here,
and all of them are written at one size so it does not matter which one turtlesim
happens to treat as index 0.

The photo is scaled to fit and centred on a transparent square, then sharpened:
downscaling a 1372 px photo to 45 px leaves it muddy, and turtlesim rotates with
Qt's FastTransformation (nearest neighbour), which is unkind to soft edges.

A perspective photo cannot be right at every heading the way a top-down sprite
is: turtlesim rotates the sprite to the heading, so the rover turns with it.
What can be chosen is which heading it looks natural at, and that is east --
rover_node.py teleports to theta 0.0 on startup and on every hourly reset, so
east is how the rover sits whenever it is not driving, which is most of the
time anyone is watching. turtlesim treats the sprite as facing north and turns
it 90 degrees clockwise to draw east, so the photo goes in rotated 90 degrees
anticlockwise to come back out upright.
"""

import sys
from pathlib import Path

from PIL import Image, ImageFilter

# Undoes the north-to-east rotation turtlesim applies at theta 0; see above.
UPRIGHT_AT_EAST = 90


def build(source: Path, size: int) -> Image.Image:
    src = Image.open(source).convert("RGBA")
    src = src.rotate(UPRIGHT_AT_EAST, resample=Image.BICUBIC, expand=True)

    w, h = src.size
    scale = size / max(w, h)
    small = src.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

    # Keep the alpha out of the sharpen: unsharp masking the edge between the
    # rover and full transparency rings it with bright fringes.
    alpha = small.getchannel("A")
    sharp = small.convert("RGB").filter(ImageFilter.UnsharpMask(radius=1, percent=140, threshold=2))
    sharp = sharp.convert("RGBA")
    sharp.putalpha(alpha)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(sharp, ((size - sharp.size[0]) // 2, (size - sharp.size[1]) // 2), sharp)
    return canvas


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2

    source, images = Path(sys.argv[1]), Path(sys.argv[2])
    targets = sorted(images.glob("*.png"))
    if not targets:
        print(f"no turtle sprites found in {images}", file=sys.stderr)
        return 1

    # Match whatever turtlesim ships rather than assuming 45, so an upstream
    # change to the sprite size keeps the world the size the rover expects.
    sizes = {Image.open(t).size[1] for t in targets}
    if len(sizes) != 1:
        print(f"turtle sprites disagree on height ({sorted(sizes)}); refusing to guess", file=sys.stderr)
        return 1
    size = sizes.pop()

    sprite = build(source, size)
    for target in targets:
        sprite.save(target)

    print(f"[turtle] wrote {source.name} over {len(targets)} sprites at {size}x{size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
