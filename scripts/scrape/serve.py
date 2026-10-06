#!/usr/bin/env python3
"""Scrape sidecar: optional TLS-impersonated HTTP fetch and Camoufox browse.

Lane B (the consumer) expects the exact contract below. Keep it stable.

Design notes
------------
* stdlib http.server only. We import curl_cffi and camoufox inside handlers so
  that missing optional deps do not prevent the server from booting; a missing
  dep simply returns an error payload on the relevant endpoint.
* /fetch runs concurrently because curl_cffi is stateless.
* /browse is serialized by _BROWSE_LOCK because Camoufox keeps one browser
  instance and one page at a time. Constructing a fresh browser per request is
  slow (~300 MB download cached, but startup still heavy), so we reuse a single
  module-level browser lazily initialized under the lock.
* Returned HTML is capped at 5 MB. The caller (Lane B) only needs enough text to
  extract metadata / content; truncating avoids OOMs and keeps JSON payloads
  bounded. We do not signal truncation specially; we just stop returning bytes.
* The contract never throws: every endpoint returns HTTP 200 with a JSON body,
  and failures are encoded in the `error` field. This lets Lane B's retry
  ladder treat network errors and anti-bot pages uniformly.
"""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

# Hard cap on returned HTML to keep JSON bodies bounded and memory low.
MAX_HTML_BYTES = 5 * 1024 * 1024

# Module-level lock serializes /browse (one Camoufox browser at a time).
_BROWSE_LOCK = threading.Lock()

# Lazily initialized Camoufox state, protected by _BROWSE_LOCK.
_browser: Any | None = None
_page: Any | None = None


def _log(msg: str) -> None:
    """One-line request logging to stderr."""
    print(f"[scrape] {msg}", file=sys.stderr, flush=True)


def _trim_html(html: str) -> str:
    """Cap html at MAX_HTML_BYTES bytes, truncating cleanly on a codepoint."""
    encoded = html.encode("utf-8")
    if len(encoded) <= MAX_HTML_BYTES:
        return html
    # Truncate to the largest valid UTF-8 boundary before the cap.
    trimmed = encoded[:MAX_HTML_BYTES]
    while trimmed and (trimmed[-1] & 0xC0) == 0x80:
        trimmed = trimmed[:-1]
    return trimmed.decode("utf-8", errors="ignore")


def _json_response(
    handler: BaseHTTPRequestHandler,
    status_code: int,
    payload: dict[str, Any],
) -> None:
    body = json.dumps(payload).encode("utf-8")
    try:
        handler.send_response(status_code)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError):
        # The caller's AbortSignal may fire a moment before our internal timeout;
        # writing to the dead socket then must not crash the handler thread.
        _log("client went away before the response landed")


def _ok(
    handler: BaseHTTPRequestHandler,
    status: int | None,
    html: str,
    content_type: str | None,
    final_url: str | None,
    error: str | None,
) -> None:
    _json_response(
        handler,
        200,
        {
            "status": status,
            "html": _trim_html(html),
            "contentType": content_type,
            "finalUrl": final_url,
            "error": error,
        },
    )


