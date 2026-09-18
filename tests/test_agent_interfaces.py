"""The surfaces an AI agent talks to: tool schemas, HTTP API, MCP stdio server."""

from __future__ import annotations

import io
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import face_agent as fa
import pytest
from conftest import FakeBackend, write_faces

# -- tool schemas ----------------------------------------------------------


def test_tool_schemas_are_well_formed() -> None:
    names = [t["name"] for t in fa.TOOL_SCHEMAS]
    assert names == sorted(set(names), key=names.index), "tool names must be unique"
    for tool in fa.TOOL_SCHEMAS:
        assert tool["name"].startswith("face_")
        assert tool["description"].strip()
        schema = tool["input_schema"]
        assert schema["type"] == "object"
        assert isinstance(schema.get("properties"), dict)
        for required in schema.get("required", []):
            assert required in schema["properties"]
    # must survive a JSON round trip, since that is how agents receive it
    assert json.loads(json.dumps(fa.TOOL_SCHEMAS)) == fa.TOOL_SCHEMAS


# -- dispatch --------------------------------------------------------------


@pytest.fixture()
def patched(monkeypatch: pytest.MonkeyPatch) -> FakeBackend:
    backend = FakeBackend()
    monkeypatch.setattr(fa, "resolve_backend", lambda name, threshold=None: backend)
    return backend


def test_dispatch_list_and_remove(store: fa.FaceStore, patched: FakeBackend) -> None:
    store.add_face("Jane", [1.0, 0.0], "fake")
    assert fa.dispatch_tool("face_list", {}, store, "auto")["count"] == 1
    assert fa.dispatch_tool("face_remove", {"name": "Jane"}, store, "auto")["removed"]


def test_dispatch_remove_requires_name(store: fa.FaceStore, patched: FakeBackend) -> None:
    with pytest.raises(fa.FaceAgentError, match="requires 'name'"):
        fa.dispatch_tool("face_remove", {}, store, "auto")


def test_dispatch_identify(store: fa.FaceStore, patched: FakeBackend, tmp_path: Path) -> None:
    store.add_face("Jane", [1.0, 0.0], "fake")
    probe = write_faces(tmp_path / "p.txt", [1.0, 0.0])
    result = fa.dispatch_tool("face_identify", {"image": str(probe)}, store, "auto")
    assert result["best_match"]["name"] == "Jane"


def test_dispatch_enroll(store: fa.FaceStore, patched: FakeBackend, tmp_path: Path) -> None:
    img = write_faces(tmp_path / "j.txt", [1.0, 0.0])
    result = fa.dispatch_tool("face_enroll", {"name": "Jane", "images": [str(img)]}, store, "auto")
    assert result["added"] == 1


def test_dispatch_status_and_events(store: fa.FaceStore, patched: FakeBackend) -> None:
    assert "backends" in fa.dispatch_tool("face_status", {}, store, "auto")
    store.log_event("identify", "Jane", 0.9)
    assert len(fa.dispatch_tool("face_events", {"limit": 5}, store, "auto")["events"]) == 1


def test_dispatch_unknown_tool(store: fa.FaceStore, patched: FakeBackend) -> None:
    with pytest.raises(fa.FaceAgentError, match="unknown tool"):
        fa.dispatch_tool("face_launch_missiles", {}, store, "auto")


def test_every_schema_tool_is_dispatchable(
    store: fa.FaceStore, patched: FakeBackend, tmp_path: Path
) -> None:
    """A tool advertised to an agent that the dispatcher rejects is a broken contract."""
    img = write_faces(tmp_path / "j.txt", [1.0, 0.0])
    args = {
        "face_identify": {"image": str(img)},
        "face_enroll": {"name": "Jane", "images": [str(img)]},
        "face_remove": {"name": "Jane"},
        "face_events": {},
        "face_list": {},
        "face_status": {},
    }
    for tool in fa.TOOL_SCHEMAS:
        result = fa.dispatch_tool(tool["name"], args[tool["name"]], store, "auto")
        assert isinstance(result, dict) and "ok" in result


# -- MCP -------------------------------------------------------------------


def test_mcp_initialize(tmp_path: Path) -> None:
    response = fa.handle_mcp_message(
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        tmp_path / "faces.db",
        "auto",
    )
    assert response["result"]["serverInfo"]["name"] == "face-agent"
    assert response["result"]["protocolVersion"] == fa.MCP_PROTOCOL_VERSION
    assert "tools" in response["result"]["capabilities"]


def test_mcp_notifications_get_no_response(tmp_path: Path) -> None:
    assert (
        fa.handle_mcp_message(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            tmp_path / "faces.db",
            "auto",
        )
        is None
    )


def test_mcp_tools_list_matches_schemas(tmp_path: Path) -> None:
    response = fa.handle_mcp_message(
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, tmp_path / "faces.db", "auto"
    )
    tools = response["result"]["tools"]
    assert [t["name"] for t in tools] == [t["name"] for t in fa.TOOL_SCHEMAS]
    assert all("inputSchema" in t for t in tools), "MCP spells it inputSchema"


