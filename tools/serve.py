#!/usr/bin/env python3
"""Static dev server for HealthQ.

Behaves like `python3 -m http.server` but stays quiet when the browser
cancels a request (DevTools probes, tab reloads during load, navigations
away mid-download). Those BrokenPipeError tracebacks are harmless noise,
not application faults. Real 404s and server errors are still reported.

Usage:
    python3 tools/serve.py [port]
"""
import sys
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class QuietHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".css": "text/css",
        ".svg": "image/svg+xml",
    }

    # Noise the browser generates on its own; not application faults.
    NOISE = (".well-known/appspecific", "favicon.ico")

    # Text payloads here are huge (the food catalogue is ~12 MB of JSON).
    # Serving them gzipped cuts the transfer to roughly a fifth, which makes
    # page loads fast enough that the browser rarely cancels mid-transfer.
    GZIP_TYPES = (
        "text/",
        "application/javascript",
        "application/json",
        "application/manifest+json",
        "image/svg+xml",
    )

    def end_headers(self):
        path = str(getattr(self, "path", ""))
        ctype = self.guess_type(path) if path else ""
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "")
        if (
            accepts_gzip
            and not path.endswith(".gz")
            and any(ctype.startswith(t) or ctype == t for t in self.GZIP_TYPES)
        ):
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
            # The queued Content-Length describes the uncompressed body, which
            # no longer matches what we send. Leaving it in place makes the
            # browser wait for bytes that never arrive, so drop it; the
            # connection close delimits the response instead.
            buf = getattr(self, "_headers_buffer", None)
            if buf is not None:
                self._headers_buffer = [
                    line
                    for line in buf
                    if not line.lower().startswith(b"content-length:")
                ]
        super().end_headers()

    def copyfile(self, source, outputfile):
        import gzip

        if "gzip" not in self.headers.get("Accept-Encoding", ""):
            return super().copyfile(source, outputfile)
        # The Content-Length already sent is the uncompressed size, so write
        # gzip data without letting the base class add its own framing.
        gz = gzip.GzipFile(fileobj=outputfile, mode="wb")
        try:
            shutil.copyfileobj(source, gz)
        finally:
            gz.close()

    def log_message(self, format, *args):
        if self._is_noise():
            return
        super().log_message(format, *args)

    def _is_noise(self):
        return any(m in str(getattr(self, "path", "")) for m in self.NOISE)

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            # Client hung up (reload, navigation, cancelled fetch). Not an error.
            self.close_connection = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(QuietHandler, directory=ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"HealthQ dev server: http://localhost:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
