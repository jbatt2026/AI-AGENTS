#!/usr/bin/env python3
"""face-agent — local facial recognition service for AI agents.

A single-file, dependency-light tool that enrolls faces, identifies them from
image files or a webcam, and exposes both over a local HTTP API and an MCP
(stdio) server so an AI agent can call it as a tool.

Everything stays on this machine: embeddings live in a SQLite database under
~/.face_agent, the HTTP server binds to loopback only and requires a token, and
no image bytes are stored — only the numeric face templates.

Only enroll people who have agreed to it. Face data is biometric data; in many
places (Illinois BIPA, EU GDPR Art. 9, and others) collecting it without
informed consent is illegal regardless of where the software runs.

Usage:
    face-agent doctor
    face-agent models --download
    face-agent enroll --name "Jane" --images ./photos/jane
    face-agent enroll --name "Jane" --camera --shots 5
    face-agent list
    face-agent identify --image ./unknown.jpg --json
    face-agent identify --camera --json
    face-agent watch --camera
    face-agent serve --port 8765
    face-agent mcp
    face-agent schema
"""

from __future__ import annotations

import argparse
import base64
import binascii
import contextlib
import json
import math
import os
import secrets
import sqlite3
import struct
import sys
import tempfile
import time
import urllib.request
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

__version__ = "0.1.0"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}

MODEL_URLS = {
    "face_detection_yunet_2023mar.onnx": os.environ.get(
        "FACE_AGENT_YUNET_URL",
        "https://github.com/opencv/opencv_zoo/raw/main/models/"
        "face_detection_yunet/face_detection_yunet_2023mar.onnx",
    ),
    "face_recognition_sface_2021dec.onnx": os.environ.get(
        "FACE_AGENT_SFACE_URL",
        "https://github.com/opencv/opencv_zoo/raw/main/models/"
        "face_recognition_sface/face_recognition_sface_2021dec.onnx",
    ),
}


class FaceAgentError(Exception):
    """Any error we expect and can explain to the caller."""


# --------------------------------------------------------------------------
# paths
# --------------------------------------------------------------------------


def home_dir() -> Path:
    """Root directory for the database, token, and models."""
    raw = os.environ.get("FACE_AGENT_HOME")
    root = Path(raw).expanduser() if raw else Path.home() / ".face_agent"
    root.mkdir(parents=True, exist_ok=True)
    return root


def db_path() -> Path:
    return home_dir() / "faces.db"


def models_dir() -> Path:
    d = home_dir() / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------
# vector math (pure Python: the core stays importable with no third-party deps)
# --------------------------------------------------------------------------


def pack_vector(vec: Sequence[float]) -> bytes:
    return struct.pack(f"<{len(vec)}f", *(float(v) for v in vec))


def unpack_vector(blob: bytes) -> list[float]:
    if len(blob) % 4:
        raise FaceAgentError("corrupt embedding blob (length is not a multiple of 4)")
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def euclidean_distance(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b):
        raise FaceAgentError(f"dimension mismatch: {len(a)} vs {len(b)}")
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b, strict=True)))


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b):
        raise FaceAgentError(f"dimension mismatch: {len(a)} vs {len(b)}")
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def normalize_confidence(
    score: float, threshold: float, higher_is_better: bool, worst: float
) -> float:
    """Map a backend-specific score onto 0..1 with exactly 0.5 at the threshold.

    Backends disagree about what a good score looks like — dlib reports a
    distance where lower wins, SFace reports a cosine similarity where higher
    wins. Agents consuming the JSON should not have to know which, so every
    result also carries this normalized confidence.
    """
    if higher_is_better:
        best = 1.0
        if score >= threshold:
            span = max(1e-9, best - threshold)
            return 0.5 + 0.5 * clamp((score - threshold) / span)
        span = max(1e-9, threshold - worst)
        return 0.5 - 0.5 * clamp((threshold - score) / span)
    best = 0.0
    if score <= threshold:
        span = max(1e-9, threshold - best)
        return 0.5 + 0.5 * clamp((threshold - score) / span)
    span = max(1e-9, worst - threshold)
    return 0.5 - 0.5 * clamp((score - threshold) / span)


# --------------------------------------------------------------------------
# storage
# --------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS identities (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS faces (
    id          INTEGER PRIMARY KEY,
    identity_id INTEGER NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
    backend     TEXT NOT NULL,
    dim         INTEGER NOT NULL,
    embedding   BLOB NOT NULL,
    source      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS faces_backend_idx ON faces(backend);
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY,
    ts         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    confidence REAL,
    detail     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_ts_idx ON events(ts);
