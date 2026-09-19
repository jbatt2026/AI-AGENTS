"""Guards for the one-command setup scripts.

These cannot be executed in CI (one needs PowerShell, both need network and a
real install), so the tests check the things that silently rot instead: that
the scripts exist, are syntactically valid, and still refer to real files.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SETUP_SH = REPO / "scripts" / "setup.sh"
SETUP_PS1 = REPO / "scripts" / "setup.ps1"


def test_both_setup_scripts_exist() -> None:
    assert SETUP_SH.is_file(), "macOS/Linux setup script is missing"
    assert SETUP_PS1.is_file(), "Windows setup script is missing"


def test_setup_sh_is_executable_and_parses() -> None:
    assert SETUP_SH.stat().st_mode & 0o111, "setup.sh should be executable"
    bash = shutil.which("bash")
    if not bash:  # pragma: no cover - bash is present on every CI runner we use
        pytest.skip("bash not available")
    result = subprocess.run([bash, "-n", str(SETUP_SH)], capture_output=True, text=True)
    assert result.returncode == 0, f"setup.sh has a syntax error:\n{result.stderr}"


def test_powershell_delimiters_are_balanced() -> None:
    """No PowerShell in CI, so check the structure that a typo would break."""
    src = SETUP_PS1.read_text(encoding="utf-8")
    assert src.count("<#") == src.count("#>") == 1, "unbalanced block comment"
    assert src.count("{") == src.count("}"), "unbalanced braces"
    assert src.count("@'") == src.count("'@"), "unbalanced single-quoted here-string"
    assert src.count('@"') == src.count('"@'), "unbalanced double-quoted here-string"


@pytest.mark.parametrize("script", [SETUP_SH, SETUP_PS1], ids=["sh", "ps1"])
def test_setup_scripts_reference_files_that_exist(script: Path) -> None:
    """A renamed file should fail here, not halfway through a user's install."""
    src = script.read_text(encoding="utf-8")
    for referenced in ("requirements.txt", "face_agent.py"):
        assert referenced in src, f"{script.name} no longer mentions {referenced}"
        assert (REPO / "scripts" / referenced).is_file() or (REPO / referenced).is_file()


@pytest.mark.parametrize("script", [SETUP_SH, SETUP_PS1], ids=["sh", "ps1"])
def test_setup_scripts_keep_the_consent_notice(script: Path) -> None:
    src = script.read_text(encoding="utf-8").lower()
    assert "biometric data" in src, f"{script.name} dropped the consent notice"


def test_setup_sh_rejects_unknown_flags() -> None:
    bash = shutil.which("bash")
    if not bash:  # pragma: no cover
        pytest.skip("bash not available")
    result = subprocess.run(
        [bash, str(SETUP_SH), "--not-a-real-flag"], capture_output=True, text=True
    )
    assert result.returncode == 2
    assert "unknown option" in result.stderr


def test_setup_sh_help_needs_no_install() -> None:
    """--help must work before anything is installed."""
    bash = shutil.which("bash")
    if not bash:  # pragma: no cover
        pytest.skip("bash not available")
    result = subprocess.run([bash, str(SETUP_SH), "--help"], capture_output=True, text=True)
    assert result.returncode == 0
    assert "--no-venv" in result.stdout


def test_powershell_script_has_no_param_block() -> None:
    """A param() block with [switch] parameters broke on Windows PowerShell 5.1.

    Launching the script with `powershell -File` failed during parameter
    binding -- "Cannot convert value System.String to type SwitchParameter" --
    before any line of it ran, even with no arguments passed. Options are read
    from $args instead, which cannot fail that way. This test exists so the
    param() block is not reintroduced by someone tidying the file.
    """
    src = SETUP_PS1.read_text(encoding="utf-8")
    code = "\n".join(line for line in src.splitlines() if not line.lstrip().startswith("#"))
    assert "param(" not in code, "setup.ps1 must not use a param() block"
    assert "CmdletBinding" not in code, "setup.ps1 must not use [CmdletBinding()]"
    for option in ("-NoVenv", "-Dlib", "-Exe"):
        assert f"$args -contains '{option}'" in code, f"{option} must be read from $args"
