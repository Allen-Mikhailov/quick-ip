#!/usr/bin/env python3
"""
pi-fleet-agent: reports this Raspberry Pi's local IP address to the
Pi Fleet Firestore database, so it shows up in the web dashboard.

Reads config.json (same folder, or path given as argv[1]) containing:
  project_id, api_key, device_id, token, name, interval_seconds

No third-party packages required — just the Python 3 standard library.
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

CONFIG_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "config.json"
)


def load_config():
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    for key in ("project_id", "api_key", "device_id", "token", "name"):
        if not cfg.get(key):
            raise ValueError(f"config.json is missing required field: {key}")
    cfg.setdefault("interval_seconds", 60)
    return cfg


def get_local_ip():
    """Find this machine's LAN IP without needing internet access.
    Opens a UDP socket to a public address but never actually sends data."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return socket.gethostbyname(socket.gethostname())
    finally:
        s.close()


def get_wifi_ssid():
    """Returns the currently connected Wi-Fi network name, or "" if this
    Pi is on ethernet, not connected, or iwgetid isn't installed."""
    try:
        result = subprocess.run(
            ["iwgetid", "-r"], capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip()
    except (FileNotFoundError, subprocess.SubprocessError):
        return ""


def report(cfg, ip, wifi):
    """PATCH the device's Firestore document with the current IP and timestamp.
    Including `token` in the update proves to the security rules that this
    caller actually knows the device's secret, not just its document ID."""
    url = (
        f"https://firestore.googleapis.com/v1/projects/{cfg['project_id']}"
        f"/databases/(default)/documents/devices/{cfg['device_id']}"
        f"?updateMask.fieldPaths=ip"
        f"&updateMask.fieldPaths=wifi"
        f"&updateMask.fieldPaths=lastSeen"
        f"&updateMask.fieldPaths=token"
        f"&key={cfg['api_key']}"
    )

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    body = {
        "fields": {
            "ip": {"stringValue": ip},
            "wifi": {"stringValue": wifi},
            "lastSeen": {"timestampValue": now},
            "token": {"stringValue": cfg["token"]},
        }
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="PATCH",
        headers={"Content-Type": "application/json"},
    )

    with urllib.request.urlopen(req, timeout=15) as resp:
        resp.read()


def main():
    cfg = load_config()
    interval = cfg["interval_seconds"]
    print(f"pi-fleet-agent starting for device '{cfg['name']}' (every {interval}s)")

    last_ip = None
    last_wifi = None
    while True:
        try:
            ip = get_local_ip()
            wifi = get_wifi_ssid()
            report(cfg, ip, wifi)
            if ip != last_ip or wifi != last_wifi:
                label = wifi if wifi else "wired/no wifi"
                print(f"[{datetime.now().isoformat(timespec='seconds')}] reported ip {ip} ({label})")
                last_ip, last_wifi = ip, wifi
        except urllib.error.HTTPError as e:
            print(f"[error] Firestore rejected the update ({e.code}): {e.read().decode(errors='ignore')}")
        except Exception as e:
            print(f"[error] {e}")

        time.sleep(interval)


if __name__ == "__main__":
    main()