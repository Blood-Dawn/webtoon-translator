#!/usr/bin/env bash
# Starts the fake Kakao and Google server, then runs the browser test against the extension.
set -e
cd "$(dirname "$0")"
if [ ! -f key.pem ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 2 -subj "/CN=sandbox" 2>/dev/null
fi
node server.js &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 2
EXT="${1:-..}"
if command -v xvfb-run >/dev/null 2>&1; then
  RUN="xvfb-run -a node"
else
  RUN="node"
fi
$RUN test.js "$EXT"
$RUN local-test.js "$EXT"
