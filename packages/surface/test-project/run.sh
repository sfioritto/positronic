#!/usr/bin/env bash
set -euo pipefail

# Usage: ./run.sh <endpoint-name> [port]
# Examples:
#   ./run.sh generate
#   ./run.sh hn-reader
#   ./run.sh email-digest
#   ./run.sh hn-reader 8788

ENDPOINT="${1:?Usage: ./run.sh <endpoint-name> [port]}"
PORT="${2:-8787}"
URL="http://localhost:${PORT}/sandbox/${ENDPOINT}"
DIR="output/${ENDPOINT}"

mkdir -p "$DIR"

echo "Fetching ${URL} (streaming) ..."

# Stream NDJSON — each line is a JSON event
curl -sN --max-time 600 "$URL" | while IFS= read -r line; do
  # Skip empty lines
  [ -z "$line" ] && continue

  TYPE=$(echo "$line" | jq -r '.type // empty')

  case "$TYPE" in
    fake_data_done)
      echo "[fake_data] Generated fake data"
      echo "$line" | jq '.data' > "${DIR}/fake-data.json"
      echo "  Wrote ${DIR}/fake-data.json"
      ;;
    tool_start)
      TOOL=$(echo "$line" | jq -r '.tool')
      echo "[${TOOL}] Starting..."
      ;;
    tool_result)
      TOOL=$(echo "$line" | jq -r '.tool')
      RESULT_TYPE=$(echo "$line" | jq -r '.result.type // empty')
      if [ "$TOOL" = "preview" ] && [ "$RESULT_TYPE" = "image" ]; then
        # Extract screenshot from preview tool result
        SIDX=$(find "${DIR}" -maxdepth 1 -name 'screenshot-*.png' | wc -l | tr -d ' ')
        echo "$line" | jq -r '.result.data' | base64 -d > "${DIR}/screenshot-${SIDX}.png"
        echo "[preview] Wrote ${DIR}/screenshot-${SIDX}.png ($(wc -c < "${DIR}/screenshot-${SIDX}.png" | tr -d ' ') bytes)"
      else
        STATUS=$(echo "$line" | jq -r '.result.status // .result.type // "ok"')
        MSG=$(echo "$line" | jq -r '.result.message // empty')
        if [ -n "$MSG" ]; then
          echo "[${TOOL}] ${STATUS}: ${MSG}"
        else
          echo "[${TOOL}] ${STATUS}"
        fi
      fi
      # Append to incremental log
      echo "$line" >> "${DIR}/log.ndjson"
      ;;
    complete)
      echo ""
      echo "=== Generation complete ==="
      echo "$line" | jq -r '.html' > "${DIR}/page.html"
      echo "Wrote ${DIR}/page.html ($(wc -c < "${DIR}/page.html" | tr -d ' ') bytes)"
      # Write the final log
      echo "$line" | jq '{log: .log, htmlSize: .htmlSize}' > "${DIR}/log.json"
      echo "Wrote ${DIR}/log.json"
      # Write any final screenshots that came with the complete event
      COUNT=$(echo "$line" | jq '.screenshots // [] | length')
      if [ "$COUNT" -gt 0 ]; then
        for i in $(seq 0 $((COUNT - 1))); do
          echo "$line" | jq -r ".screenshots[$i]" | base64 -d > "${DIR}/screenshot-final-${i}.png"
          echo "Wrote ${DIR}/screenshot-final-${i}.png"
        done
      fi
      TOTAL=$(echo "$line" | jq '.log.totalDurationMs // "N/A"')
      echo ""
      echo "Done. Total duration: ${TOTAL}ms"
      ;;
    error)
      MSG=$(echo "$line" | jq -r '.message')
      echo ""
      echo "ERROR: ${MSG}"
      ;;
    *)
      # Unknown event type — dump it
      echo "[unknown] $line"
      ;;
  esac
done

echo "Output: ${DIR}/"
