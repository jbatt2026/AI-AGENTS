#!/usr/bin/env python3
"""Scan the working tree for credentials that must never be committed.

This replaces a chain of grep calls in agent-pr-check.yml that had two bugs.

The private-key grep matched any file containing the words "BEGIN RSA PRIVATE
KEY" — including SECURITY.md's table of detection patterns, the pre-commit
hook, and the workflow step's own source. It therefore failed on every pull
request into main, with no real secret anywhere in the repo.

The API-key grep passed `--exclude-file`, which is not a grep option (it is
`--exclude`). grep exited 2 without scanning, the shell read that as "no
match", and the check silently passed. It had never inspected anything.

The fix for the first is to require evidence of a real key rather than the
words that describe one: a PEM header must be followed by an actual base64
body. Documentation, placeholders like "-----BEGIN RSA PRIVATE KEY-----\\n...",
and truncated UI samples carry the header but no body, so they no longer
trip it while a genuine committed key still does.

Exit status is 0 when clean and 1 when anything is found, so the workflow
step fails the way it always meant to.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Directories never worth scanning: vendored code, build output, git internals.
SKIP_DIRS = {".git", "node_modules", "dist", "build", ".venv", "__pycache__"}

# Binary and lockfile extensions that produce noise, not secrets.
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf", ".onnx"}

# Files whose whole job is to describe or demonstrate these patterns. Each is
# listed individually and deliberately — this is not a wildcard.
ALLOWLIST = {
    # Documents the detection patterns themselves, including example values.
    "SECURITY.md",
    "PR_AUDIT_REPORT.md",
    # Placeholder values, by design: they show the shape, never a real key.
    ".env.example",
    "INSTALL_GITHUB_APP.md",
    # The scanner and the hook that runs the same checks.
    ".github/scripts/scan_secrets.py",
    ".githooks/pre-commit",
    ".github/workflows/agent-pr-check.yml",
}

# A PEM header followed by at least 40 characters of base64 body. A real key
# has one; prose and truncated samples do not.
PEM_BODY = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----"
    r"[^A-Za-z0-9+/]{0,40}"
    r"[A-Za-z0-9+/]{40,}"
)

# Long, high-signal credential literals assigned to a credential-ish name.
ASSIGNED_SECRET = re.compile(
    r"(?i)(api[_-]?key|bearer[_-]?token|access[_-]?token|oauth[_-]?token|"
    r"secret[_-]?key|client[_-]?secret|password)"
    r"\s*[:=]\s*['\"]([A-Za-z0-9_\-]{20,})['\"]"
)

# Obvious placeholders that should not count as a finding. Matched anywhere in
# the value, not just at the start: "your_api_key_here_placeholder" is a
# placeholder even though it begins with neither "your" nor "placeholder"
# at the position an anchored pattern would check.
PLACEHOLDER = re.compile(
    r"(?i)(x{4,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|changeme|placeholder|redacted|"
    r"dummy|sample|example|your[_-]|insert[_-]|todo|fixme)"
)

PROVIDER_TOKENS = [
    ("AWS access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("GitHub token", re.compile(r"gh[pusor]_[A-Za-z0-9_]{36,}")),
    ("Slack token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("Stripe live key", re.compile(r"sk_live_[0-9a-zA-Z]{24,}")),
    ("Private key in one line", re.compile(r"PRIVATE KEY-----\\n[A-Za-z0-9+/]{40,}")),
]


def candidate_files(root: Path) -> list[Path]:
    files = []
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        rel = path.relative_to(root).as_posix()
        if rel in ALLOWLIST:
            continue
        files.append(path)
    return sorted(files)


def scan_file(path: Path, rel: str) -> list[tuple[int, str, str]]:
    """Return (line number, what matched, the offending line) for each finding."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []

    findings: list[tuple[int, str, str]] = []

    # PEM bodies can span lines, so search the whole file, then locate the line.
    for match in PEM_BODY.finditer(text):
        line_no = text.count("\n", 0, match.start()) + 1
        findings.append((line_no, "private key with a base64 body", match.group(0)[:60]))

    for line_no, line in enumerate(text.splitlines(), start=1):
        if len(line) > 4000:  # minified or generated; not hand-written secrets
            continue
        assigned = ASSIGNED_SECRET.search(line)
        if assigned and not PLACEHOLDER.search(assigned.group(2)):
            findings.append((line_no, f"{assigned.group(1)} assigned a literal", line.strip()[:120]))
        for label, pattern in PROVIDER_TOKENS:
            found = pattern.search(line)
            if found and not PLACEHOLDER.search(found.group(0)):
                findings.append((line_no, label, line.strip()[:120]))
    return findings


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    all_findings: list[str] = []

    for path in candidate_files(root):
        rel = path.relative_to(root).as_posix()
        for line_no, label, excerpt in scan_file(path, rel):
            all_findings.append(f"  {rel}:{line_no}: {label}\n      {excerpt}")

    if all_findings:
        print("ERROR: possible committed credentials found:\n")
        print("\n".join(all_findings))
        print(
            "\nIf a finding is a placeholder or documentation, add its path to "
            "ALLOWLIST in .github/scripts/scan_secrets.py and say why. "
            "If it is a real credential, rotate it before removing it from git "
            "history — it is already compromised."
        )
        return 1

    print(f"Secret scan passed cleanly ({len(candidate_files(root))} files inspected).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