"""


@dataclass
class Match:
    name: str
    score: float
    confidence: float
    matched: bool
    metric: str
    threshold: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name if self.matched else "unknown",
            "candidate": self.name,
            "matched": self.matched,
            "score": round(self.score, 6),
            "confidence": round(self.confidence, 4),
            "metric": self.metric,
            "threshold": self.threshold,
        }


class FaceStore:
    """SQLite-backed store of identities, embeddings, and recognition events."""

    def __init__(self, path: Path | str | None = None) -> None:
        self.path = Path(path) if path is not None else db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> FaceStore:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- identities --------------------------------------------------------

    def identity_id(self, name: str, create: bool = False) -> int | None:
        row = self.conn.execute("SELECT id FROM identities WHERE name = ?", (name,)).fetchone()
        if row:
            return int(row["id"])
        if not create:
            return None
        cur = self.conn.execute(
            "INSERT INTO identities (name, created_at) VALUES (?, ?)",
            (name, now_iso()),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def add_face(
        self,
        name: str,
        embedding: Sequence[float],
        backend: str,
        source: str = "",
    ) -> int:
        if not name.strip():
            raise FaceAgentError("identity name must not be empty")
        if not embedding:
            raise FaceAgentError("refusing to store an empty embedding")
        ident = self.identity_id(name, create=True)
        cur = self.conn.execute(
            "INSERT INTO faces (identity_id, backend, dim, embedding, source, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (ident, backend, len(embedding), pack_vector(embedding), source, now_iso()),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def list_identities(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT i.name, i.notes, i.created_at,"
            "       COUNT(f.id) AS samples,"
            "       GROUP_CONCAT(DISTINCT f.backend) AS backends"
            " FROM identities i LEFT JOIN faces f ON f.identity_id = i.id"
            " GROUP BY i.id ORDER BY i.name"
        ).fetchall()
        return [
            {
                "name": r["name"],
                "samples": int(r["samples"]),
                "backends": sorted((r["backends"] or "").split(",")) if r["backends"] else [],
                "notes": r["notes"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]

    def remove_identity(self, name: str) -> int:
        cur = self.conn.execute("DELETE FROM identities WHERE name = ?", (name,))
        self.conn.commit()
        return cur.rowcount

    def faces_for_backend(self, backend: str) -> list[tuple[str, list[float]]]:
        rows = self.conn.execute(
            "SELECT i.name AS name, f.embedding AS embedding"
            " FROM faces f JOIN identities i ON i.id = f.identity_id"
            " WHERE f.backend = ?",
            (backend,),
        ).fetchall()
        return [(r["name"], unpack_vector(r["embedding"])) for r in rows]

    # -- matching ----------------------------------------------------------

    def match(
        self,
        embedding: Sequence[float],
        backend: Backend,
        threshold: float | None = None,
    ) -> Match | None:
        """Best identity for an embedding, or None when nothing is enrolled.

        Embeddings from different backends are never comparable, so only rows
        stored by the same backend are considered.
        """
        thr = backend.threshold if threshold is None else threshold
        known = self.faces_for_backend(backend.name)
        if not known:
            return None

        best_name = ""
        best_score = None
        for name, vec in known:
            if len(vec) != len(embedding):
                continue
            score = backend.score(embedding, vec)
            if best_score is None or backend.is_better(score, best_score):
                best_score, best_name = score, name
        if best_score is None:
            return None

        matched = best_score >= thr if backend.higher_is_better else best_score <= thr
        return Match(
            name=best_name,
            score=best_score,
            confidence=normalize_confidence(
                best_score, thr, backend.higher_is_better, backend.worst_score
            ),
            matched=matched,
            metric=backend.metric,
            threshold=thr,
        )

    # -- events ------------------------------------------------------------

    def log_event(
        self, kind: str, name: str = "", confidence: float | None = None, detail: str = ""
    ) -> None:
        self.conn.execute(
            "INSERT INTO events (ts, kind, name, confidence, detail) VALUES (?, ?, ?, ?, ?)",
            (now_iso(), kind, name, confidence, detail),
        )
        self.conn.commit()

    def recent_events(self, limit: int = 20) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT ts, kind, name, confidence, detail FROM events ORDER BY id DESC LIMIT ?",
            (max(1, int(limit)),),
        ).fetchall()
        return [dict(r) for r in rows]


# --------------------------------------------------------------------------
# backends
# --------------------------------------------------------------------------


@dataclass
class Backend:
    """A face detector + embedder pair.

    `score` is backend-specific; `higher_is_better` says which direction wins,
    and `worst_score` anchors the normalized confidence.
    """

    name: str
    metric: str
    threshold: float
    higher_is_better: bool
    worst_score: float
    requires: list[str] = field(default_factory=list)

    def score(self, a: Sequence[float], b: Sequence[float]) -> float:
        if self.metric == "cosine":
            return cosine_similarity(a, b)
        return euclidean_distance(a, b)

    def is_better(self, candidate: float, incumbent: float) -> bool:
        return candidate > incumbent if self.higher_is_better else candidate < incumbent

    # Subclasses implement these; the base class keeps the math testable
    # without any of the heavy vision dependencies installed.
    def available(self) -> tuple[bool, str]:
        return False, "backend is abstract"

    def embed_file(self, path: Path) -> list[list[float]]:
        raise NotImplementedError

    def embed_frame(self, frame: Any) -> list[list[float]]:
        raise NotImplementedError


class DlibBackend(Backend):
    """`face_recognition` (dlib ResNet). 128-d embeddings, euclidean distance."""

    def __init__(self, threshold: float = 0.6, model: str = "hog") -> None:
        super().__init__(
            name="dlib",
            metric="euclidean",
            threshold=threshold,
            higher_is_better=False,
            worst_score=1.2,
            requires=["face_recognition"],
        )
        self.model = model

    def available(self) -> tuple[bool, str]:
        try:
            import face_recognition  # noqa: F401
        except Exception as exc:  # pragma: no cover - depends on environment
            return False, f"face_recognition not importable: {exc}"
        return True, "ready"

    def _fr(self) -> Any:
        try:
            import face_recognition
        except Exception as exc:
            raise FaceAgentError(
                "backend 'dlib' needs the face_recognition package: "
                "pip install face_recognition (requires cmake + dlib)"
            ) from exc
        return face_recognition

    def embed_file(self, path: Path) -> list[list[float]]:
        fr = self._fr()
        image = fr.load_image_file(str(path))
        return self._encode(fr, image)

    def embed_frame(self, frame: Any) -> list[list[float]]:
        fr = self._fr()
        # OpenCV hands us BGR; dlib expects RGB.
        return self._encode(fr, frame[:, :, ::-1])

    def _encode(self, fr: Any, rgb: Any) -> list[list[float]]:
        boxes = fr.face_locations(rgb, model=self.model)
        if not boxes:
            return []
        return [list(map(float, e)) for e in fr.face_encodings(rgb, boxes)]


class SFaceBackend(Backend):
    """OpenCV YuNet detector + SFace embedder. 128-d, cosine similarity.

    Pip-installable with no compiler, which makes it the practical default on
    Windows. Needs two ONNX files — `face-agent models --download` fetches them.
    """

    def __init__(self, threshold: float = 0.363, models: Path | None = None) -> None:
        super().__init__(
            name="sface",
            metric="cosine",
            threshold=threshold,
            higher_is_better=True,
            worst_score=0.0,
            requires=["opencv-python"],
        )
        self.models = models or models_dir()
        self._detector: Any = None
        self._recognizer: Any = None

    @property
    def detector_path(self) -> Path:
        return self.models / "face_detection_yunet_2023mar.onnx"

    @property
    def recognizer_path(self) -> Path:
        return self.models / "face_recognition_sface_2021dec.onnx"

    def missing_models(self) -> list[str]:
        """Model files that are absent, or too small to be real models.

        A Git LFS pointer left behind by a bad download is ~130 bytes and would
        otherwise look present until OpenCV chokes on it.
        """
        return [
            path.name
            for path in (self.detector_path, self.recognizer_path)
            if not path.exists() or path.stat().st_size < MIN_MODEL_BYTES
        ]

    def available(self) -> tuple[bool, str]:
        try:
            import cv2
        except Exception as exc:  # pragma: no cover - depends on environment
            return False, f"opencv not importable: {exc}"
        if not hasattr(cv2, "FaceDetectorYN"):
            return False, "this opencv build has no FaceDetectorYN (needs >= 4.5.4)"
        missing = self.missing_models()
        if missing:
            return (
                False,
                f"missing or truncated model files: {', '.join(missing)}"
                " (run: face-agent models --download)",
            )
        return True, "ready"

    def _load(self) -> tuple[Any, Any]:
        ok, reason = self.available()
        if not ok:
            raise FaceAgentError(f"backend 'sface' unavailable: {reason}")
        import cv2

        try:
            if self._detector is None:
                self._detector = cv2.FaceDetectorYN.create(
                    str(self.detector_path), "", (320, 320), 0.8, 0.3, 5000
                )
            if self._recognizer is None:
                self._recognizer = cv2.FaceRecognizerSF.create(str(self.recognizer_path), "")
        except cv2.error as exc:
            # A truncated or corrupt .onnx gets this far only if it cleared the
            # size check; say what to do instead of dumping an OpenCV traceback.
            raise FaceAgentError(
                f"OpenCV could not load the models in {self.models}. They are "
                "probably corrupt — delete them and run: face-agent models --download"
                f" (OpenCV said: {str(exc).splitlines()[-1].strip()})"
            ) from exc
        return self._detector, self._recognizer

    def embed_file(self, path: Path) -> list[list[float]]:
        import cv2

        image = cv2.imread(str(path))
        if image is None:
            raise FaceAgentError(f"could not read image: {path}")
        return self.embed_frame(image)

    def embed_frame(self, frame: Any) -> list[list[float]]:
        detector, recognizer = self._load()
        height, width = frame.shape[:2]
        detector.setInputSize((width, height))
        _, faces = detector.detect(frame)
        if faces is None:
            return []
        out: list[list[float]] = []
        for face in faces:
            aligned = recognizer.alignCrop(frame, face)
            feature = recognizer.feature(aligned)
            out.append([float(v) for v in feature.flatten()])
        return out


def build_backend(name: str, threshold: float | None = None) -> Backend:
    if name == "dlib":
        return DlibBackend(threshold if threshold is not None else 0.6)
    if name == "sface":
        return SFaceBackend(threshold if threshold is not None else 0.363)
    raise FaceAgentError(f"unknown backend '{name}' (choose: sface, dlib)")


def auto_backend(threshold: float | None = None) -> Backend:
    """Pick the first backend that can actually run on this machine."""
    reasons = []
    for name in ("sface", "dlib"):
        backend = build_backend(name, threshold)
        ok, reason = backend.available()
        if ok:
            return backend
        reasons.append(f"{name}: {reason}")
    raise FaceAgentError(
        "no usable face recognition backend.\n  "
        + "\n  ".join(reasons)
        + "\nRun 'face-agent doctor' for setup instructions."
    )


def resolve_backend(name: str, threshold: float | None = None) -> Backend:
    return auto_backend(threshold) if name == "auto" else build_backend(name, threshold)


# --------------------------------------------------------------------------
# camera + image helpers
# --------------------------------------------------------------------------


def iter_images(paths: Iterable[str]) -> list[Path]:
    """Expand a mix of files and directories into a sorted list of images."""
    found: list[Path] = []
    for raw in paths:
        p = Path(raw).expanduser()
        if p.is_dir():
            found.extend(sorted(c for c in p.rglob("*") if c.suffix.lower() in IMAGE_SUFFIXES))
        elif p.is_file():
            found.append(p)
        else:
            raise FaceAgentError(f"no such file or directory: {p}")
    if not found:
        raise FaceAgentError("no images found in the given paths")
    return found


@contextlib.contextmanager
def open_camera(index: int = 0, warmup: int = 5) -> Any:
    """Open a webcam, discarding the first frames while exposure settles."""
    try:
        import cv2
    except Exception as exc:
        raise FaceAgentError("camera capture needs opencv: pip install opencv-python") from exc
    cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        cap.release()
        raise FaceAgentError(
            f"could not open camera {index}. Check that no other app holds it "
            "and that camera permission is granted to this program."
        )
    try:
        for _ in range(max(0, warmup)):
            cap.read()
        yield cap
    finally:
        cap.release()


def grab_frame(cap: Any) -> Any:
    ok, frame = cap.read()
    if not ok or frame is None:
        raise FaceAgentError("camera returned no frame")
    return frame


def decode_image_b64(data: str) -> Path:
    """Write a base64 image to a temp file so backends can read it by path."""
    if "," in data[:64] and data.lstrip().startswith("data:"):
        data = data.split(",", 1)[1]
    # Agents and HTTP clients often wrap base64 at 76 columns; strict decoding
    # would reject that, so drop whitespace before validating.
    data = "".join(data.split())
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise FaceAgentError(f"image_base64 is not valid base64: {exc}") from exc
    if not raw:
        raise FaceAgentError("image_base64 decoded to zero bytes")
    fd, name = tempfile.mkstemp(prefix="face_agent_", suffix=".img")
    with os.fdopen(fd, "wb") as fh:
        fh.write(raw)
    return Path(name)


# --------------------------------------------------------------------------
# core operations — every one returns a plain dict, so the CLI, the HTTP API
# and the MCP server all share exactly the same behavior.
# --------------------------------------------------------------------------


def op_enroll(
    store: FaceStore,
    backend: Backend,
    name: str,
    image_paths: Sequence[str] | None = None,
    camera: int | None = None,
    shots: int = 3,
    delay: float = 0.8,
) -> dict[str, Any]:
    if not name or not name.strip():
        raise FaceAgentError("enroll needs a --name")
    name = name.strip()
    added, skipped = 0, []

    if image_paths:
        for path in iter_images(image_paths):
            try:
                embeddings = backend.embed_file(path)
            except FaceAgentError as exc:
                skipped.append({"source": str(path), "reason": str(exc)})
                continue
            if len(embeddings) != 1:
                skipped.append(
                    {
                        "source": str(path),
                        "reason": f"expected exactly 1 face, found {len(embeddings)}",
                    }
                )
                continue
            store.add_face(name, embeddings[0], backend.name, source=str(path))
            added += 1
    elif camera is not None:
        with open_camera(camera) as cap:
            for shot in range(max(1, shots)):
                frame = grab_frame(cap)
                embeddings = backend.embed_frame(frame)
                if len(embeddings) != 1:
                    skipped.append(
                        {
                            "source": f"camera shot {shot + 1}",
                            "reason": f"expected exactly 1 face, found {len(embeddings)}",
                        }
                    )
                else:
                    store.add_face(name, embeddings[0], backend.name, source=f"camera:{camera}")
                    added += 1
                if shot < shots - 1:
                    time.sleep(delay)
    else:
        raise FaceAgentError("enroll needs either --images or --camera")

    store.log_event("enroll", name, None, f"added={added} skipped={len(skipped)}")
    return {
        "ok": added > 0,
        "name": name,
        "backend": backend.name,
        "added": added,
        "skipped": skipped,
        "total_samples": next(
            (i["samples"] for i in store.list_identities() if i["name"] == name), added
        ),
    }


def op_identify(
    store: FaceStore,
    backend: Backend,
    image: str | None = None,
    image_base64: str | None = None,
    camera: int | None = None,
    threshold: float | None = None,
) -> dict[str, Any]:
    temp: Path | None = None
    try:
        if image_base64:
            temp = decode_image_b64(image_base64)
            embeddings = backend.embed_file(temp)
            source = "base64"
        elif image:
            path = Path(image).expanduser()
            if not path.is_file():
                raise FaceAgentError(f"no such image: {path}")
            embeddings = backend.embed_file(path)
            source = str(path)
        elif camera is not None:
            with open_camera(camera) as cap:
                embeddings = backend.embed_frame(grab_frame(cap))
            source = f"camera:{camera}"
        else:
            raise FaceAgentError("identify needs --image, --camera, or image_base64")
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)

    faces = []
    for embedding in embeddings:
        match = store.match(embedding, backend, threshold)
        if match is None:
            faces.append(
                {
                    "name": "unknown",
                    "matched": False,
                    "reason": f"no faces enrolled for backend '{backend.name}'",
                }
            )
        else:
            faces.append(match.to_dict())

    best = max(
        (f for f in faces if f.get("matched")),
        key=lambda f: f.get("confidence", 0.0),
        default=None,
    )
    store.log_event(
        "identify",
        best["name"] if best else "unknown",
        best["confidence"] if best else None,
        source,
    )
    return {
        "ok": True,
        "source": source,
        "backend": backend.name,
        "faces_detected": len(embeddings),
        "faces": faces,
        "best_match": best,
        "timestamp": now_iso(),
    }


def op_list(store: FaceStore) -> dict[str, Any]:
    identities = store.list_identities()
    return {
        "ok": True,
        "count": len(identities),
        "identities": identities,
        "database": str(store.path),
    }


def op_remove(store: FaceStore, name: str) -> dict[str, Any]:
    removed = store.remove_identity(name)
    if removed:
        store.log_event("remove", name)
    return {"ok": bool(removed), "name": name, "removed": bool(removed)}


def op_events(store: FaceStore, limit: int = 20) -> dict[str, Any]:
    return {"ok": True, "events": store.recent_events(limit)}


def op_doctor(store_path: Path | None = None) -> dict[str, Any]:
    backends = []
    for name in ("sface", "dlib"):
        backend = build_backend(name)
        ok, reason = backend.available()
        backends.append(
            {
                "name": name,
                "available": ok,
                "detail": reason,
                "metric": backend.metric,
                "default_threshold": backend.threshold,
                "requires": backend.requires,
            }
        )
    try:
        import cv2

        opencv = cv2.__version__
    except Exception:
        opencv = None

    camera_ok, camera_detail = False, "not probed (opencv missing)"
    if opencv:
        try:
            with open_camera(0, warmup=1) as cap:
                grab_frame(cap)
            camera_ok, camera_detail = True, "camera 0 delivered a frame"
        except Exception as exc:
            camera_detail = str(exc)

    path = store_path or db_path()
    return {
        "ok": any(b["available"] for b in backends),
        "version": __version__,
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "home": str(home_dir()),
        "database": str(path),
        "database_exists": Path(path).exists(),
        "models_dir": str(models_dir()),
        "opencv": opencv,
        "camera": {"available": camera_ok, "detail": camera_detail},
        "backends": backends,
        "hint": ("Install a backend: pip install opencv-python && face-agent models --download"),
    }


# Smallest plausible ONNX model. Anything under this is a redirect page, an
# error body, or a Git LFS pointer rather than a model.
MIN_MODEL_BYTES = 50_000
LFS_POINTER_PREFIX = b"version https://git-lfs"


def validate_model_bytes(data: bytes, filename: str) -> None:
    """Reject anything that is not actually a model file.

    The opencv_zoo .onnx files are stored in Git LFS. A plain
    raw.githubusercontent.com URL serves the ~130-byte pointer instead of the
    model, and OpenCV then fails much later with an opaque parse error. Catch
    it at download time, where the message can say what to do.
    """
    if not data:
        raise FaceAgentError("downloaded file was empty")
    if data.startswith(LFS_POINTER_PREFIX):
        raise FaceAgentError(
            "got a Git LFS pointer instead of the model. The URL must be the "
            "github.com/.../raw/... form (which follows LFS), not "
            "raw.githubusercontent.com."
        )
    if len(data) < MIN_MODEL_BYTES:
        raise FaceAgentError(
            f"{filename} is only {len(data)} bytes, far too small to be a model "
            "(expected an error page or a truncated download)"
        )


def op_download_models(dest: Path | None = None) -> dict[str, Any]:
    target = dest or models_dir()
    target.mkdir(parents=True, exist_ok=True)
    results = []
    for filename, url in MODEL_URLS.items():
        out = target / filename
        if out.exists() and out.stat().st_size >= MIN_MODEL_BYTES:
            results.append(
                {"file": filename, "status": "already present", "bytes": out.stat().st_size}
            )
            continue
        tmp = out.with_suffix(out.suffix + ".part")
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                data = resp.read()
            validate_model_bytes(data, filename)
            tmp.write_bytes(data)
            tmp.replace(out)
            results.append({"file": filename, "status": "downloaded", "bytes": out.stat().st_size})
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            results.append({"file": filename, "status": "failed", "error": str(exc), "url": url})
    return {
        "ok": all(r["status"] != "failed" for r in results),
        "models_dir": str(target),
        "results": results,
    }


def op_watch(
    store: FaceStore,
    backend: Backend,
    camera: int = 0,
    interval: float = 1.0,
    cooldown: float = 10.0,
    threshold: float | None = None,
    limit: int = 0,
    emit: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Poll the camera and emit one JSON line per recognition event.

    `cooldown` suppresses repeat events for the same person, so an agent
    watching the stream sees arrivals rather than a frame-rate firehose.
    """
    emit = emit or (lambda ev: print(json.dumps(ev), flush=True))
    last_seen: dict[str, float] = {}
    emitted = 0
    with open_camera(camera) as cap:
        while True:
            try:
                frame = grab_frame(cap)
                for embedding in backend.embed_frame(frame):
                    match = store.match(embedding, backend, threshold)
                    name = match.name if match and match.matched else "unknown"
                    now = time.monotonic()
                    if now - last_seen.get(name, -1e9) < cooldown:
                        continue
                    last_seen[name] = now
                    event = {
                        "event": "face_seen",
                        "name": name,
                        "confidence": round(match.confidence, 4) if match else 0.0,
                        "camera": camera,
                        "backend": backend.name,
                        "timestamp": now_iso(),
                    }
                    store.log_event("watch", name, event["confidence"], f"camera:{camera}")
                    emit(event)
                    emitted += 1
                    if limit and emitted >= limit:
                        return {"ok": True, "events": emitted}
            except FaceAgentError as exc:
                emit({"event": "error", "error": str(exc), "timestamp": now_iso()})
            time.sleep(max(0.0, interval))


