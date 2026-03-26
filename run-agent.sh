#!/bin/bash
# moongpt-harness Agent Runner
# Usage: ./run-agent.sh <agent> <project>
#   agent:   test | fix | master
#   project: dex-ui | ... (must match a file in projects/{project}.json)

set -e

AGENT=$1
PROJECT=${2:-dex-ui}
HARNESS_DIR="/home/ubuntu/chainup/moongpt-harness"
CLAUDE="/home/ubuntu/.local/bin/claude"
PROJECT_CONFIG="$HARNESS_DIR/projects/${PROJECT}.json"

if [ -z "$AGENT" ]; then
  echo "Usage: $0 <test|fix|master> [project]"
  exit 1
fi

if [ ! -f "$PROJECT_CONFIG" ]; then
  echo "Project config not found: $PROJECT_CONFIG"
  exit 1
fi

case "$AGENT" in
  test|fix|master) ;;
  *) echo "Unknown agent: $AGENT"; exit 1 ;;
esac

# Load secrets from .env
if [ -f "$HARNESS_DIR/.env" ]; then
  export $(grep -v '^#' "$HARNESS_DIR/.env" | xargs)
fi

# Export project config as env var for agent prompt
export HARNESS_PROJECT="$PROJECT"
export HARNESS_PROJECT_CONFIG="$PROJECT_CONFIG"

PROMPT_FILE="$HARNESS_DIR/agents/${AGENT}-agent.md"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting $AGENT agent for project: $PROJECT"

cd "$HARNESS_DIR"
git pull origin randd1024 --quiet 2>/dev/null || true

$CLAUDE \
  --print \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  --max-turns 40 \
  -p "$(cat "$PROMPT_FILE")

---
## 当前项目配置
项目名: $PROJECT
配置文件: $PROJECT_CONFIG
配置内容:
$(cat "$PROJECT_CONFIG")"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] $AGENT agent completed for $PROJECT."
