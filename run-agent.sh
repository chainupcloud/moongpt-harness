#!/bin/bash
# moongpt-harness Agent Runner
# Usage: ./run-agent.sh test|fix|master

set -e

AGENT=$1
HARNESS_DIR="/home/ubuntu/chainup/moongpt-harness"
CLAUDE="/home/ubuntu/.local/bin/claude"

if [ -z "$AGENT" ]; then
  echo "Usage: $0 test|fix|master"
  exit 1
fi

# Load env (GH_TOKEN, VERCEL_TOKEN etc.)
if [ -f "$HARNESS_DIR/.env" ]; then
  export $(grep -v '^#' "$HARNESS_DIR/.env" | xargs)
fi

# Validate agent name
case "$AGENT" in
  test|fix|master) ;;
  *) echo "Unknown agent: $AGENT"; exit 1 ;;
esac

PROMPT_FILE="$HARNESS_DIR/agents/${AGENT}-agent.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Prompt file not found: $PROMPT_FILE"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting $AGENT agent..."

cd "$HARNESS_DIR"

# Pull latest state before running
git pull origin randd1024 --quiet 2>/dev/null || true

$CLAUDE \
  --print \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  --max-turns 40 \
  -p "$(cat "$PROMPT_FILE")"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] $AGENT agent completed."