# --------------------------------------------------------------------------
# local API token
# --------------------------------------------------------------------------


def token_path() -> Path:
    return home_dir() / "token"


def load_token(create: bool = True) -> str:
    env = os.environ.get("FACE_AGENT_TOKEN")
    if env:
        return env
    path = token_path()
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value
    if not create:
        return ""
    value = secrets.token_urlsafe(32)
    path.write_text(value + "\n", encoding="utf-8")
    with contextlib.suppress(OSError):  # best effort; Windows ignores chmod
        path.chmod(0o600)
    return value


# --------------------------------------------------------------------------
# tool surface shared by the HTTP API and the MCP server
# --------------------------------------------------------------------------

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "face_identify",
        "description": (
            "Identify the people in an image file, a base64 image, or a webcam "
            "snapshot, against the locally enrolled faces. Returns each detected "
            "face with a name (or 'unknown') and a 0-1 confidence."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "image": {
                    "type": "string",
                    "description": "Path to an image file on this machine.",
                },
                "image_base64": {"type": "string", "description": "Base64-encoded image bytes."},
                "camera": {"type": "integer", "description": "Camera index to snapshot, e.g. 0."},
                "threshold": {
                    "type": "number",
                    "description": "Override the backend match threshold.",
                },
            },
        },
    },
    {
        "name": "face_enroll",
        "description": (
            "Enroll a person from image files or webcam shots so they can be "
            "recognized later. Only use with the person's consent."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Identity label, e.g. 'Jane Doe'."},
                "images": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Image files or directories containing exactly one face each.",
                },
                "camera": {"type": "integer", "description": "Camera index to capture from."},
                "shots": {"type": "integer", "description": "Number of webcam shots (default 3)."},
            },
            "required": ["name"],
        },
    },
    {
        "name": "face_list",
        "description": "List every enrolled identity with its sample count.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "face_remove",
        "description": "Delete an enrolled identity and all of its face samples.",
        "input_schema": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    },
    {
        "name": "face_events",
        "description": "Recent recognition events (most recent first).",
        "input_schema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "Default 20."}},
        },
    },
    {
        "name": "face_status",
        "description": "Health check: backends, models, camera, database location.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


def dispatch_tool(
    tool: str, args: dict[str, Any], store: FaceStore, backend_name: str
) -> dict[str, Any]:
    """Run one named tool call. Raises FaceAgentError for anything the caller got wrong."""
    args = args or {}
    if tool == "face_status":
        return op_doctor(store.path)
    if tool == "face_list":
        return op_list(store)
    if tool == "face_events":
        return op_events(store, int(args.get("limit", 20)))
    if tool == "face_remove":
        name = args.get("name")
        if not name:
            raise FaceAgentError("face_remove requires 'name'")
        return op_remove(store, str(name))

    threshold = args.get("threshold")
    backend = resolve_backend(backend_name, float(threshold) if threshold is not None else None)
    if tool == "face_identify":
        return op_identify(
            store,
            backend,
            image=args.get("image"),
            image_base64=args.get("image_base64"),
            camera=args.get("camera"),
            threshold=float(threshold) if threshold is not None else None,
        )
    if tool == "face_enroll":
        name = args.get("name")
        if not name:
            raise FaceAgentError("face_enroll requires 'name'")
        return op_enroll(
            store,
            backend,
            str(name),
            image_paths=args.get("images"),
            camera=args.get("camera"),
            shots=int(args.get("shots", 3)),
        )
    raise FaceAgentError(f"unknown tool '{tool}'")


# --------------------------------------------------------------------------
# local HTTP API
# --------------------------------------------------------------------------


def make_http_handler(store_path: Path, backend_name: str, token: str) -> type:
    from http.server import BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        server_version = f"face-agent/{__version__}"

        def log_message(self, fmt: str, *args: Any) -> None:  # quieter default logging
            sys.stderr.write(f"[{now_iso()}] {self.address_string()} {fmt % args}\n")

        # -- plumbing --
        def _send(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self) -> bool:
            header = self.headers.get("Authorization", "")
            supplied = (
                header[7:].strip()
                if header.lower().startswith("bearer ")
                else self.headers.get("X-Face-Agent-Token", "")
            )
            return bool(supplied) and secrets.compare_digest(supplied, token)

        def _body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if not length:
                return {}
            raw = self.rfile.read(length)
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise FaceAgentError(f"request body is not valid JSON: {exc}") from exc
            if not isinstance(parsed, dict):
                raise FaceAgentError("request body must be a JSON object")
            return parsed

        # -- routes --
        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            if self.path.rstrip("/") == "/health":
                self._send(200, {"ok": True, "service": "face-agent", "version": __version__})
                return
            if not self._authorized():
                self._send(401, {"ok": False, "error": "missing or invalid token"})
                return
            if self.path.rstrip("/") == "/tools":
                self._send(200, {"ok": True, "tools": TOOL_SCHEMAS})
                return
            self._send(404, {"ok": False, "error": f"no such route: {self.path}"})

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            if not self._authorized():
                self._send(401, {"ok": False, "error": "missing or invalid token"})
                return
            name = self.path.strip("/").split("/")[-1]
            if name and not name.startswith("face_"):
                name = f"face_{name}"
            try:
                args = self._body()
                with FaceStore(store_path) as store:
                    self._send(200, dispatch_tool(name, args, store, backend_name))
            except FaceAgentError as exc:
                self._send(400, {"ok": False, "error": str(exc)})
            except Exception as exc:  # unexpected: report, keep serving
                self._send(500, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})

    return Handler


