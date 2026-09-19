#!/usr/bin/env python3
"""Freeze face_agent.py into a standalone executable with PyInstaller.

Produces `dist/face-agent` (`dist\\face-agent.exe` on Windows) — a single file
you can drop anywhere on a PC and run without a Python install.

    python scripts/build_executable.py            # one-file build
    python scripts/build_executable.py --onedir   # faster startup, a folder
    python scripts/build_executable.py --no-cv2   # skip the opencv bundle

The opencv wheel is large (~60 MB), so a one-file build takes a while and the
first launch pays an unpacking cost. --onedir avoids both if you don't need a
single file.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY = ROOT / "scripts" / "face_agent.py"


def has_module(name: str) -> bool:
    try:
        __import__(name)
    except Exception:
        return False
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--onedir", action="store_true", help="Build a folder instead of one file")
    parser.add_argument("--name", default="face-agent", help="Executable name")
    parser.add_argument("--no-cv2", action="store_true", help="Do not bundle opencv")
    parser.add_argument("--clean", action="store_true", help="Remove build/ and dist/ first")
    args = parser.parse_args(argv)

    if not ENTRY.is_file():
        print(f"error: cannot find {ENTRY}", file=sys.stderr)
        return 2
    if not has_module("PyInstaller"):
        print("error: PyInstaller is not installed. Run: pip install pyinstaller", file=sys.stderr)
        return 2

    if args.clean:
        for d in ("build", "dist"):
            shutil.rmtree(ROOT / d, ignore_errors=True)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--onedir" if args.onedir else "--onefile",
        "--console",
        "--name",
        args.name,
        "--distpath",
        str(ROOT / "dist"),
        "--workpath",
        str(ROOT / "build"),
        "--specpath",
        str(ROOT / "build"),
        "--noconfirm",
    ]

    # PyInstaller's static analysis cannot see these: the script imports them
    # lazily inside the backends so that the core runs without them installed.
    for module in ("sqlite3", "http.server", "urllib.request"):
        cmd += ["--hidden-import", module]
    if not args.no_cv2 and has_module("cv2"):
        cmd += ["--hidden-import", "cv2", "--collect-binaries", "cv2"]
    if has_module("face_recognition"):
        cmd += [
            "--hidden-import",
            "face_recognition",
            "--collect-data",
            "face_recognition_models",
        ]
    cmd.append(str(ENTRY))

    print("running:", " ".join(cmd), flush=True)
    result = subprocess.run(cmd, cwd=str(ROOT), check=False)
    if result.returncode != 0:
        print("\nBuild failed. See the PyInstaller output above.", file=sys.stderr)
        return result.returncode

    suffix = ".exe" if sys.platform == "win32" else ""
    built = ROOT / "dist" / (args.name + suffix if not args.onedir else args.name)
    print(f"\nBuilt: {built}")
    print("Next steps:")
    print(f"  {built} doctor")
    print(f"  {built} models --download")
    print("  Add its folder to PATH to run it as 'face-agent' from anywhere.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
