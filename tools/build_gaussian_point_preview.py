#!/usr/bin/env python3
"""Convert an INRIA Gaussian PLY into a compact RGB point-preview PLY."""
from __future__ import annotations

import argparse
from pathlib import Path
import numpy as np

SH_C0 = 0.28209479177387814


def read_header(path: Path):
    with path.open("rb") as handle:
        lines = []
        while True:
            line = handle.readline()
            if not line:
                raise ValueError(f"Missing end_header in {path}")
            lines.append(line.decode("ascii").strip())
            if lines[-1] == "end_header":
                break
        offset = handle.tell()
    vertex_line = next(line for line in lines if line.startswith("element vertex "))
    properties = [line.split()[-1] for line in lines if line.startswith("property ")]
    return offset, int(vertex_line.split()[-1]), properties


def convert(source: Path, target: Path):
    offset, count, properties = read_header(source)
    required = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2"]
    if any(name not in properties for name in required):
        raise ValueError(f"Unexpected Gaussian PLY properties in {source}")
    raw = np.memmap(source, dtype="<f4", mode="r", offset=offset, shape=(count, len(properties)))
    index = {name: properties.index(name) for name in properties}

    out_dtype = np.dtype([
        ("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
        ("red", "u1"), ("green", "u1"), ("blue", "u1"),
    ])
    preview = np.empty(count, dtype=out_dtype)
    preview["x"] = raw[:, index["x"]]
    # The existing point viewer flips Y for display. Bake the inverse here so
    # the preview lands exactly where the aligned Gaussian scene did.
    preview["y"] = -raw[:, index["y"]]
    preview["z"] = raw[:, index["z"]]
    colors = np.clip(0.5 + SH_C0 * raw[:, [index["f_dc_0"], index["f_dc_1"], index["f_dc_2"]]], 0, 1)
    rgb = np.rint(colors * 255).astype(np.uint8)
    preview["red"], preview["green"], preview["blue"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]

    header = "\n".join([
        "ply", "format binary_little_endian 1.0",
        f"comment compact {count}-point preview generated from aligned Gaussian centers",
        f"element vertex {count}",
        "property float x", "property float y", "property float z",
        "property uchar red", "property uchar green", "property uchar blue",
        "end_header", "",
    ]).encode("ascii")
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as handle:
        handle.write(header)
        preview.tofile(handle)
    print(f"{source.name}: {count:,} points -> {target} ({target.stat().st_size / 1048576:.1f} MiB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    convert(args.source, args.target)


if __name__ == "__main__":
    main()