def op_serve(
    store_path: Path,
    backend_name: str,
    host: str = "127.0.0.1",
    port: int = 8765,
    token: str | None = None,
    serve_forever: bool = True,
) -> Any:
    from http.server import ThreadingHTTPServer

    token = token or load_token()
    if host not in ("127.0.0.1", "localhost", "::1"):
        print(
            f"WARNING: binding to {host} exposes face recognition beyond this "
            "machine. Only do this on a network you control.",
            file=sys.stderr,
        )
    handler = make_http_handler(store_path, backend_name, token)
    httpd = ThreadingHTTPServer((host, port), handler)
    actual = httpd.server_address[1]
    print(f"face-agent HTTP API on http://{host}:{actual}", file=sys.stderr)
    print(f"  token: {token}", file=sys.stderr)
    print(
        f"  try:   curl -H 'Authorization: Bearer {token}' http://{host}:{actual}/tools",
        file=sys.stderr,
    )
    if not serve_forever:
        return httpd
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return httpd


# --------------------------------------------------------------------------
# MCP stdio server (JSON-RPC 2.0, one message per line)
# --------------------------------------------------------------------------

MCP_PROTOCOL_VERSION = "2024-11-05"


def mcp_result(msg_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def mcp_error(msg_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def handle_mcp_message(
    msg: dict[str, Any], store_path: Path, backend_name: str
) -> dict[str, Any] | None:
    """Handle one JSON-RPC message. Returns None for notifications."""
    method = msg.get("method")
    msg_id = msg.get("id")
    params = msg.get("params") or {}

    if method == "initialize":
        return mcp_result(
            msg_id,
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "face-agent", "version": __version__},
            },
        )
    if method in ("notifications/initialized", "initialized"):
        return None
    if method == "ping":
        return mcp_result(msg_id, {})
    if method == "tools/list":
        return mcp_result(
            msg_id,
            {
                "tools": [
                    {
                        "name": t["name"],
                        "description": t["description"],
                        "inputSchema": t["input_schema"],
                    }
                    for t in TOOL_SCHEMAS
                ]
            },
        )
    if method == "tools/call":
        tool = params.get("name", "")
        args = params.get("arguments") or {}
        try:
            with FaceStore(store_path) as store:
                payload = dispatch_tool(tool, args, store, backend_name)
            return mcp_result(
                msg_id,
                {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]},
            )
        except FaceAgentError as exc:
            return mcp_result(
                msg_id,
                {
                    "content": [{"type": "text", "text": str(exc)}],
                    "isError": True,
                },
            )
    if msg_id is None:
        return None
    return mcp_error(msg_id, -32601, f"method not found: {method}")


