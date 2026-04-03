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

echo "Fetching ${URL} ..."
RESPONSE=$(curl -s --max-time 300 "$URL")

# Check for error
if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  echo "Error: $(echo "$RESPONSE" | jq -r '.error')"
  exit 1
fi

# Write HTML
echo "$RESPONSE" | jq -r '.html' > "${DIR}/page.html"
echo "Wrote ${DIR}/page.html ($(wc -c < "${DIR}/page.html" | tr -d ' ') bytes)"

# Write log
echo "$RESPONSE" | jq '.log' > "${DIR}/log.json"
echo "Wrote ${DIR}/log.json"

# Write screenshots
COUNT=$(echo "$RESPONSE" | jq '.screenshots | length')
for i in $(seq 0 $((COUNT - 1))); do
  echo "$RESPONSE" | jq -r ".screenshots[$i]" | base64 -d > "${DIR}/screenshot-${i}.png"
  echo "Wrote ${DIR}/screenshot-${i}.png"
done

# Summary
echo ""
echo "Done. Total duration: $(echo "$RESPONSE" | jq '.log.totalDurationMs // "N/A"')ms"
echo "Output: ${DIR}/"
