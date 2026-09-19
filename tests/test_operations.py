"""The enroll/identify operations shared by the CLI, HTTP API, and MCP server."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from urllib.parse import urlsplit

import face_agent as fa
import pytest
from conftest import FakeBackend, write_faces


def test_enroll_from_images(store: fa.FaceStore, backend: FakeBackend, tmp_path: Path) -> None:
    write_faces(tmp_path / "a.txt", [1.0, 0.0])
    write_faces(tmp_path / "b.txt", [0.9, 0.1])

    result = fa.op_enroll(
        store, backend, "Jane", image_paths=[str(tmp_path / "a.txt"), str(tmp_path / "b.txt")]
    )
    assert result["ok"] is True
    assert result["added"] == 2
    assert result["total_samples"] == 2
    assert result["skipped"] == []


def test_enroll_skips_images_without_exactly_one_face(
    store: fa.FaceStore, backend: FakeBackend, tmp_path: Path
) -> None:
    write_faces(tmp_path / "good.txt", [1.0, 0.0])
    write_faces(tmp_path / "two.txt", [1.0, 0.0], [0.0, 1.0])
    (tmp_path / "none.txt").write_text("", encoding="utf-8")

    result = fa.op_enroll(
        store,
        backend,
        "Jane",
        image_paths=[str(tmp_path / n) for n in ("good.txt", "two.txt", "none.txt")],
    )
    assert result["added"] == 1
    reasons = {Path(s["source"]).name: s["reason"] for s in result["skipped"]}
    assert "found 2" in reasons["two.txt"]
    assert "found 0" in reasons["none.txt"]


def test_enroll_requires_a_source(store: fa.FaceStore, backend: FakeBackend) -> None:
    with pytest.raises(fa.FaceAgentError, match="--images or --camera"):
        fa.op_enroll(store, backend, "Jane")


def test_enroll_requires_a_name(store: fa.FaceStore, backend: FakeBackend) -> None:
    with pytest.raises(fa.FaceAgentError, match="name"):
        fa.op_enroll(store, backend, "   ", image_paths=["x"])


def test_enroll_reports_missing_paths(store: fa.FaceStore, backend: FakeBackend) -> None:
    with pytest.raises(fa.FaceAgentError, match="no such file"):
        fa.op_enroll(store, backend, "Jane", image_paths=["/nope/missing.jpg"])


def test_identify_known_face(store: fa.FaceStore, backend: FakeBackend, tmp_path: Path) -> None:
    write_faces(tmp_path / "jane.txt", [1.0, 0.0])
    fa.op_enroll(store, backend, "Jane", image_paths=[str(tmp_path / "jane.txt")])

    probe = write_faces(tmp_path / "probe.txt", [0.98, 0.02])
    result = fa.op_identify(store, backend, image=str(probe))

    assert result["faces_detected"] == 1
    assert result["best_match"]["name"] == "Jane"
    assert result["best_match"]["confidence"] > 0.5
    assert result["backend"] == "fake"


def test_identify_unknown_face(store: fa.FaceStore, backend: FakeBackend, tmp_path: Path) -> None:
    write_faces(tmp_path / "jane.txt", [1.0, 0.0])
    fa.op_enroll(store, backend, "Jane", image_paths=[str(tmp_path / "jane.txt")])

    probe = write_faces(tmp_path / "probe.txt", [0.0, 1.0])
    result = fa.op_identify(store, backend, image=str(probe))

    assert result["best_match"] is None
    assert result["faces"][0]["matched"] is False
    assert result["faces"][0]["name"] == "unknown"


def test_identify_with_empty_database_explains_itself(
    store: fa.FaceStore, backend: FakeBackend, tmp_path: Path
) -> None:
    probe = write_faces(tmp_path / "probe.txt", [1.0, 0.0])
    result = fa.op_identify(store, backend, image=str(probe))
    assert result["faces"][0]["name"] == "unknown"
    assert "no faces enrolled" in result["faces"][0]["reason"]


def test_identify_multiple_faces_picks_best(
    store: fa.FaceStore, backend: FakeBackend, tmp_path: Path
) -> None:
    write_faces(tmp_path / "jane.txt", [1.0, 0.0])
    write_faces(tmp_path / "ravi.txt", [0.0, 1.0])
    fa.op_enroll(store, backend, "Jane", image_paths=[str(tmp_path / "jane.txt")])
    fa.op_enroll(store, backend, "Ravi", image_paths=[str(tmp_path / "ravi.txt")])

    probe = write_faces(tmp_path / "group.txt", [0.7, 0.7], [0.0, 1.0])
    result = fa.op_identify(store, backend, image=str(probe))
    assert result["faces_detected"] == 2
    assert result["best_match"]["name"] == "Ravi"  # the exact match wins


def test_identify_requires_a_source(store: fa.FaceStore, backend: FakeBackend) -> None:
    with pytest.raises(fa.FaceAgentError, match="identify needs"):
        fa.op_identify(store, backend)


def test_identify_rejects_missing_file(store: fa.FaceStore, backend: FakeBackend) -> None:
    with pytest.raises(fa.FaceAgentError, match="no such image"):
        fa.op_identify(store, backend, image="/nope/missing.jpg")


def test_identify_from_base64(store: fa.FaceStore, backend: FakeBackend, tmp_path: Path) -> None:
    write_faces(tmp_path / "jane.txt", [1.0, 0.0])
    fa.op_enroll(store, backend, "Jane", image_paths=[str(tmp_path / "jane.txt")])

    payload = base64.b64encode(b"1.0,0.0").decode("ascii")
    result = fa.op_identify(store, backend, image_base64=payload)
    assert result["source"] == "base64"
    assert result["best_match"]["name"] == "Jane"


def test_identify_logs_an_event(store: fa.FaceStore, backend: FakeBackend, tmp_path: Path) -> None:
    probe = write_faces(tmp_path / "probe.txt", [1.0, 0.0])
    fa.op_identify(store, backend, image=str(probe))
    assert store.recent_events()[0]["kind"] == "identify"


def test_decode_image_b64_rejects_garbage() -> None:
    with pytest.raises(fa.FaceAgentError, match="not valid base64"):
        fa.decode_image_b64("this is not base64!!")
    with pytest.raises(fa.FaceAgentError, match="zero bytes"):
        fa.decode_image_b64("")


def test_decode_image_b64_strips_data_url_prefix(tmp_path: Path) -> None:
    payload = "data:image/png;base64," + base64.b64encode(b"hello").decode("ascii")
    path = fa.decode_image_b64(payload)
    try:
        assert path.read_bytes() == b"hello"
    finally:
        path.unlink(missing_ok=True)


def test_temp_file_from_base64_is_always_cleaned_up(
    store: fa.FaceStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A backend blowing up must not leave decoded image bytes on disk."""
    created: list[Path] = []
    real = fa.decode_image_b64

    def spy(data: str) -> Path:
        path = real(data)
        created.append(path)
        return path

    monkeypatch.setattr(fa, "decode_image_b64", spy)

    class Boom(FakeBackend):
        def embed_file(self, path: Path) -> list[list[float]]:
            raise fa.FaceAgentError("decode failed")

    with pytest.raises(fa.FaceAgentError):
        fa.op_identify(store, Boom(), image_base64=base64.b64encode(b"x").decode())

    assert created and not created[0].exists()