def op_mcp(
    store_path: Path,
    backend_name: str,
    stdin: Any = None,
    stdout: Any = None,
) -> None:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            stdout.write(json.dumps(mcp_error(None, -32700, f"parse error: {exc}")) + "\n")
            stdout.flush()
            continue
        try:
            response = handle_mcp_message(msg, store_path, backend_name)
        except Exception as exc:  # never let one bad call kill the server
            response = mcp_error(
                msg.get("id"), -32603, f"internal error: {type(exc).__name__}: {exc}"
            )
        if response is not None:
            stdout.write(json.dumps(response) + "\n")
            stdout.flush()


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def emit(payload: dict[str, Any], as_json: bool, human: Callable[[dict[str, Any]], str]) -> int:
    if as_json:
        print(json.dumps(payload, indent=2))
    else:
        print(human(payload))
    return 0 if payload.get("ok", True) else 1


def human_doctor(d: dict[str, Any]) -> str:
    lines = [
        f"face-agent {d['version']}  (python {d['python']} on {d['platform']})",
        f"  home      : {d['home']}",
        f"  database  : {d['database']} ({'exists' if d['database_exists'] else 'not created yet'})",
        f"  opencv    : {d['opencv'] or 'not installed'}",
        f"  camera    : {'ok — ' if d['camera']['available'] else 'unavailable — '}{d['camera']['detail']}",
        "  backends  :",
    ]
    for b in d["backends"]:
        flag = "ok " if b["available"] else "-- "
        lines.append(
            f"    [{flag}] {b['name']:<6} {b['metric']:<9} thr={b['default_threshold']}  {b['detail']}"
        )
    if not d["ok"]:
        lines.append(f"\n  {d['hint']}")
    return "\n".join(lines)