def _bad_request(handler: BaseHTTPRequestHandler) -> None:
    _json_response(handler, 200, {"error": "bad request"})


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Override to emit a single project-style line.
        _log(f"{self.command} {self.path}")

    def _read_body(self) -> dict[str, Any] | None:
        length = self.headers.get("Content-Length")
        if not length:
            return None
        try:
            raw = self.rfile.read(int(length))
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            _json_response(self, 200, {"ok": True})
            return
        _json_response(self, 200, {"error": "bad request"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/fetch":
            self._handle_fetch()
            return
        if self.path == "/browse":
            self._handle_browse()
            return
        _bad_request(self)

    def _handle_fetch(self) -> None:
        body = self._read_body()
        if not body or not isinstance(body.get("url"), str):
            _bad_request(self)
            return

        url = body["url"]
        timeout_ms = body.get("timeoutMs")
        try:
            timeout = float(timeout_ms) / 1000.0 if timeout_ms is not None else 30.0
        except (TypeError, ValueError):
            timeout = 30.0

        try:
            from curl_cffi import requests as curl_requests

            response = curl_requests.get(
                url,
                impersonate="chrome",
                timeout=timeout,
                allow_redirects=True,
            )
            html = response.text
            # Prefer charset-decoded text; fallback to raw bytes decoded leniently.
            if response.encoding is None and isinstance(response.content, bytes):
                html = response.content.decode("utf-8", errors="replace")

            _ok(
                self,
                status=response.status_code,
                html=html,
                content_type=response.headers.get("Content-Type"),
                final_url=response.url,
                error=None,
            )
        except Exception as exc:  # noqa: BLE001
            _ok(
                self,
                status=None,
                html="",
                content_type=None,
                final_url=None,
                error=str(exc),
            )

    def _handle_browse(self) -> None:
        body = self._read_body()
        if not body or not isinstance(body.get("url"), str):
            _bad_request(self)
            return

        url = body["url"]
        timeout_ms = body.get("timeoutMs")
        try:
            timeout = float(timeout_ms) / 1000.0 if timeout_ms is not None else 30.0
        except (TypeError, ValueError):
            timeout = 30.0
        humanize = bool(body.get("humanize", True))

        with _BROWSE_LOCK:
            try:
                self._browse_with_camoufox(url, timeout, humanize)
            except Exception as exc:  # noqa: BLE001
                _ok(
                    self,
                    status=None,
                    html="",
                    content_type=None,
                    final_url=None,
                    error=str(exc),
                )

    def _browse_with_camoufox(
        self, url: str, timeout: float, humanize: bool
    ) -> None:
        """Run one Camoufox navigation under _BROWSE_LOCK.

        We lazily initialize a single browser + page and reuse them across
        requests. If a page ever crashes we recreate it on the next call.
        """
        global _browser, _page  # noqa: PLW0603

        from camoufox.sync_api import Camoufox

        if _browser is None:
            _log("initializing Camoufox browser")
            _browser = Camoufox(headless=True, humanize=humanize).__enter__()
            _page = _browser.new_page()

        assert _page is not None
        try:
            # The goto budget must fit inside the client's overall AbortSignal
            # timeout together with the settle wait below — otherwise the client
            # aborts first and our error response lands on a closed socket.
            goto_budget_ms = int(max(timeout - 3.0, 5.0) * 1000)
            response = _page.goto(url, wait_until="load", timeout=goto_budget_ms)
        except Exception:
            # A crashed or hung browser poisons every later call: drop the cached
            # instances so the next request re-initializes Camoufox from scratch.
            _browser = None
            _page = None
            raise
        # Brief settle to let lazy JS / analytics finish common render paths.
        _page.wait_for_timeout(2500)
        html = _page.content()

        _ok(
            self,
            # The real navigation status, not a hardcoded 200: a stealth-engine
            # block page (rare for Camoufox) must not look like a success.
            status=response.status if response is not None else None,
            html=html,
            content_type="text/html",
            final_url=_page.url,
            error=None,
        )


def _main() -> None:
    host = os.environ.get("SCRAPE_SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("SCRAPE_SIDECAR_PORT", "9383"))
    allow_remote = os.environ.get("SCRAPE_SIDECAR_ALLOW_REMOTE", "0") == "1"

    if host not in {"127.0.0.1", "localhost", "::1"} and not allow_remote:
        print(
            f"[scrape] refusing to bind to non-loopback host {host}; "
            "set SCRAPE_SIDECAR_ALLOW_REMOTE=1 to override",
            file=sys.stderr,
        )
        sys.exit(1)

    server = ThreadingHTTPServer((host, port), _Handler)
    _log(f"listening on {host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _log("shutting down")
    finally:
        global _browser, _page
        if _browser is not None:
            try:
                _browser.__exit__(None, None, None)
            except Exception as exc:  # noqa: BLE001
                _log(f"browser cleanup error: {exc}")
            _browser = None
            _page = None
        server.server_close()


if __name__ == "__main__":
    _main()
