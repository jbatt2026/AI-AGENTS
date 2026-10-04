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

import argparse
import re
import subprocess
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
    r"(?i)(?P<name_quote>['\"])?(?P<name>api[_-]?key|bearer[_-]?token|access[_-]?token|oauth[_-]?token|"
    r"bot[_-]?token|secret[_-]?key|client[_-]?secret|webhook[_-]?secret|password)"
    r"(?(name_quote)(?P=name_quote))"
    r"\s*[:=]\s*(?:"
    r"\"(?P<double_quoted_value>(?:\\.|[^\"\\\r\n]){20,})\"|"
    r"'(?P<single_quoted_value>(?:\\.|[^'\\\r\n]){20,})'|"
    r"(?P<unquoted_value>[^\s#;]{20,})"
    r")"
)

PLACEHOLDER_WORDS = {"changeme", "dummy", "example", "fixme", "placeholder", "redacted", "sample", "todo"}
PLACEHOLDER_SHAPES = (
    re.compile(r"x{4,}", re.IGNORECASE),
    re.compile(r"\.{3,}"),
    re.compile(r"<[^>]+>"),
    re.compile(r"\$\{[^}]+}"),
    re.compile(r"process\.env\.[A-Za-z_][A-Za-z0-9_]*"),
    re.compile(r"os\.environ\[\s*(['\"])[A-Za-z_][A-Za-z0-9_]*\1\s*\]"),
)
PLACEHOLDER_PREFIX = re.compile(
    r"(?:your|insert)[_-]"
    r"(?:(?:openai|anthropic|openrouter|gemini|google|telegram|github|aws|slack|huggingface|hf|stripe)[_-])?"
    r"(?:(?:api|access|bearer|oauth|bot|client|webhook|private|secret)[_-])?"
    r"(?:key|token|secret|password|credential)"
    r"(?:[_-](?:here|value|placeholder))*",
    re.IGNORECASE,
)


def is_placeholder(value: str) -> bool:
    """Recognize deliberate complete placeholders without substring bypasses."""
    normalized = value.strip()
    lowered = normalized.lower()
    if lowered in PLACEHOLDER_WORDS or PLACEHOLDER_PREFIX.fullmatch(normalized):
        return True
    return any(pattern.fullmatch(normalized) for pattern in PLACEHOLDER_SHAPES)

