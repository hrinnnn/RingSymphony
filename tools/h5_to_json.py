"""Convert Ring Studio IMU recordings (.h5) to compact JSON for Node replay and tests.

Usage: python h5_to_json.py <data-dir> <out-dir>
Output per recording: {"samples": n, "t": [...], "acc": [[x,y,z]...], "gyr": [[x,y,z]...]}
acc is m/s^2, gyr is rad/s (device axes, unchanged).
"""
import json
import sys
from pathlib import Path

import h5py


def convert(src: Path, dst: Path) -> None:
    with h5py.File(src) as f:
        s = f["samples"][:]
    t = (s["timestamp"] - s["timestamp"][0]).round(5).tolist()
    out = {
        "samples": len(t),
        "t": t,
        "acc": s["acc"].round(4).tolist(),
        "gyr": s["gyr"].round(5).tolist(),
    }
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    data, out = Path(sys.argv[1]), Path(sys.argv[2])
    for h5 in sorted(data.rglob("*.h5")):
        rel = h5.relative_to(data)
        convert(h5, out / rel.parent.name / (rel.stem + ".json"))
        print(rel)


if __name__ == "__main__":
    main()
