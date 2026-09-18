# face-agent

A local facial recognition service your AI agent can call as a tool.

`scripts/face_agent.py` enrolls faces, identifies them from image files or a
webcam, and exposes that over three interfaces: a CLI, a loopback HTTP API, and
an MCP stdio server. Everything runs on your machine — embeddings go in a
SQLite file under `~/.face_agent`, no image bytes are stored, and nothing is
sent anywhere.

---

## Before you install it

Face templates are biometric data. Enroll only people who have agreed to it,
and tell them what you are storing. Depending on where you are, collecting face
data without written consent can be unlawful on its own — Illinois' BIPA,
Texas' CUBI, and GDPR Article 9 in the EU/UK all apply to exactly this kind of
data, whether or not the software is local. If the system will be used on
anyone other than you, that consent is the first thing to sort out.

Two technical limits worth knowing up front:

- **No liveness detection.** A photo held up to the camera can pass. Do not use
  this as the only factor for anything that matters — unlocking, payments,
  door access.
- **Accuracy varies by person.** Face recognition error rates are measurably
  uneven across skin tone, age and gender. Treat every match as a suggestion
  with a confidence score, not a fact.

---

## Install

### 1. Get Python and the dependencies

Python 3.10 or newer. On Windows, install from python.org and tick *"Add
Python to PATH"*.

```bash
pip install -r requirements.txt          # opencv + numpy
python scripts/face_agent.py models --download
python scripts/face_agent.py doctor
```

`doctor` prints what is working and what is missing, and exits non-zero until a
backend is actually usable.

### 2. Build a standalone .exe (optional)

To run it on a PC with no Python installed:

```bash
pip install pyinstaller
python scripts/build_executable.py
```

That writes `dist/face-agent.exe` on Windows (`dist/face-agent` elsewhere).
Copy it wherever you like and add that folder to `PATH` so you can type
`face-agent` from any terminal. `--onedir` builds a folder instead of one file:
bigger on disk, much faster to start.

The frozen executable stores data in the same place as the script
(`~/.face_agent`, or `%USERPROFILE%\.face_agent` on Windows), so you can build
it after you've already enrolled people and nothing is lost.

---

## Backends

| Backend | Install cost | Embedding | Match rule | Default threshold |
| --- | --- | --- | --- | --- |
| `sface` (default) | `pip install opencv-python` + two ONNX files | 128-d | cosine similarity, higher wins | 0.363 |
| `dlib` | needs cmake and a C++ compiler | 128-d | euclidean distance, lower wins | 0.6 |

`--backend auto` (the default) picks the first one that actually works.

Embeddings from the two backends are not comparable, so the store keeps them
separate: faces enrolled under `sface` are invisible to `dlib` and vice versa.
If you switch backends, re-enroll.

Every result also carries a normalized `confidence` from 0 to 1, which is
exactly 0.5 at the threshold, so an agent can reason about certainty without
knowing which backend produced it.

---

## Command line

```bash
face-agent doctor                                  # health check
face-agent models --download                       # fetch the ONNX models

face-agent enroll --name "Jane Doe" --images ./photos/jane
face-agent enroll --name "Jane Doe" --camera --shots 5
face-agent list
face-agent remove --name "Jane Doe"

face-agent identify --image ./unknown.jpg
face-agent identify --camera --json
face-agent watch --camera 0 --cooldown 30          # JSON lines, one per arrival
face-agent events --limit 20                       # recognition history
```

Enrollment tips: 3–10 photos per person, varying angle and lighting, one face
per photo. Files with zero or two faces are skipped and reported rather than
guessed at.

Useful flags, accepted before or after the subcommand:

| Flag | Meaning |
| --- | --- |
| `--json` | Machine-readable output (what agents should use) |
| `--backend {auto,sface,dlib}` | Force a backend |
| `--threshold N` | Override the match threshold — raise it to reduce false matches |
| `--db PATH` | Use a different database file |

Environment variables: `FACE_AGENT_HOME` (data directory), `FACE_AGENT_BACKEND`,
`FACE_AGENT_TOKEN` (API token).

---

## Connecting your AI agent

### Option A — MCP (best for Claude Code, Claude Desktop, and other MCP clients)