PROVIDER_TOKENS = [
    ("AWS access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("GitHub token", re.compile(r"gh[pusor]_[A-Za-z0-9_]{36,}")),
    ("Slack token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("Anthropic API key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("OpenRouter API key", re.compile(r"sk-or-v1-[A-Za-z0-9_\-]{20,}")),
    ("OpenAI-style API key", re.compile(r"sk-(?!(?:ant|or-v1)-)(?:proj-|svcacct-)?[A-Za-z0-9_\-]{20,}")),
    ("Hugging Face token", re.compile(r"hf_[A-Za-z0-9]{20,}")),
    ("Telegram bot token", re.compile(r"(?<!\d)\d{6,12}:[A-Za-z0-9_\-]{30,}")),
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


def should_skip(rel: str, *, use_allowlist: bool = True) -> bool:
    path = Path(rel)
    return (
        any(part in SKIP_DIRS for part in path.parts)
        or path.suffix.lower() in SKIP_SUFFIXES
        or (use_allowlist and rel in ALLOWLIST)
    )


def scan_text(text: str) -> list[tuple[int, str]]:
    """Return line numbers and labels without echoing credential material."""
    findings: list[tuple[int, str]] = []

    # PEM bodies can span lines, so search the whole file, then locate the line.
    for match in PEM_BODY.finditer(text):
        line_no = text.count("\n", 0, match.start()) + 1
        findings.append((line_no, "private key with a base64 body"))

    for line_no, line in enumerate(text.splitlines(), start=1):
        for assigned in ASSIGNED_SECRET.finditer(line):
            quoted_value = assigned.group("double_quoted_value") or assigned.group("single_quoted_value")
            assigned_value = quoted_value or assigned.group("unquoted_value")
            if assigned_value and quoted_value is None:
                while (
                    assigned_value
                    and not is_placeholder(assigned_value)
                    and assigned_value[-1] in ",)]}`'\""
                ):
                    assigned_value = assigned_value[:-1]
            if assigned_value and not is_placeholder(assigned_value):
                findings.append((line_no, f"{assigned.group('name')} assigned a literal"))
        for label, pattern in PROVIDER_TOKENS:
            found = pattern.search(line)
            if found and not is_placeholder(found.group(0)):
                findings.append((line_no, label))
    return findings


def staged_files(root: Path) -> list[tuple[str, str]]:
    names = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout.split(b"\0")
    staged = []
    for raw_name in names:
        if not raw_name:
            continue
        rel = raw_name.decode("utf-8", errors="surrogateescape")
        if should_skip(rel):
            continue
        content = subprocess.run(
            ["git", "show", f":{rel}"],
            cwd=root,
            check=True,
            capture_output=True,
        ).stdout.decode("utf-8", errors="replace")
        staged.append((rel, content))
    return staged


def history_files(root: Path):
    commits = subprocess.run(
        ["git", "rev-list", "--all"],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout
    blob_paths: dict[str, set[str]] = {}
    raw_changes = subprocess.run(
        ["git", "diff-tree", "--stdin", "--root", "-m", "-r", "--no-renames", "--raw", "--no-abbrev", "--no-commit-id", "-z"],
        cwd=root,
        input=commits,
        check=True,
        capture_output=True,
    ).stdout.split(b"\0")
    index = 0
    while index < len(raw_changes):
        metadata = raw_changes[index]
        if not metadata.startswith(b":"):
            index += 1
            continue
        if index + 1 >= len(raw_changes):
            break
        parts = metadata.split()
        raw_path = raw_changes[index + 1]
        index += 2
        if len(parts) != 5:
            continue
        if parts[1] == b"160000":
            continue
        object_id = parts[3].decode("ascii")
        if object_id and not object_id.strip("0"):
            continue
        rel = raw_path.decode("utf-8", errors="surrogateescape")
        blob_paths.setdefault(object_id, set()).add(rel)

    batch = subprocess.Popen(
        ["git", "cat-file", "--batch"],
        cwd=root,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )
    assert batch.stdin is not None and batch.stdout is not None
    for object_id, paths in blob_paths.items():
        # A path allowlisted today may have contained unrelated sensitive data
        # in an older revision, so history mode only skips binary/generated data.
        scannable_paths = sorted(rel for rel in paths if not should_skip(rel, use_allowlist=False))
        if not scannable_paths:
            continue
        batch.stdin.write(f"{object_id}\n".encode("ascii"))
        batch.stdin.flush()
        header = batch.stdout.readline().decode("ascii", errors="replace").strip().split()
        if len(header) != 3 or header[1] != "blob":
            raise RuntimeError(f"Unable to read historical Git blob {object_id[:12]}")
        size = int(header[2])
        content = batch.stdout.read(size).decode("utf-8", errors="replace")
        batch.stdout.read(1)  # trailing newline from cat-file --batch
        yield (f"{scannable_paths[0]} (git object {object_id[:12]})", content)

    batch.stdin.close()
    if batch.wait() != 0:
        raise RuntimeError("git cat-file --batch failed")


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan repository files for committed credentials")
    parser.add_argument("root", nargs="?", default=".")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--staged", action="store_true", help="scan the exact content in the Git index")
    modes.add_argument("--history", action="store_true", help="scan every reachable Git blob")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    all_findings: list[str] = []

    if args.staged:
        inputs = staged_files(root)
    elif args.history:
        inputs = history_files(root)
    else:
        inputs = [
            (path.relative_to(root).as_posix(), path.read_text(encoding="utf-8", errors="replace"))
            for path in candidate_files(root)
        ]

    inspected = 0
    for rel, content in inputs:
        inspected += 1
        for line_no, label in scan_text(content):
            all_findings.append(f"  {rel}:{line_no}: {label} (value redacted)")

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

    mode = "staged files" if args.staged else "historical blobs" if args.history else "files"
    print(f"Secret scan passed cleanly ({inspected} {mode} inspected).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
