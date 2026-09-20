"""Geometry behind SFaceBackend.detect_faces.

YuNet's anchors are tuned for roughly VGA-sized input, so handing it a modern
phone photo at full resolution detects nothing at all. On a 64-image benchmark
of real photos, capping the long side took detection from 48/64 images to
64/64. These tests cover the pure geometry, so they need neither opencv nor
the ONNX model files.
"""

import face_agent as fa
import pytest


def test_small_images_are_left_alone() -> None:
    assert fa.detect_downscale(640, 480) == (640, 480, 1.0)
    assert fa.detect_downscale(fa.DETECT_MAX_SIDE, 100) == (fa.DETECT_MAX_SIDE, 100, 1.0)


@pytest.mark.parametrize(
    "width,height",
    [(1536, 2048), (1382, 1868), (2400, 1702), (4000, 3000), (8000, 200)],
)
def test_large_images_are_capped_and_keep_aspect_ratio(width: int, height: int) -> None:
    new_w, new_h, scale = fa.detect_downscale(width, height)
    assert max(new_w, new_h) == fa.DETECT_MAX_SIDE
    assert 0.0 < scale < 1.0
    assert new_w >= 1 and new_h >= 1
    assert (new_w / new_h) == pytest.approx(width / height, rel=0.02)


def test_extreme_aspect_ratio_never_collapses_to_zero() -> None:
    new_w, new_h, scale = fa.detect_downscale(20000, 1)
    assert new_w == fa.DETECT_MAX_SIDE
    assert new_h == 1
    assert scale > 0.0


def test_rescale_face_row_maps_coordinates_back_but_not_the_score() -> None:
    row = list(range(fa.FACE_ROW_COORDS)) + [0.97]
    out = fa.rescale_face_row(row, 0.5)
    assert out[: fa.FACE_ROW_COORDS] == [v * 2 for v in range(fa.FACE_ROW_COORDS)]
    assert out[fa.FACE_ROW_COORDS] == pytest.approx(0.97)


def test_rescale_face_row_is_identity_at_scale_one() -> None:
    row = [float(v) for v in range(15)]
    assert fa.rescale_face_row(row, 1.0) == row


def test_detect_downscale_and_rescale_round_trip() -> None:
    """A box found on the shrunken copy lands back on the original."""
    width, height = 1536, 2048
    _, _, scale = fa.detect_downscale(width, height)
    # A face occupying the middle of the full-resolution image...
    full = [600.0, 800.0, 300.0, 400.0] + [0.0] * 10 + [0.9]
    # ...is reported by the detector at the shrunken scale...
    shrunk = [v * scale for v in full[: fa.FACE_ROW_COORDS]] + [0.9]
    # ...and rescaling must recover the original coordinates.
    recovered = fa.rescale_face_row(shrunk, scale)
    assert recovered[: fa.FACE_ROW_COORDS] == pytest.approx(full[: fa.FACE_ROW_COORDS])