def test_iter_images_filters_by_suffix(tmp_path: Path) -> None:
    (tmp_path / "a.jpg").write_bytes(b"")
    (tmp_path / "b.PNG").write_bytes(b"")
    (tmp_path / "notes.txt").write_bytes(b"")
    found = {p.name for p in fa.iter_images([str(tmp_path)])}
    assert found == {"a.jpg", "b.PNG"}


def test_iter_images_errors_on_empty_directory(tmp_path: Path) -> None:
    with pytest.raises(fa.FaceAgentError, match="no images found"):
        fa.iter_images([str(tmp_path)])


def test_op_list_and_remove(store: fa.FaceStore) -> None:
    store.add_face("Jane", [1.0, 0.0], "fake")
    listing = fa.op_list(store)
    assert listing["count"] == 1

    assert fa.op_remove(store, "Jane")["removed"] is True
    assert fa.op_remove(store, "Jane")["removed"] is False
    assert fa.op_list(store)["count"] == 0


def test_op_doctor_reports_backends(tmp_path: Path) -> None:
    report = fa.op_doctor(tmp_path / "faces.db")
    names = {b["name"] for b in report["backends"]}
    assert names == {"sface", "dlib"}
    assert report["version"] == fa.__version__
    # In this environment neither backend is installed; the report must say so
    # rather than claiming a capability that is not there.
    for entry in report["backends"]:
        assert isinstance(entry["available"], bool)
        assert entry["detail"]


