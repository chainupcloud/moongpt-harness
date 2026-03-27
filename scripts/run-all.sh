#!/bin/bash
# Run all test agents sequentially for a project
# Usage: ./run-all.sh [project]
# Each agent runs in its own Claude session (independent context)

PROJECT=${1:-dex-ui}
HARNESS_DIR="/home/ubuntu/chainup/moongpt-harness"
LOG_DIR="$HARNESS_DIR/logs"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] run-all start for $PROJECT"

# Ordered list of test agents — add new modules here
TEST_AGENTS=(explore)

for AGENT in "${TEST_AGENTS[@]}"; do
  echo ""
  echo "════════════════════════════════════════"
  echo "Running: $AGENT"
  echo "════════════════════════════════════════"
  bash "$HARNESS_DIR/scripts/run-agent.sh" "$AGENT" "$PROJECT" \
    >> "$LOG_DIR/${AGENT}-agent.log" 2>&1
  EXIT=$?
  if [ $EXIT -ne 0 ]; then
    echo "[WARN] $AGENT exited with code $EXIT — continuing"
  fi
done

echo ""
echo "[$(date '+%Y-%m-%d %H:%M:%S')] run-all complete for $PROJECT"