def human_identify(d: dict[str, Any]) -> str:
    if not d["faces"]:
        return f"No faces detected in {d['source']}."
    lines = [f"{d['faces_detected']} face(s) in {d['source']} (backend {d['backend']}):"]
    for i, f in enumerate(d["faces"], 1):
        if f.get("matched"):
            lines.append(
                f"  {i}. {f['name']}  confidence={f['confidence']:.2f}"
                f"  ({f['metric']}={f['score']:.4f}, threshold={f['threshold']})"
            )
        else:
            reason = f.get("reason")
            extra = (
                f" — {reason}"
                if reason
                else (
                    f"  (closest: {f.get('candidate')} at confidence {f.get('confidence', 0):.2f})"
                )
            )
            lines.append(f"  {i}. unknown{extra}")
    return "\n".join(lines)


def human_list(d: dict[str, Any]) -> str:
    if not d["count"]:
        return f"No identities enrolled yet ({d['database']})."
    lines = [f"{d['count']} identity(ies) in {d['database']}:"]
    for i in d["identities"]:
        backends = ",".join(i["backends"]) or "-"
        lines.append(
            f"  {i['name']:<24} {i['samples']:>3} sample(s)  [{backends}]  since {i['created_at']}"
        )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="face-agent",
        description="Local facial recognition for AI agents. Enroll only with consent.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", action="version", version=f"face-agent {__version__}")

    # The shared flags are accepted both before and after the subcommand, so
    # `face-agent identify --json` works as well as `face-agent --json
    # identify`. The top-level parser owns the real defaults; the copy handed
    # to the subcommands defaults to SUPPRESS so that an unused flag after the
    # subcommand cannot overwrite a value given before it. The two sets must
    # stay separate: set_defaults() mutates action objects in place, and a
    # shared action would carry the default into every subparser.
    def add_common(target: argparse.ArgumentParser, suppress: bool) -> None:
        def default(value: Any) -> Any:
            return argparse.SUPPRESS if suppress else value

        target.add_argument(
            "--db",
            default=default(None),
            help="Path to the face database (default: ~/.face_agent/faces.db)",
        )
        target.add_argument(
            "--backend",
            default=default(os.environ.get("FACE_AGENT_BACKEND", "auto")),
            choices=["auto", "sface", "dlib"],
            help="Recognition backend (default: auto)",
        )
        target.add_argument(
            "--threshold",
            type=float,
            default=default(None),
            help="Override the match threshold",
        )
        target.add_argument(
            "--json",
            action="store_true",
            default=default(False),
            help="Emit machine-readable JSON",
        )

    add_common(parser, suppress=False)
    common = argparse.ArgumentParser(add_help=False)
    add_common(common, suppress=True)

    sub = parser.add_subparsers(dest="command", required=True)

    def add(name: str, help_text: str) -> argparse.ArgumentParser:
        return sub.add_parser(name, help=help_text, parents=[common])

    add("doctor", "Check backends, models, camera, and database")

    models = add("models", "Manage the ONNX model files used by the sface backend")
    models.add_argument("--download", action="store_true", help="Download missing model files")
    models.add_argument("--dir", default=None, help="Destination directory")

    enroll = add("enroll", "Teach the system a new face")
    enroll.add_argument("--name", required=True, help="Identity label")
    enroll.add_argument("--images", nargs="+", help="Image files or directories")
    enroll.add_argument(
        "--camera", type=int, nargs="?", const=0, help="Capture from this camera index"
    )
    enroll.add_argument("--shots", type=int, default=3, help="Webcam shots to take (default 3)")
    enroll.add_argument("--delay", type=float, default=0.8, help="Seconds between shots")

    add("list", "List enrolled identities")

    remove = add("remove", "Delete an identity and its samples")
    remove.add_argument("--name", required=True)

    identify = add("identify", "Identify faces in an image or webcam snapshot")
    identify.add_argument("--image", help="Path to an image file")
    identify.add_argument("--camera", type=int, nargs="?", const=0, help="Camera index to snapshot")

    watch = add("watch", "Stream recognition events as JSON lines")
    watch.add_argument("--camera", type=int, default=0)
    watch.add_argument("--interval", type=float, default=1.0, help="Seconds between frames")
    watch.add_argument(
        "--cooldown", type=float, default=10.0, help="Seconds before re-reporting the same person"
    )
    watch.add_argument("--limit", type=int, default=0, help="Stop after N events (0 = run forever)")

    events = add("events", "Show recent recognition events")
    events.add_argument("--limit", type=int, default=20)

    serve = add("serve", "Run the local HTTP API for agents")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)

    add("mcp", "Run as an MCP server over stdio")
    add("schema", "Print the tool schemas for agent function-calling")

    token = add("token", "Show or rotate the local API token")
    token.add_argument("--rotate", action="store_true")

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    store_path = Path(args.db).expanduser() if args.db else db_path()

    try:
        if args.command == "doctor":
            return emit(op_doctor(store_path), args.json, human_doctor)

        if args.command == "models":
            if not args.download:
                print("Nothing to do. Pass --download to fetch missing model files.")
                return 0
            dest = Path(args.dir).expanduser() if args.dir else None
            result = op_download_models(dest)
            return emit(
                result,
                args.json,
                lambda d: "\n".join(
                    [f"models dir: {d['models_dir']}"]
                    + [
                        f"  {r['file']}: {r['status']}"
                        + (f" ({r['error']})" if r.get("error") else "")
                        for r in d["results"]
                    ]
                ),
            )

        if args.command == "schema":
            print(json.dumps(TOOL_SCHEMAS, indent=2))
            return 0

        if args.command == "token":
            if args.rotate:
                token_path().unlink(missing_ok=True)
            print(load_token())
            return 0

        if args.command == "serve":
            op_serve(store_path, args.backend, args.host, args.port)
            return 0

        if args.command == "mcp":
            op_mcp(store_path, args.backend)
            return 0

        with FaceStore(store_path) as store:
            if args.command == "list":
                return emit(op_list(store), args.json, human_list)

            if args.command == "remove":
                return emit(
                    op_remove(store, args.name),
                    args.json,
                    lambda d: (
                        f"Removed '{d['name']}'."
                        if d["removed"]
                        else f"No identity named '{d['name']}'."
                    ),
                )

            if args.command == "events":
                return emit(
                    op_events(store, args.limit),
                    args.json,
                    lambda d: (
                        "\n".join(
                            f"{e['ts']}  {e['kind']:<8} {e['name'] or '-':<20} {e['detail']}"
                            for e in d["events"]
                        )
                        or "No events recorded yet."
                    ),
                )

            backend = resolve_backend(args.backend, args.threshold)

            if args.command == "enroll":
                return emit(
                    op_enroll(
                        store,
                        backend,
                        args.name,
                        image_paths=args.images,
                        camera=args.camera,
                        shots=args.shots,
                        delay=args.delay,
                    ),
                    args.json,
                    lambda d: (
                        f"Enrolled {d['added']} sample(s) for '{d['name']}' "
                        f"({d['total_samples']} total)."
                        + (
                            "\nSkipped:\n"
                            + "\n".join(f"  {s['source']}: {s['reason']}" for s in d["skipped"])
                            if d["skipped"]
                            else ""
                        )
                    ),
                )

            if args.command == "identify":
                return emit(
                    op_identify(
                        store,
                        backend,
                        image=args.image,
                        camera=args.camera,
                        threshold=args.threshold,
                    ),
                    args.json,
                    human_identify,
                )

            if args.command == "watch":
                op_watch(
                    store,
                    backend,
                    camera=args.camera,
                    interval=args.interval,
                    cooldown=args.cooldown,
                    threshold=args.threshold,
                    limit=args.limit,
                )
                return 0

    except FaceAgentError as exc:
        if args.json:
            print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        else:
            print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
