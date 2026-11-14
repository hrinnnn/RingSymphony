#!/usr/bin/env python3
"""Convert a Ring Studio .h5 capture into the recordings/ JSON the replay tools read.

Ring Studio writes the samples into an HDF5 file and leaves only a metadata sidecar
next to it as .json. recordings/ wants the samples themselves, in the flat
{samples, t, acc, gyr} shape that tools/replay and npm run eval already parse.

Usage: h5-to-recording.py <in.h5> <out.json>
"""
import json
import sys

import h5py


def convert(src, dest):
    with h5py.File(src, "r") as handle:
        samples = handle["samples"][:]
    # Device clock, rebased to zero: the existing recordings all start at t=0, and the
    # detectors only ever use differences.
    t = samples["timestamp"]
    t = [round(float(v - t[0]), 6) for v in t]
    acc = [[round(float(c), 5) for c in row] for row in samples["acc"]]
    gyr = [[round(float(c), 5) for c in row] for row in samples["gyr"]]
    body = {"samples": len(t), "t": t, "acc": acc, "gyr": gyr}
    with open(dest, "w") as out:
        json.dump(body, out, separators=(",", ":"))
    return len(t), t[-1]


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    count, duration = convert(sys.argv[1], sys.argv[2])
    print(f"{sys.argv[2]}: {count} samples, {duration:.1f}s")
