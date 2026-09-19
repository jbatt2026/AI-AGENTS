"""Command-line behavior: flag precedence, exit codes, JSON output."""

from __future__ import annotations

import json
from pathlib import Path

import face_agent as fa
import pytest
from conftest import FakeBackend, write_faces


def parse(argv: list[str]):
    return fa.build_parser().parse_args(argv)


def test_global_flags_work_before_the_subcommand() -> None:
    args = parse(["--json", "--backend", "dlib", "--threshold", "0.4", "list"])
    assert (args.json, args.backend, args.threshold) == (True, "dlib", 0.4)


def test_global_flags_work_after_the_subcommand() -> None:
    args = parse(["list", "--json", "--backend", "dlib", "--threshold", "0.4"])
    assert (args.json, args.backend, args.threshold) == (True, "dlib", 0.4)


def test_flags_after_the_subcommand_win() -> None:
    args = parse(["--backend", "dlib", "identify", "--backend", "sface"])
    assert args.backend == "sface"


def test_defaults_are_not_clobbered_by_subparsers() -> None:
    args = parse(["list"])
    assert (args.json, args.backend, args.threshold, args.db) == (False, "auto", None, None)


def test_backend_default_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FACE_AGENT_BACKEND", "dlib")
    assert parse(["list"]).backend == "dlib"


def test_camera_flag_accepts_an_index_or_a_url() -> None:
    """The flag is a string now, so a network camera URL survives parsing."""
    assert parse(["identify", "--camera"]).camera == "0"
    assert parse(["identify", "--camera", "2"]).camera == "2"
    assert parse(["identify", "--image", "x"]).camera is None
    url = "rtsp://admin:pw@192.168.1.50:554/stream1"
    assert parse(["identify", "--camera", url]).camera == url


def test_watch_camera_defaults_to_zero() -> None:
    assert parse(["watch"]).camera == "0"


def test_subcommand_is_required(capsys: pytest.CaptureFixture) -> None:
    with pytest.raises(SystemExit):
        parse([])


def test_main_list_json(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    db = tmp_path / "faces.db"
    with fa.FaceStore(db) as store:
        store.add_face("Jane", [1.0, 0.0], "fake")

    assert fa.main(["--db", str(db), "--json", "list"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["count"] == 1
    assert payload["identities"][0]["name"] == "Jane"


def test_main_list_human_readable(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    db = tmp_path / "faces.db"
    with fa.FaceStore(db) as store:
        store.add_face("Jane", [1.0, 0.0], "fake")

    fa.main(["--db", str(db), "list"])
    out = capsys.readouterr().out
    assert "Jane" in out and "1 sample" in out


def test_main_remove_reports_missing_identity(
    tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    code = fa.main(["--db", str(tmp_path / "faces.db"), "remove", "--name", "Nobody"])
    assert code == 1
    assert "No identity named" in capsys.readouterr().out


def test_main_schema_prints_valid_json(capsys: pytest.CaptureFixture) -> None:
    assert fa.main(["schema"]) == 0
    assert [t["name"] for t in json.loads(capsys.readouterr().out)] == [
        t["name"] for t in fa.TOOL_SCHEMAS
    ]


def test_main_identify_json(
    tmp_path: Path, capsys: pytest.CaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(fa, "resolve_backend", lambda n, t=None: FakeBackend())
    db = tmp_path / "faces.db"
    with fa.FaceStore(db) as store:
        store.add_face("Jane", [1.0, 0.0], "fake")
    probe = write_faces(tmp_path / "p.txt", [1.0, 0.0])

    assert fa.main(["--db", str(db), "identify", "--image", str(probe), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["best_match"]["name"] == "Jane"


def test_main_reports_errors_as_json_when_asked(
    tmp_path: Path, capsys: pytest.CaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(fa, "resolve_backend", lambda n, t=None: FakeBackend())
    code = fa.main(
        ["--db", str(tmp_path / "faces.db"), "identify", "--image", "/nope.jpg", "--json"]
    )
    assert code == 2
    assert json.loads(capsys.readouterr().out)["ok"] is False


def test_main_reports_errors_on_stderr_by_default(
    tmp_path: Path, capsys: pytest.CaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(fa, "resolve_backend", lambda n, t=None: FakeBackend())
    code = fa.main(["--db", str(tmp_path / "faces.db"), "identify", "--image", "/nope.jpg"])
    assert code == 2
    assert "error:" in capsys.readouterr().err


def test_main_doctor_exit_code_reflects_readiness(
    tmp_path: Path, capsys: pytest.CaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """doctor is a health check: non-zero when no backend can actually run."""
    monkeypatch.setenv("FACE_AGENT_HOME", str(tmp_path))
    code = fa.main(["doctor", "--json"])
    report = json.loads(capsys.readouterr().out)
    assert code == (0 if report["ok"] else 1)


def test_main_events_empty(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    assert fa.main(["--db", str(tmp_path / "faces.db"), "events"]) == 0
    assert "No events recorded" in capsys.readouterr().out


def test_main_token_is_printed(
    tmp_path: Path, capsys: pytest.CaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FACE_AGENT_HOME", str(tmp_path))
    monkeypatch.delenv("FACE_AGENT_TOKEN", raising=False)
    fa.main(["token"])
    first = capsys.readouterr().out.strip()
    fa.main(["token", "--rotate"])
    assert capsys.readouterr().out.strip() not in ("", first)


def test_human_identify_renders_unknown_face() -> None:
    text = fa.human_identify(
        {
            "source": "x.jpg",
            "backend": "fake",
            "faces_detected": 1,
            "faces": [
                {
                    "name": "unknown",
                    "candidate": "Jane",
                    "matched": False,
                    "confidence": 0.31,
                    "metric": "cosine",
                    "threshold": 0.5,
                    "score": 0.2,
                }
            ],
        }
    )
    assert "unknown" in text and "Jane" in text
