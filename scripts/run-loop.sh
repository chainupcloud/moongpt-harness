#!/bin/bash
# Continuous explore loop — runs explore back-to-back, each with a fresh Claude context.
# Each invocation is an independent claude --print process (no shared context/memory).
# Usage: bash scripts/run-loop.sh [project]

PROJECT=${1:-dex-ui}
HARNESS_DIR="/home/ubuntu/chainup/moongpt-harness"
LOG="$HARNESS_DIR/logs/${PROJECT}-explore-loop.log"
COOLDOWN=30       # seconds between runs (let git push settle, cleanup Playwright processes)
API_RETRY=600     # seconds to wait when backend API is down (10 minutes)

# Load project config to get the API health check URL
if [ -f "$HARNESS_DIR/.env" ]; then
  export $(grep -v '^#' "$HARNESS_DIR/.env" | xargs)
fi

# Read staging URL from project config
STAGING_URL=$(python3 -c "
import json
cfg = json.load(open('$HARNESS_DIR/projects/$PROJECT.json'))
print(cfg.get('test', {}).get('staging_url') or '')
" 2>/dev/null)

check_api_health() {
  # Returns 0 if API is healthy, 1 if down
  if [ -z "$STAGING_URL" ]; then
    return 0  # no staging URL configured, skip check
  fi
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 15 \
    "${STAGING_URL}/dex-api/info" \
    -H 'accept: */*' \
    -H 'content-type: application/json' \
    --data-raw '{"type":"metaAndAssetCtxs"}' 2>/dev/null)
  [ "$HTTP_CODE" = "200" ]
}

echo "[$(date '+%Y-%m-%d %H:%M:%S')] explore-loop started for $PROJECT (PID $$)" >> "$LOG"

while true; do
    # ── API health check before each run ──────────────────────────────────────
    while ! check_api_health; do
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] explore-loop: backend API unavailable (${STAGING_URL}/dex-api/info), sleeping ${API_RETRY}s..." >> "$LOG"
        sleep $API_RETRY
    done
    # ──────────────────────────────────────────────────────────────────────────

    bash "$HARNESS_DIR/scripts/run-agent.sh" explore "$PROJECT" >> "$LOG" 2>&1
    EXIT=$?
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] explore-loop: run finished (exit=$EXIT), sleeping ${COOLDOWN}s" >> "$LOG"
    sleep $COOLDOWN
done
