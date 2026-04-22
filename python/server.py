#!/usr/bin/env python3
"""MUreplay local server with NPZ loading + edit endpoints."""

from __future__ import annotations

import argparse
import json
import traceback
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from mureplay.api import (
    api_add_spikes,
    api_delete_dr,
    api_delete_spikes,
    api_flag_mu,
    api_load_npz,
    api_load_paired_decomp,
    api_load_paired_from_path,
    api_remove_outliers,
    api_save_edits,
    api_update_filter,
)
from mureplay.dialog import open_native_dialog

JsonApi = Callable[[dict[str, Any]], dict[str, Any]]

# Single persistent worker thread so BLAS can use all cores without conflicts
# across ephemeral HTTP-request threads on Windows.
_compute_pool = ThreadPoolExecutor(max_workers=1)


class MUReplayHandler(SimpleHTTPRequestHandler):
    bids_root: str = ""

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json_response(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _text_response(self, status: int, message: str) -> None:
        body = message.encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _parse_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length > 0 else b"{}"
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON body: {exc}") from exc
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object.")
        return data

    def _parse_upload_file(self, field_name: str = "file") -> bytes:
        content_type = self.headers.get("Content-Type") or ""
        if "multipart/form-data" not in content_type:
            raise ValueError("Expected multipart/form-data upload.")

        boundary_token = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary_token = part.split("=", 1)[1].strip().strip('"')
                break
        if not boundary_token:
            raise ValueError("Missing multipart boundary.")

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            raise ValueError("Uploaded file is empty.")
        body = self.rfile.read(length)

        boundary = f"--{boundary_token}".encode()
        for chunk in body.split(boundary):
            part = chunk.strip()
            if not part or part == b"--":
                continue
            if part.startswith(b"\r\n"):
                part = part[2:]
            if part.endswith(b"--"):
                part = part[:-2]
            if part.endswith(b"\r\n"):
                part = part[:-2]

            header_blob, sep, data = part.partition(b"\r\n\r\n")
            if not sep:
                continue
            headers_text = header_blob.decode("utf-8", errors="replace")
            content_disposition = ""
            for header_line in headers_text.split("\r\n"):
                if header_line.lower().startswith("content-disposition:"):
                    content_disposition = header_line
                    break
            if f'name="{field_name}"' not in content_disposition:
                continue
            if not data:
                raise ValueError("Uploaded file is empty.")
            return data

        raise ValueError(f"Missing multipart upload field: {field_name}.")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self._json_response(HTTPStatus.OK, {"status": "ok"})
            return
        if self.path == "/api/config":
            self._json_response(HTTPStatus.OK, {"bids_root": self.bids_root})
            return
        if self.path == "/api/open-dialog":
            try:
                path = open_native_dialog()
                if not path:
                    self._json_response(HTTPStatus.OK, {"path": None, "name": None})
                else:
                    self._json_response(HTTPStatus.OK, {"path": path, "name": Path(path).name})
            except Exception as exc:  # noqa: BLE001
                self._text_response(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        json_routes: dict[str, JsonApi] = {
            "/api/load-paired-decomp": api_load_paired_decomp,
            "/api/load-paired-from-path": api_load_paired_from_path,
            "/api/edit/update-filter": api_update_filter,
            "/api/edit/add-spikes": api_add_spikes,
            "/api/edit/delete-spikes": api_delete_spikes,
            "/api/edit/delete-dr": api_delete_dr,
            "/api/edit/remove-outliers": api_remove_outliers,
            "/api/edit/flag-mu": api_flag_mu,
            "/api/edit/save": api_save_edits,
        }

        try:
            if self.path == "/api/load-npz":
                self._json_response(HTTPStatus.OK, api_load_npz(self._parse_upload_file("file")))
                return

            handler = json_routes.get(self.path)
            if handler is not None:
                body = self._parse_json_body()
                result = _compute_pool.submit(handler, body).result()
                self._json_response(HTTPStatus.OK, result)
                return

            self._text_response(HTTPStatus.NOT_FOUND, "Unknown API endpoint.")
        except ValueError as exc:
            self._text_response(HTTPStatus.BAD_REQUEST, str(exc))
        except FileNotFoundError as exc:
            self._text_response(HTTPStatus.NOT_FOUND, str(exc))
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._text_response(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))


def main() -> None:
    parser = argparse.ArgumentParser(description="MUreplay local server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--bids-root", default="", help="Path to BIDS data root for paired auto-load")
    args = parser.parse_args()

    MUReplayHandler.bids_root = args.bids_root

    server = ThreadingHTTPServer((args.host, args.port), MUReplayHandler)
    print(f"MUreplay server listening on http://{args.host}:{args.port}")
    print("Endpoints: /api/load-npz, /api/edit/update-filter, /api/edit/save, add/delete/remove")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