def test_mcp_tools_call(tmp_path: Path, patched: FakeBackend) -> None:
    db = tmp_path / "faces.db"
    with fa.FaceStore(db) as store:
        store.add_face("Jane", [1.0, 0.0], "fake")
    probe = write_faces(tmp_path / "p.txt", [1.0, 0.0])

    response = fa.handle_mcp_message(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "face_identify", "arguments": {"image": str(probe)}},
        },
        db,
        "auto",
    )
    payload = json.loads(response["result"]["content"][0]["text"])
    assert payload["best_match"]["name"] == "Jane"
    assert not response["result"].get("isError")


def test_mcp_tool_error_is_reported_not_raised(tmp_path: Path, patched: FakeBackend) -> None:
    response = fa.handle_mcp_message(
        {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "face_identify", "arguments": {}},
        },
        tmp_path / "faces.db",
        "auto",
    )
    assert response["result"]["isError"] is True
    assert "identify needs" in response["result"]["content"][0]["text"]


def test_mcp_unknown_method(tmp_path: Path) -> None:
    response = fa.handle_mcp_message(
        {"jsonrpc": "2.0", "id": 5, "method": "nope"}, tmp_path / "faces.db", "auto"
    )
    assert response["error"]["code"] == -32601


def test_mcp_stdio_loop_handles_bad_json(tmp_path: Path) -> None:
    stdin = io.StringIO(
        "not json\n" + json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}) + "\n\n"
    )
    stdout = io.StringIO()
    fa.op_mcp(tmp_path / "faces.db", "auto", stdin=stdin, stdout=stdout)

    lines = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert lines[0]["error"]["code"] == -32700
    assert len(lines[1]["result"]["tools"]) == len(fa.TOOL_SCHEMAS)


# -- HTTP ------------------------------------------------------------------


@pytest.fixture()
def server(tmp_path: Path, patched: FakeBackend):
    httpd = fa.op_serve(
        tmp_path / "faces.db", "auto", "127.0.0.1", 0, token="test-token", serve_forever=False
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def call(url: str, token: str | None = None, payload: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    if data:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def test_health_needs_no_token(server: str) -> None:
    status, body = call(f"{server}/health")
    assert status == 200 and body["service"] == "face-agent"


def test_tools_requires_a_token(server: str) -> None:
    assert call(f"{server}/tools")[0] == 401
    assert call(f"{server}/tools", token="wrong")[0] == 401
    status, body = call(f"{server}/tools", token="test-token")
    assert status == 200 and len(body["tools"]) == len(fa.TOOL_SCHEMAS)


def test_post_requires_a_token(server: str) -> None:
    status, body = call(f"{server}/identify", payload={})
    assert status == 401 and body["ok"] is False


def test_post_identify_round_trip(server: str, tmp_path: Path) -> None:
    img = write_faces(tmp_path / "j.txt", [1.0, 0.0])
    status, body = call(
        f"{server}/enroll", token="test-token", payload={"name": "Jane", "images": [str(img)]}
    )
    assert status == 200 and body["added"] == 1

    status, body = call(f"{server}/identify", token="test-token", payload={"image": str(img)})
    assert status == 200
    assert body["best_match"]["name"] == "Jane"


def test_route_accepts_prefixed_and_bare_names(server: str) -> None:
    for path in ("/list", "/face_list", "/tools/face_list"):
        status, body = call(f"{server}{path}", token="test-token", payload={})
        assert status == 200, path
        assert "identities" in body


def test_unknown_route_is_a_clean_error(server: str) -> None:
    status, body = call(f"{server}/wat", token="test-token", payload={})
    assert status == 400 and "unknown tool" in body["error"]
    assert call(f"{server}/wat", token="test-token")[0] == 404


def test_malformed_body_is_a_400(server: str) -> None:
    request = urllib.request.Request(f"{server}/list", data=b"{not json", method="POST")
    request.add_header("Authorization", "Bearer test-token")
    try:
        with urllib.request.urlopen(request, timeout=10) as resp:
            status, body = resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        status, body = exc.code, json.loads(exc.read())
    assert status == 400 and "not valid JSON" in body["error"]


# -- token -----------------------------------------------------------------


def test_token_is_generated_and_reused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FACE_AGENT_HOME", str(tmp_path))
    monkeypatch.delenv("FACE_AGENT_TOKEN", raising=False)
    first = fa.load_token()
    assert len(first) >= 32
    assert fa.load_token() == first, "token must be stable across runs"


def test_token_env_var_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FACE_AGENT_HOME", str(tmp_path))
    monkeypatch.setenv("FACE_AGENT_TOKEN", "from-env")
    assert fa.load_token() == "from-env"
