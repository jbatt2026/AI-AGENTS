"""Test fixtures for face-agent.

The script is a standalone file under scripts/ rather than an installed
package, so we put that directory on sys.path and import it by name.
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import face_agent as fa  # noqa: E402


@pytest.fixture()
def module() -> Any:
    return fa


@pytest.fixture()
def store(tmp_path: Path) -> Any:
    with fa.FaceStore(tmp_path / "faces.db") as s:
        yield s


class FakeBackend(fa.Backend):
    """Backend that reads a vector out of a text file instead of an image.

    Lets the enroll/identify/serve paths be tested end to end without opencv,
    dlib, model downloads, or a camera.
    """

    def __init__(self, metric: str = "cosine", threshold: float = 0.5) -> None:
        super().__init__(
            name="fake",
            metric=metric,
            threshold=threshold,
            higher_is_better=(metric == "cosine"),
            worst_score=0.0 if metric == "cosine" else 2.0,
            requires=[],
        )
        self.frames: list[list[list[float]]] = []

    def available(self) -> tuple[bool, str]:
        return True, "ready"

    def embed_file(self, path: Path) -> list[list[float]]:
        # File format: one face per line, comma-separated floats.
        # An empty file means "no face detected".
        text = Path(path).read_text(encoding="utf-8").strip()
        if not text:
            return []
        return [[float(v) for v in line.split(",")] for line in text.splitlines() if line.strip()]

    def embed_frame(self, frame: Any) -> list[list[float]]:
        return self.frames.pop(0) if self.frames else []


@pytest.fixture()
def backend() -> FakeBackend:
    return FakeBackend()


def write_faces(path: Path, *vectors: Sequence[float]) -> Path:
    path.write_text("\n".join(",".join(str(v) for v in vec) for vec in vectors), encoding="utf-8")
    return path
