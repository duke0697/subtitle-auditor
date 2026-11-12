import io
import json

from app.rpc import RpcServer


def test_serve_forever_decodes_stdin_as_utf8(monkeypatch):
    payload = (
        json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": "echo", "params": {"path": "三电小车.mp4"}},
            ensure_ascii=False,
        ).encode("utf-8")
        + b"\n"
    )
    stdin = type("Stdin", (), {"buffer": io.BytesIO(payload)})()
    stdout = io.StringIO()
    monkeypatch.setattr("sys.stdin", stdin)
    monkeypatch.setattr("sys.stdout", stdout)

    server = RpcServer(lambda method, params, responder: {"path": params["path"]})
    server.serve_forever()

    response = json.loads(stdout.getvalue())
    assert response["result"]["path"] == "三电小车.mp4"
