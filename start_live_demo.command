#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h}"
CREDENTIALS="${1:-$HOME/Downloads/aprl-general-key.json}"
URL="http://127.0.0.1:8080/"

if [[ ! -f "$CREDENTIALS" ]]; then
  echo "Service-account JSON not found: $CREDENTIALS"
  echo "Place aprl-general-key.json in your Mac Downloads folder, then run this file again."
  read -r "?Press Enter to close."
  exit 1
fi

cd "$ROOT_DIR"
python3 tools/serve_live_demo.py --credentials "$CREDENTIALS" &
SERVER_PID=$!

stop_server() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap stop_server EXIT INT TERM

for _ in {1..40}; do
  if curl --silent --fail --output /dev/null "$URL"; then
    open "$URL"
    echo "LT-Mem Live QA is running at $URL"
    echo "Keep this terminal window open during the demo. Press Ctrl+C to stop."
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.25
done

echo "The local server did not start. Check the error above."
wait "$SERVER_PID"
