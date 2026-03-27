#!/bin/bash
# Continuous explore loop — runs explore back-to-back, each with a fresh Claude context.
# Each invocation is an independent claude --print process (no shared context/memory).
# Usage: bash scripts/run-loop.sh [project]

PROJECT=${1:-dex-ui}
HARNESS_DIR="/home/ubuntu/chainup/moongpt-harness"
LOG="$HARNESS_DIR/logs/explore-loop.log"
COOLDOWN=30  # seconds between runs (let git push settle, cleanup Playwright processes)

echo "[$(date '+%Y-%m-%d %H:%M:%S')] explore-loop started for $PROJECT (PID $$)" >> "$LOG"

while true; do
    bash "$HARNESS_DIR/scripts/run-agent.sh" explore "$PROJECT" >> "$LOG" 2>&1
    EXIT=$?
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] explore-loop: run finished (exit=$EXIT), sleeping ${COOLDOWN}s" >> "$LOG"
    sleep $COOLDOWN
done
