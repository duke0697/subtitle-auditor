from __future__ import annotations

import json
import sys
import threading
from typing import Any, Callable

ASYNC = object()


class Responder:
    def __init__(self, server: "RpcServer", request_id: Any):
        self._server = server
        self._request_id = request_id

    def respond(self, result: Any) -> None:
        self._server.send_raw({"jsonrpc": "2.0", "id": self._request_id, "result": result})

    def fail(self, message: str, code: int = -32000, data: Any = None) -> None:
        error: dict[str, Any] = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        self._server.send_raw({"jsonrpc": "2.0", "id": self._request_id, "error": error})


class RpcServer:
    def __init__(
        self,
        dispatch: Callable[[str, dict[str, Any], Responder], Any],
        notify: Callable[[str, Any], None] | None = None,
    ):
        self._dispatch = dispatch
        self._write_lock = threading.Lock()
        self._notify = notify

    def notify(self, method: str, params: Any) -> None:
        self.send_raw({"jsonrpc": "2.0", "method": method, "params": params})

    def send_raw(self, payload: dict[str, Any]) -> None:
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self._write_lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    def serve_forever(self) -> None:
        stream = getattr(sys.stdin, "buffer", sys.stdin)
        for raw in stream:
            if isinstance(raw, bytes):
                try:
                    raw = raw.decode("utf-8")
                except UnicodeDecodeError:
                    continue
            raw = raw.strip()
            if not raw:
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            request_id = message.get("id")
            method = message.get("method")
            params = message.get("params") or {}
            if not method:
                continue
            responder = Responder(self, request_id)
            try:
                result = self._dispatch(method, params, responder)
                if result is not ASYNC:
                    responder.respond(result)
            except Exception as exc:  # noqa: BLE001 - surfaced to the UI
                responder.fail(str(exc), data={"type": type(exc).__name__})