def test_watch_emits_events_and_respects_cooldown(
    store: fa.FaceStore, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    backend = FakeBackend()
    backend.frames = [[[1.0, 0.0]], [[1.0, 0.0]], [[0.0, 1.0]]]
    store.add_face("Jane", [1.0, 0.0], "fake")
    store.add_face("Ravi", [0.0, 1.0], "fake")

    class FakeCap:
        def read(self):
            return True, object()

        def release(self):
            pass

    monkeypatch.setattr(
        fa, "open_camera", lambda *a, **k: __import__("contextlib").nullcontext(FakeCap())
    )
    monkeypatch.setattr(fa.time, "sleep", lambda s: None)

    seen: list[dict] = []
    result = fa.op_watch(
        store, backend, camera=0, interval=0, cooldown=3600, limit=2, emit=seen.append
    )

    assert result["events"] == 2
    # Jane appears in two consecutive frames but is reported once (cooldown).
    assert [e["name"] for e in seen] == ["Jane", "Ravi"]


def test_validate_model_bytes_rejects_lfs_pointer() -> None:
    """opencv_zoo ships the ONNX files via Git LFS; a bad URL returns a stub."""
    pointer = b"version https://git-lfs.github.com/spec/v1\noid sha256:0000\nsize 1000000\n"
    with pytest.raises(fa.FaceAgentError, match="Git LFS pointer"):
        fa.validate_model_bytes(pointer, "yunet.onnx")


def test_validate_model_bytes_rejects_tiny_and_empty_files() -> None:
    with pytest.raises(fa.FaceAgentError, match="empty"):
        fa.validate_model_bytes(b"", "yunet.onnx")
    with pytest.raises(fa.FaceAgentError, match="too small"):
        fa.validate_model_bytes(b"<html>404</html>", "yunet.onnx")


def test_validate_model_bytes_accepts_a_plausible_model() -> None:
    fa.validate_model_bytes(b"\x08\x01" + b"x" * fa.MIN_MODEL_BYTES, "yunet.onnx")


def test_sface_treats_a_truncated_model_as_missing(tmp_path: Path) -> None:
    """A leftover LFS pointer must not pass as an installed model."""
    backend = fa.SFaceBackend(models=tmp_path)
    assert backend.missing_models() == [
        "face_detection_yunet_2023mar.onnx",
        "face_recognition_sface_2021dec.onnx",
    ]

    backend.detector_path.write_bytes(b"version https://git-lfs.github.com/spec/v1\n")
    backend.recognizer_path.write_bytes(b"x" * fa.MIN_MODEL_BYTES)
    assert backend.missing_models() == ["face_detection_yunet_2023mar.onnx"]

    backend.detector_path.write_bytes(b"x" * fa.MIN_MODEL_BYTES)
    assert backend.missing_models() == []


def test_decode_image_b64_accepts_wrapped_base64() -> None:
    """MIME-style base64 arrives wrapped at 76 columns; strict decoding would reject it."""
    payload = base64.encodebytes(b"x" * 200).decode("ascii")
    assert "\n" in payload
    path = fa.decode_image_b64(payload)
    try:
        assert path.read_bytes() == b"x" * 200
    finally:
        path.unlink(missing_ok=True)


def test_sface_reports_corrupt_models_cleanly(tmp_path: Path) -> None:
    """A corrupt .onnx must raise FaceAgentError, not an OpenCV traceback."""
    pytest.importorskip("cv2")
    backend = fa.SFaceBackend(models=tmp_path)
    backend.detector_path.write_bytes(b"not an onnx file" * 5000)
    backend.recognizer_path.write_bytes(b"not an onnx file" * 5000)
    assert backend.missing_models() == []

    with pytest.raises(fa.FaceAgentError, match="corrupt"):
        backend._load()


def test_parse_camera_source_accepts_indexes_and_urls() -> None:
    assert fa.parse_camera_source(0) == 0
    assert fa.parse_camera_source("0") == 0
    assert fa.parse_camera_source("2") == 2
    url = "rtsp://192.168.1.50:554/stream1"
    assert fa.parse_camera_source(url) == url
    assert fa.parse_camera_source("http://cam.local/video.mjpg").startswith("http://")


def test_parse_camera_source_rejects_nonsense() -> None:
    with pytest.raises(fa.FaceAgentError, match="neither a camera index nor a stream URL"):
        fa.parse_camera_source("my camera")


def test_redact_source_hides_stream_credentials() -> None:
    """Stream URLs carry passwords, and this label is logged and returned."""
    label = fa.redact_source("rtsp://admin:hunter2@192.168.1.50:554/stream1")
    assert "hunter2" not in label
    assert "admin" not in label
    assert "192.168.1.50:554" in label
    assert label.startswith("rtsp://***@")
    assert label.endswith("/stream1")


def test_redact_source_leaves_clean_values_alone() -> None:
    assert fa.redact_source(0) == "camera:0"
    assert fa.redact_source("1") == "camera:1"
    assert fa.redact_source("rtsp://cam.local/s1") == "rtsp://cam.local/s1"


def test_identify_from_a_stream_never_logs_the_password(
    store: fa.FaceStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The events table and the returned payload must both stay clean."""
    backend = FakeBackend()
    backend.frames = [[[1.0, 0.0]]]
    store.add_face("Jane", [1.0, 0.0], "fake")

    class FakeCap:
        def read(self):
            return True, object()

        def release(self):
            pass

    monkeypatch.setattr(
        fa, "open_camera", lambda *a, **k: __import__("contextlib").nullcontext(FakeCap())
    )

    secret = "rtsp://admin:hunter2@192.168.1.50:554/stream1"
    result = fa.op_identify(store, backend, camera=secret)

    assert "hunter2" not in json.dumps(result)
    assert result["best_match"]["name"] == "Jane"
    assert "hunter2" not in json.dumps(store.recent_events())


def test_build_rtsp_url_encodes_awkward_credentials() -> None:
    """Camera passwords often contain @ : / — unencoded they split the URL."""
    url = fa.build_rtsp_url("192.168.1.50", 554, "admin", "p@ss/w:rd", "/stream1")
    assert url == "rtsp://admin:p%40ss%2Fw%3Ard@192.168.1.50:554/stream1"
    assert urlsplit(url).hostname == "192.168.1.50"
    assert urlsplit(url).port == 554


def test_build_rtsp_url_without_credentials() -> None:
    assert fa.build_rtsp_url("10.0.0.5", 554, path="/live") == "rtsp://10.0.0.5:554/live"


def test_build_rtsp_url_adds_the_leading_slash() -> None:
    assert fa.build_rtsp_url("10.0.0.5", 554, path="live").endswith("/live")


def test_common_rtsp_paths_are_usable() -> None:
    assert len(fa.COMMON_RTSP_PATHS) >= 10
    assert len(set(fa.COMMON_RTSP_PATHS)) == len(fa.COMMON_RTSP_PATHS), "duplicate paths"
    assert all(path.startswith("/") for path in fa.COMMON_RTSP_PATHS)


def test_probe_stream_reports_the_one_that_works(monkeypatch: pytest.MonkeyPatch) -> None:
    """Only a path that opens AND delivers a frame counts as working."""
    pytest.importorskip("cv2")
    import cv2

    class FakeCapture:
        def __init__(self, url, *args):
            self.url = url

        def set(self, *args):
            return True

        def isOpened(self):
            # One path opens but never yields a frame; it must not be reported.
            return "/stream1" in self.url or "/live" in self.url

        def read(self):
            return ("/stream1" in self.url, object())

        def release(self):
            pass

    monkeypatch.setattr(cv2, "VideoCapture", FakeCapture)
    result = fa.op_probe_stream(
        "192.168.1.50", user="admin", password="secret", emit=lambda line: None
    )

    assert result["ok"] is True
    assert result["working_paths"] == ["/stream1"]
    assert "secret" not in json.dumps(result), "probe output must not carry the password"
    assert result["urls"] == ["rtsp://***@192.168.1.50:554/stream1"]


def test_probe_stream_reports_nothing_found(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("cv2")
    import cv2

    class DeadCapture:
        def __init__(self, url, *args):
            pass

        def set(self, *args):
            return True

        def isOpened(self):
            return False

        def read(self):
            return False, None

        def release(self):
            pass

    monkeypatch.setattr(cv2, "VideoCapture", DeadCapture)
    result = fa.op_probe_stream("10.0.0.9", emit=lambda line: None)
    assert result["ok"] is False
    assert result["working_paths"] == []
