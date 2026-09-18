"""The matching math is pure Python so it is testable with no vision deps."""

from __future__ import annotations

import math

import face_agent as fa
import pytest


def test_pack_unpack_roundtrip() -> None:
    vec = [0.0, 1.0, -0.5, 0.25]
    assert fa.unpack_vector(fa.pack_vector(vec)) == pytest.approx(vec)


def test_unpack_rejects_corrupt_blob() -> None:
    with pytest.raises(fa.FaceAgentError):
        fa.unpack_vector(b"abc")


def test_euclidean_distance() -> None:
    assert fa.euclidean_distance([0, 0], [3, 4]) == pytest.approx(5.0)
    assert fa.euclidean_distance([1, 2, 3], [1, 2, 3]) == pytest.approx(0.0)


def test_cosine_similarity() -> None:
    assert fa.cosine_similarity([1, 0], [1, 0]) == pytest.approx(1.0)
    assert fa.cosine_similarity([1, 0], [0, 1]) == pytest.approx(0.0)
    assert fa.cosine_similarity([1, 0], [-1, 0]) == pytest.approx(-1.0)
    # magnitude must not matter
    assert fa.cosine_similarity([2, 0], [9, 0]) == pytest.approx(1.0)


def test_cosine_similarity_handles_zero_vector() -> None:
    assert fa.cosine_similarity([0, 0], [1, 1]) == 0.0


@pytest.mark.parametrize("fn", [fa.euclidean_distance, fa.cosine_similarity])
def test_dimension_mismatch_raises(fn) -> None:
    with pytest.raises(fa.FaceAgentError, match="dimension mismatch"):
        fn([1, 2], [1, 2, 3])


def test_confidence_is_half_at_threshold() -> None:
    assert fa.normalize_confidence(0.5, 0.5, True, 0.0) == pytest.approx(0.5)
    assert fa.normalize_confidence(0.6, 0.6, False, 1.2) == pytest.approx(0.5)


def test_confidence_direction_for_similarity() -> None:
    """Cosine: higher score means more confident."""
    low = fa.normalize_confidence(0.2, 0.363, True, 0.0)
    mid = fa.normalize_confidence(0.5, 0.363, True, 0.0)
    high = fa.normalize_confidence(0.95, 0.363, True, 0.0)
    assert low < 0.5 < mid < high


def test_confidence_direction_for_distance() -> None:
    """Euclidean: lower distance means more confident."""
    far = fa.normalize_confidence(1.0, 0.6, False, 1.2)
    near = fa.normalize_confidence(0.3, 0.6, False, 1.2)
    exact = fa.normalize_confidence(0.0, 0.6, False, 1.2)
    assert far < 0.5 < near < exact == pytest.approx(1.0)


def test_confidence_stays_in_unit_range() -> None:
    for score in (-5.0, -1.0, 0.0, 0.5, 1.0, 9.0):
        for higher in (True, False):
            value = fa.normalize_confidence(score, 0.5, higher, 0.0 if higher else 2.0)
            assert 0.0 <= value <= 1.0, (score, higher, value)


def test_clamp() -> None:
    assert fa.clamp(-1.0) == 0.0
    assert fa.clamp(2.0) == 1.0
    assert fa.clamp(0.25) == 0.25


def test_backend_score_and_direction() -> None:
    cosine = fa.Backend("c", "cosine", 0.4, True, 0.0)
    euclid = fa.Backend("e", "euclidean", 0.6, False, 1.2)
    assert cosine.score([1, 0], [1, 0]) == pytest.approx(1.0)
    assert euclid.score([0, 0], [0, 1]) == pytest.approx(1.0)
    assert cosine.is_better(0.9, 0.5) is True
    assert euclid.is_better(0.9, 0.5) is False
    assert not math.isnan(cosine.score([1, 1], [1, 1]))
