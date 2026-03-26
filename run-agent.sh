#!/bin/bash
# moongpt-harness Agent Runner
# Usage: ./run-agent.sh <agent> <project>
#   agent:   test | fix | master | coverage
#   project: dex-ui | ... (must match a file in projects/{project}.json)

set -e

AGENT=$1
PROJECT=${2:-dex-ui}
HARNESS_DIR="/home/ubuntu/chainup/moongpt-harness"
CLAUDE="/home/ubuntu/.local/bin/claude"
PROJECT_CONFIG="$HARNESS_DIR/projects/${PROJECT}.json"

if [ -z "$AGENT" ]; then
  echo "Usage: $0 <test|fix|master|coverage> [project]"
  exit 1
fi

if [ ! -f "$PROJECT_CONFIG" ]; then
  echo "Project config not found: $PROJECT_CONFIG"
  exit 1
fi

case "$AGENT" in
  test|fix|master|coverage) ;;
  *) echo "Unknown agent: $AGENT"; exit 1 ;;
esac

# 各 Agent 使用的模型
case "$AGENT" in
  test)     MODEL="claude-sonnet-4-6" ;;
  coverage) MODEL="claude-sonnet-4-6" ;;
  fix)      MODEL="claude-opus-4-6" ;;
  master)   MODEL="" ;;  # 默认模型
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

# ── Pre-checks: skip Claude entirely when there is nothing to do ──────────────

if [ "$AGENT" = "fix" ]; then
  OPEN_COUNT=$(python3 -c "
import json, sys
try:
    d = json.load(open('$HARNESS_DIR/state/issues.json'))
    n = sum(1 for i in d.get('issues', []) if i.get('status') == 'open' and i.get('fix_attempts', 0) < 3)
    print(n)
except Exception as e:
    print(1)  # on error let Claude handle it
" 2>/dev/null)
  if [ "${OPEN_COUNT:-1}" = "0" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] fix: no open issues with fix_attempts<3 — skipping (0 tokens used)."
    exit 0
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] fix: $OPEN_COUNT open issue(s) found, proceeding."
fi

if [ "$AGENT" = "master" ]; then
  OWNER=$(python3 -c "import json; d=json.load(open('$PROJECT_CONFIG')); print(d['github']['owner'])" 2>/dev/null)
  REPO=$(python3 -c "import json; d=json.load(open('$PROJECT_CONFIG')); print(d['github']['repo'])" 2>/dev/null)
  BASE_BRANCH=$(python3 -c "import json; d=json.load(open('$PROJECT_CONFIG')); print(d['github'].get('fix_base_branch','dev'))" 2>/dev/null)

  LOCAL_OPEN=$(python3 -c "
import json
try:
    d = json.load(open('$HARNESS_DIR/state/prs.json'))
    print(sum(1 for p in d.get('prs', []) if p.get('status') == 'open'))
except:
    print(1)
" 2>/dev/null)

  GH_OPEN=$(curl -sf -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/${OWNER}/${REPO}/pulls?state=open&base=${BASE_BRANCH}&per_page=1" \
    | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "1")

  if [ "${LOCAL_OPEN:-0}" = "0" ] && [ "${GH_OPEN:-0}" = "0" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] master: no open PRs (local=0, github=0) — skipping (0 tokens used)."
    exit 0
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] master: local_open=${LOCAL_OPEN} github_open=${GH_OPEN}, proceeding."
fi

# ─────────────────────────────────────────────────────────────────────────────

MODEL_FLAG=""
[ -n "$MODEL" ] && MODEL_FLAG="--model $MODEL"

$CLAUDE \
  --print \
  $MODEL_FLAG \
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