`face-agent mcp` speaks MCP over stdio, no extra packages needed.

```bash
claude mcp add face-agent -- python /path/to/scripts/face_agent.py mcp
```

Or, in a client config file:

```json
{
  "mcpServers": {
    "face-agent": {
      "command": "python",
      "args": ["C:\\tools\\AI-AGENTS\\scripts\\face_agent.py", "mcp"]
    }
  }
}
```

With the frozen build, use `"command": "C:\\tools\\face-agent.exe", "args": ["mcp"]`.

### Option B — local HTTP API

```bash
face-agent serve --port 8765
```

It binds `127.0.0.1` only and prints a bearer token (stored at
`~/.face_agent/token`; `face-agent token --rotate` replaces it). Every route
except `/health` requires it.

```bash
TOKEN=$(face-agent token)

curl http://127.0.0.1:8765/health

curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8765/tools

curl -X POST http://127.0.0.1:8765/identify \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"image": "/path/to/photo.jpg"}'
```

Routes are the tool names, with or without the `face_` prefix:
`/identify`, `/enroll`, `/list`, `/remove`, `/events`, `/status`.
`POST /identify` also accepts `{"image_base64": "..."}` or `{"camera": 0}`.

### Option C — function calling

`face-agent schema` prints the tool definitions as JSON, ready to paste into a
tool-calling loop:

```python
import json, subprocess

tools = json.loads(subprocess.run(
    ["face-agent", "schema"], capture_output=True, text=True, check=True).stdout)

def call_tool(name, args):
    proc = subprocess.run(
        ["face-agent", name.removeprefix("face_"), "--json",
         *sum((["--" + k, str(v)] for k, v in args.items()), [])],
        capture_output=True, text=True)
    return json.loads(proc.stdout)
```

### What the agent gets back

```json
{
  "ok": true,
  "source": "/path/to/photo.jpg",
  "backend": "sface",
  "faces_detected": 1,
  "faces": [
    {
      "name": "Jane Doe",
      "candidate": "Jane Doe",
      "matched": true,
      "score": 0.512,
      "confidence": 0.617,
      "metric": "cosine",
      "threshold": 0.363
    }
  ],
  "best_match": { "name": "Jane Doe", "confidence": 0.617, "...": "..." },
  "timestamp": "2026-09-18T12:00:00+00:00"
}
```

`name` is `"unknown"` when nothing clears the threshold, while `candidate`
still names the closest person — useful for an agent deciding whether to ask
for confirmation rather than guessing.

---

## Where things live

```
~/.face_agent/
  faces.db     SQLite: identities, embeddings, recognition events
  token        bearer token for the HTTP API
  models/      the two ONNX files used by the sface backend
```

Deleting `faces.db` erases every enrolled face. `face-agent remove --name X`
deletes one person, samples included.

The database holds embeddings, not photos: a 128-number vector per sample. That
is not reversible into a recognizable picture, but it is still biometric data
and still identifies the person — back it up and protect it accordingly.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `no usable face recognition backend` | `pip install opencv-python` then `face-agent models --download` |
| `missing model files` | `face-agent models --download` (needs internet once) |
| `could not open camera 0` | Close other apps using the webcam; on Windows check Settings → Privacy → Camera; try `--camera 1` |
| Everyone matches the same person | Threshold too loose: `--threshold 0.5` on sface, `--threshold 0.45` on dlib |
| Known people come back `unknown` | Enroll more photos in varied lighting, or loosen the threshold slightly |
| `401` from the API | Send `Authorization: Bearer $(face-agent token)` |
| `got a Git LFS pointer instead of the model` | The model URL was overridden to a `raw.githubusercontent.com` address, which serves the LFS stub. Unset `FACE_AGENT_YUNET_URL` / `FACE_AGENT_SFACE_URL` to use the `github.com/.../raw/...` defaults. |

---

## Development

```bash
pip install -r requirements-dev.txt
pytest            # full suite; needs no camera or vision libraries
ruff check .
ruff format --check .
```

The test suite fakes the vision backends on purpose. That keeps CI fast and
proves the script fails cleanly — with an explanation — on a machine where
opencv and dlib are not installed.
