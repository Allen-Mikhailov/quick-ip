#!/usr/bin/env bash
#
# Installs quick-ip service as a systemd service that starts on every boot
# and keeps running, reporting this Pi's IP address to Firestore.
#
# Usage:
#   sudo ./install_service.sh
#
# Run this from the pi-agent/ folder, with config.json already filled in
# (copy config.example.json -> config.json and paste in the values shown
# by the "View config" button on the web dashboard).

set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Please run this with sudo: sudo ./install_service.sh"
  exit 1
fi

apt update
apt install wireless-tools

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/quick-ip"
SERVICE_NAME="quick-ip"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ ! -f "${SCRIPT_DIR}/config.json" ]]; then
  echo "Missing ${SCRIPT_DIR}/config.json"
  echo "Copy config.example.json to config.json and fill it in with the values"
  echo "from the 'View config' button on the web dashboard, then re-run this script."
  exit 1
fi

PYTHON_BIN="$(command -v python3)"
if [[ -z "${PYTHON_BIN}" ]]; then
  echo "python3 not found. Install it with: sudo apt install python3"
  exit 1
fi

echo "Installing to ${INSTALL_DIR} ..."
mkdir -p "${INSTALL_DIR}"
cp "${SCRIPT_DIR}/report_ip.py" "${INSTALL_DIR}/report_ip.py"
cp "${SCRIPT_DIR}/config.json" "${INSTALL_DIR}/config.json"
chmod 600 "${INSTALL_DIR}/config.json"   # the token inside is this Pi's secret

echo "Writing systemd unit ${SERVICE_FILE} ..."
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Quick IP - reports this device's IP address
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PYTHONUNBUFFERED=1
ExecStart=${PYTHON_BIN} -u ${INSTALL_DIR}/report_ip.py ${INSTALL_DIR}/config.json
Restart=always

RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

echo "Enabling and starting the service ..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo
echo "Done. The service will now start automatically on every boot."
echo "Check status with:   systemctl status ${SERVICE_NAME}"
echo "Tail the logs with:  journalctl -u ${SERVICE_NAME} -f"

