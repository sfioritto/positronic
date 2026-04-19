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
      echo "[fake_data] Generated fake dataset"
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
      if [ "$TOOL" = "preview" ] && [ "$RESULT_TYPE" = "preview" ]; then
        # Extract three screenshots (mobile/tablet/desktop) + verdict from
        # preview tool result. Each preview iteration writes three files
        # named screenshot-${iteration}-{mobile,tablet,desktop}.png.
        SIDX=$(find "${DIR}" -maxdepth 1 -name 'screenshot-*-desktop.png' ! -name 'screenshot-final-*' | wc -l | tr -d ' ')
        echo "$line" | jq -r '.result.images.mobile'  | base64 -d > "${DIR}/screenshot-${SIDX}-mobile.png"
        echo "$line" | jq -r '.result.images.tablet'  | base64 -d > "${DIR}/screenshot-${SIDX}-tablet.png"
        echo "$line" | jq -r '.result.images.desktop' | base64 -d > "${DIR}/screenshot-${SIDX}-desktop.png"
        APPROVED=$(echo "$line" | jq -r '.result.verdict.approved')
        ISSUE_COUNT=$(echo "$line" | jq -r '.result.verdict.issues | length')
        echo "[preview] Wrote ${DIR}/screenshot-${SIDX}-{mobile,tablet,desktop}.png (approved=${APPROVED}, ${ISSUE_COUNT} issues)"
        if [ "$APPROVED" = "false" ] && [ "$ISSUE_COUNT" -gt 0 ]; then
          echo "$line" | jq -r '.result.verdict.issues[] | "  - " + .'
        fi
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
      # Write any final screenshots that came with the complete event.
      # Each entry is { mobile, tablet, desktop } base64 strings.
      COUNT=$(echo "$line" | jq '.screenshots // [] | length')
      if [ "$COUNT" -gt 0 ]; then
        for i in $(seq 0 $((COUNT - 1))); do
          echo "$line" | jq -r ".screenshots[$i].mobile"  | base64 -d > "${DIR}/screenshot-final-${i}-mobile.png"
          echo "$line" | jq -r ".screenshots[$i].tablet"  | base64 -d > "${DIR}/screenshot-final-${i}-tablet.png"
          echo "$line" | jq -r ".screenshots[$i].desktop" | base64 -d > "${DIR}/screenshot-final-${i}-desktop.png"
          echo "Wrote ${DIR}/screenshot-final-${i}-{mobile,tablet,desktop}.png"
        done
      fi
      TOTAL=$(echo "$line" | jq '.log.totalDurationMs // "N/A"')
      echo ""
      echo "Done. Total duration: ${TOTAL}ms"
      ;;
    error)
      MSG=$(echo "$line" | jq -r '.message')
      NAME=$(echo "$line" | jq -r '.name // empty')
      STACK=$(echo "$line" | jq -r '.stack // empty')
      HAS_CAUSE=$(echo "$line" | jq 'has("cause")')
      echo ""
      if [ -n "$NAME" ]; then
        echo "ERROR (${NAME}): ${MSG}"
      else
        echo "ERROR: ${MSG}"
      fi
      if [ "$HAS_CAUSE" = "true" ]; then
        echo "  caused by:"
        echo "$line" | jq -r '.cause | if type == "object" then "    " + (.name // "Error") + ": " + (.message // "") else "    " + tostring end'
      fi
      if [ -n "$STACK" ]; then
        echo "  stack:"
        echo "$STACK" | sed 's/^/    /'
      fi
      # Save the full error payload to disk for post-mortem — includes
      # responseMessages if present, plus stack/cause.
      echo "$line" | jq '.' > "${DIR}/error.json"
      echo "Saved full error to ${DIR}/error.json"
      ;;
    *)
      # Unknown event type — dump it
      echo "[unknown] $line"
      ;;
  esac
done

echo "Output: ${DIR}/"
