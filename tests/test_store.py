"""Enrollment storage and matching."""

from __future__ import annotations

from pathlib import Path

import face_agent as fa
import pytest
from conftest import FakeBackend


def test_store_creates_schema(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "faces.db"
    with fa.FaceStore(path) as store:
        assert path.exists()
        assert store.list_identities() == []


def test_add_and_list_identities(store: fa.FaceStore) -> None:
    store.add_face("Jane", [1.0, 0.0], "fake", source="a.jpg")
    store.add_face("Jane", [0.9, 0.1], "fake", source="b.jpg")
    store.add_face("Ravi", [0.0, 1.0], "fake")

    identities = store.list_identities()
    assert [i["name"] for i in identities] == ["Jane", "Ravi"]
    assert identities[0]["samples"] == 2
    assert identities[0]["backends"] == ["fake"]


def test_add_face_rejects_empty_input(store: fa.FaceStore) -> None:
    with pytest.raises(fa.FaceAgentError, match="name"):
        store.add_face("  ", [1.0], "fake")
    with pytest.raises(fa.FaceAgentError, match="empty embedding"):
        store.add_face("Jane", [], "fake")


def test_remove_identity_cascades(store: fa.FaceStore, backend: FakeBackend) -> None:
    store.add_face("Jane", [1.0, 0.0], "fake")
    assert store.remove_identity("Jane") == 1
    assert store.list_identities() == []
    assert store.faces_for_backend("fake") == []
    assert store.remove_identity("Jane") == 0


def test_match_returns_none_when_nothing_enrolled(
    store: fa.FaceStore, backend: FakeBackend
) -> None:
    assert store.match([1.0, 0.0], backend) is None


def test_match_picks_the_closest_identity(store: fa.FaceStore, backend: FakeBackend) -> None:
    store.add_face("Jane", [1.0, 0.0], "fake")
    store.add_face("Ravi", [0.0, 1.0], "fake")

    match = store.match([0.95, 0.05], backend)
    assert match is not None
    assert match.name == "Jane"
    assert match.matched is True
    assert match.confidence > 0.5


def test_match_below_threshold_is_not_a_match(store: fa.FaceStore, backend: FakeBackend) -> None:
    store.add_face("Jane", [1.0, 0.0], "fake")
    match = store.match([0.1, 1.0], backend)
    assert match is not None
    assert match.matched is False
    assert match.name == "Jane"  # still the closest candidate
    assert match.to_dict()["name"] == "unknown"
    assert match.to_dict()["candidate"] == "Jane"


def test_threshold_override_changes_the_verdict(store: fa.FaceStore, backend: FakeBackend) -> None:
    store.add_face("Jane", [1.0, 0.0], "fake")
    probe = [0.6, 0.8]  # cosine similarity 0.6
    assert store.match(probe, backend, threshold=0.9) is not None
    assert store.match(probe, backend, threshold=0.9).matched is False
    assert store.match(probe, backend, threshold=0.4).matched is True


def test_embeddings_never_cross_backends(store: fa.FaceStore) -> None:
    """dlib and sface vectors mean different things; mixing them is nonsense."""
    store.add_face("Jane", [1.0, 0.0], "dlib")
    sface = FakeBackend()
    assert store.match([1.0, 0.0], sface) is None

    store.add_face("Ravi", [1.0, 0.0], "fake")
    match = store.match([1.0, 0.0], sface)
    assert match is not None and match.name == "Ravi"


def test_mismatched_dimensions_are_skipped_not_fatal(
    store: fa.FaceStore, backend: FakeBackend
) -> None:
    store.add_face("Jane", [1.0, 0.0, 0.0], "fake")
    store.add_face("Ravi", [0.2, 1.0], "fake")
    match = store.match([0.0, 1.0], backend)
    assert match is not None and match.name == "Ravi"


def test_events_round_trip(store: fa.FaceStore) -> None:
    store.log_event("identify", "Jane", 0.91, "camera:0")
    store.log_event("identify", "unknown", None, "file")
    events = store.recent_events(limit=5)
    assert len(events) == 2
    assert events[0]["name"] == "unknown"  # most recent first
    assert events[1]["confidence"] == pytest.approx(0.91)
