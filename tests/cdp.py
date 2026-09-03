#!/usr/bin/env python3
"""
Minimal Chrome DevTools Protocol client — no third-party packages.

Drives headless Chrome well enough to run the browser tests and capture
screenshots: launch, navigate, evaluate JavaScript (awaiting promises) and
screenshot. Implements just the slice of WebSocket needed to talk to Chrome.

Usage:
    python3 tests/cdp.py smoke   [--port 8123]     # run tests/smoke.html
    python3 tests/cdp.py shot <url> <out.png> [--width W] [--height H]
"""

import base64
import json
import os
import socket
import struct
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── Tiny WebSocket client ────────────────────────────────────────────────────

class WS:
    def __init__(self, url: str):
        _, rest = url.split("://", 1)
        hostport, path = rest.split("/", 1)
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n".encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        if b"101" not in buf.split(b"\r\n")[0]:
            raise RuntimeError(f"WebSocket upgrade failed: {buf[:200]!r}")
        self.buf = buf.split(b"\r\n\r\n", 1)[1]

    def send(self, payload: str) -> None:
        data = payload.encode()
        header = bytearray([0x81])                     # FIN + text frame
        mask = os.urandom(4)
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        self.sock.sendall(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("WebSocket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self) -> str:
        while True:
            b0, b1 = self._read(2)
            opcode = b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(length)
            if opcode == 0x9:                          # ping → pong
                continue
            if opcode in (0x1, 0x2):
                return payload.decode("utf-8", "replace")

    def grant_geolocation(self, origin, lat, lng, accuracy=15):
        """Pretend the browser has a GPS fix, so the location paths can be tested."""
        self.call("Browser.grantPermissions", {"origin": origin, "permissions": ["geolocation"]})
        self.call("Emulation.setGeolocationOverride",
                  {"latitude": lat, "longitude": lng, "accuracy": accuracy})

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


# ── Chrome session ───────────────────────────────────────────────────────────

class Chrome:
    def __init__(self, width=390, height=844, port=0, scratch=None):
        # Port 0 lets Chrome choose, and we read back the one it took from
        # DevToolsActivePort. A fixed port is a trap: a browser left running by
        # an earlier run keeps holding it, the new Chrome cannot bind, and we
        # would attach to the old one -- testing the previous version of the
        # code and reporting a pass.
        self.port = port
        # A throwaway profile per run, for the same reason: a reused one caches
        # the app's JS modules.
        self.scratch = scratch or tempfile.mkdtemp(prefix="london-uncovered-chrome-")
        self._owns_scratch = scratch is None
        self.msg_id = 0
        self.proc = subprocess.Popen(
            [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
             "--no-default-browser-check", "--disable-background-networking",
             "--disable-extensions", "--mute-audio", "--hide-scrollbars",
             # Headless Chrome otherwise throttles timers in pages it treats as
             # backgrounded, which stalls any polling loop inside the page.
             "--disable-background-timer-throttling",
             "--disable-backgrounding-occluded-windows",
             "--disable-renderer-backgrounding",
             f"--remote-debugging-port={port}", f"--user-data-dir={self.scratch}",
             f"--window-size={width},{height}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self.port = self._read_devtools_port() if port == 0 else port
        ws_url = self._wait_for_target()
        self.ws = WS(ws_url)
        self.call("Page.enable")
        self.call("Runtime.enable")

    def _read_devtools_port(self, timeout=25):
        """Chrome writes the port it actually bound into the profile directory."""
        path = os.path.join(self.scratch, "DevToolsActivePort")
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                first = open(path).read().split("\n")[0].strip()
                if first: return int(first)
            except Exception:
                pass
            time.sleep(0.1)
        raise RuntimeError("Chrome never wrote DevToolsActivePort")

    def _wait_for_target(self, timeout=25):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list", timeout=2) as r:
                    for t in json.load(r):
                        if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                            return t["webSocketDebuggerUrl"]
            except Exception:
                time.sleep(0.25)
        raise RuntimeError("Chrome did not expose a debugging target")

    def call(self, method, params=None, timeout=90):
        self.msg_id += 1
        mid = self.msg_id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
        raise TimeoutError(method)

    def navigate(self, url):
        self.call("Page.navigate", {"url": url})

    def evaluate(self, expression, await_promise=True, timeout=90):
        res = self.call("Runtime.evaluate", {
            "expression": expression,
            "awaitPromise": await_promise,
            "returnByValue": True,
        }, timeout=timeout)
        if res.get("exceptionDetails"):
            detail = res["exceptionDetails"]
            text = detail.get("exception", {}).get("description") or detail.get("text")
            raise RuntimeError(f"page error: {text}")
        return res.get("result", {}).get("value")

    def wait_for(self, expression, timeout=45, step=0.25):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if self.evaluate(expression, await_promise=False):
                    return True
            except RuntimeError:
                pass
            time.sleep(step)
        return False

    def screenshot(self, path, full_page=False):
        params = {"format": "png"}
        if full_page:
            params["captureBeyondViewport"] = True
        data = self.call("Page.captureScreenshot", params)["data"]
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path

    def set_viewport(self, width, height, mobile=False, scale=2):
        self.call("Emulation.setDeviceMetricsOverride", {
            "width": width, "height": height, "deviceScaleFactor": scale,
            "mobile": mobile, "screenWidth": width, "screenHeight": height,
        })

    def grant_geolocation(self, origin, lat, lng, accuracy=15):
        """Pretend the browser has a GPS fix, so the location paths can be tested."""
        self.call("Browser.grantPermissions", {"origin": origin, "permissions": ["geolocation"]})
        self.call("Emulation.setGeolocationOverride",
                  {"latitude": lat, "longitude": lng, "accuracy": accuracy})

    def close(self):
        try:
            self.ws.close()
        finally:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=6)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            if self._owns_scratch:
                shutil.rmtree(self.scratch, ignore_errors=True)


# ── Entry points ─────────────────────────────────────────────────────────────

def pick_dense_plaque():
    """A plaque with many neighbours nearby — the best place to fake a GPS fix."""
    import math
    with open(os.path.join(PROJECT_ROOT, "data", "plaques.geojson"), encoding="utf-8") as f:
        feats = json.load(f)["features"]
    pts = [(f["properties"]["id"], f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0])
           for f in feats]
    best, best_n = pts[0], -1
    for pid, lat, lng in pts:
        n = sum(1 for _, la, lo in pts
                if abs(la - lat) < 0.009 and abs(lo - lng) < 0.014)   # ~1 km box
        if n > best_n:
            best, best_n = (pid, lat, lng), n
    return best


def run_smoke(port):
    browser = Chrome(width=390, height=900)
    try:
        pid, lat, lng = pick_dense_plaque()
        browser.grant_geolocation(f"http://localhost:{port}", lat, lng)
        browser.navigate(f"http://localhost:{port}/tests/smoke.html#geo={pid}")
        ok = browser.wait_for("document.title.startsWith('SMOKE_')", timeout=120)
        if not ok:
            print("TIMED OUT waiting for the smoke test to finish")
            print(browser.evaluate("document.getElementById('out').textContent", False) or "")
            return 1
        print(browser.evaluate("document.getElementById('out').textContent", False))
        title = browser.evaluate("document.title", False)
        print(f"\n{title.replace('_', ' ')}")
        return 0 if title.startswith("SMOKE_PASS") else 1
    finally:
        browser.close()


def run_shot(url, out, width, height, actions=None, scale=2):
    browser = Chrome(width=width, height=height)
    try:
        browser.set_viewport(width, height, mobile=width < 900, scale=scale)
        browser.navigate(url)
        browser.wait_for("!!window.__lu && document.getElementById('boot').hidden", timeout=60)
        browser.wait_for("document.querySelectorAll('.leaflet-tile-loaded').length > 4", timeout=25)
        if actions:
            browser.evaluate(actions)
        time.sleep(1.2)
        browser.screenshot(out)
        print(f"wrote {out}")
        return 0
    finally:
        browser.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "smoke"
    if cmd == "smoke":
        sys.exit(run_smoke(sys.argv[2] if len(sys.argv) > 2 else "8123"))
    if cmd == "shot":
        url, out = sys.argv[2], sys.argv[3]
        w = int(sys.argv[4]) if len(sys.argv) > 4 else 390
        h = int(sys.argv[5]) if len(sys.argv) > 5 else 844
        acts = sys.argv[6] if len(sys.argv) > 6 else None
        sys.exit(run_shot(url, out, w, h, acts))
    print(__doc__)
    sys.exit(2)
