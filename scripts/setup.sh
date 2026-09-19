#!/usr/bin/env bash
# One-command setup for face-agent on macOS and Linux.
#
#   bash scripts/setup.sh              # install into ./.venv, fetch models, run doctor
#   bash scripts/setup.sh --dlib       # also install the dlib backend (needs cmake)
#   bash scripts/setup.sh --no-venv    # install into the current Python instead
#
# Safe to re-run: it skips what is already in place.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"
USE_VENV=1
WITH_DLIB=0

for arg in "$@"; do
    case "$arg" in
        --no-venv) USE_VENV=0 ;;
        --dlib)    WITH_DLIB=1 ;;
        -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
    esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31merror: %s\033[0m\n' "$1" >&2; exit 1; }

# --- 1. Python ------------------------------------------------------------
step "Checking Python"
PYTHON=""
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
        if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
            PYTHON="$candidate"
            break
        fi
    fi
done
[ -n "$PYTHON" ] || fail "need Python 3.10 or newer on PATH. Install it from https://python.org and re-run."
echo "using $($PYTHON --version) at $(command -v "$PYTHON")"

# --- 2. Environment -------------------------------------------------------
if [ "$USE_VENV" -eq 1 ]; then
    step "Creating the virtual environment"
    if [ -d "$VENV_DIR" ]; then
        echo "$VENV_DIR already exists, reusing it"
    else
        "$PYTHON" -m venv "$VENV_DIR" || fail "could not create a venv. On Debian/Ubuntu: sudo apt install python3-venv"
    fi
    PYTHON="$VENV_DIR/bin/python"
fi

# --- 3. Dependencies ------------------------------------------------------
step "Installing dependencies"
"$PYTHON" -m pip install --quiet --upgrade pip
"$PYTHON" -m pip install --quiet -r "$REPO_ROOT/requirements.txt" || fail "dependency install failed (see the pip output above)"
if [ "$WITH_DLIB" -eq 1 ]; then
    echo "installing the dlib backend — this compiles and can take several minutes"
    "$PYTHON" -m pip install "face_recognition>=1.3" \
        || fail "dlib install failed. It needs cmake and a C++ compiler; the default sface backend does not."
fi
echo "done"

# --- 4. Models ------------------------------------------------------------
step "Downloading the face models (~40 MB, once)"
"$PYTHON" "$REPO_ROOT/scripts/face_agent.py" models --download \
    || fail "model download failed. Check your internet connection and re-run; the URLs are in scripts/face_agent.py."

# --- 5. Verify ------------------------------------------------------------
step "Health check"
set +e
"$PYTHON" "$REPO_ROOT/scripts/face_agent.py" doctor
DOCTOR_STATUS=$?
set -e

RUN="$PYTHON $REPO_ROOT/scripts/face_agent.py"
if [ "$DOCTOR_STATUS" -ne 0 ]; then
    printf '\n\033[33mSetup finished but no backend is usable yet — see the report above.\033[0m\n'
    exit "$DOCTOR_STATUS"
fi

cat <<EOF

$(printf '\033[32mReady.\033[0m') Run it with:

  $RUN enroll --name "Your Name" --camera --shots 5
  $RUN identify --camera
  $RUN list

Connect an AI agent over MCP:

  claude mcp add face-agent -- $RUN mcp

Only enroll people who have agreed to it — face templates are biometric data.
EOF
