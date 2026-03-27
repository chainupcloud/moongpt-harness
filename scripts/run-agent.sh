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
  test|smoke|fix|master|explore|plan) ;;
  *) echo "Unknown agent: $AGENT"; exit 1 ;;
esac

# smoke is an alias for test (uses test-agent.md)
[ "$AGENT" = "smoke" ] && AGENT="test"

# 各 Agent 使用的模型
case "$AGENT" in
  test)    MODEL="claude-sonnet-4-6" ;;
  explore) MODEL="claude-sonnet-4-6" ;;
  plan)    MODEL="claude-sonnet-4-6" ;;
  fix)     MODEL="claude-opus-4-6" ;;
  master)  MODEL="" ;;  # 默认模型
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
    d = json.load(open('$HARNESS_DIR/state/$PROJECT/issues.json'))
    n = sum(1 for i in d.get('issues', []) if i.get('status') == 'open' and i.get('fix_attempts', 0) < 3)
    print(n)
except Exception as e:
    print(1)  # on error let Claude handle it
" 2>/dev/null)
  if [ "${OPEN_COUNT:-1}" = "0" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] fix: no open issues with fix_attempts<3 — skipping (0 tokens used)."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] fix agent completed for $PROJECT."
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
    d = json.load(open('$HARNESS_DIR/state/$PROJECT/prs.json'))
    print(sum(1 for p in d.get('prs', []) if p.get('status') == 'open'))
except:
    print(1)
" 2>/dev/null)

  GH_OPEN=$(curl -sf -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/${OWNER}/${REPO}/pulls?state=open&base=${BASE_BRANCH}&per_page=1" \
    | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "1")

  # ── Shell-level issue state sync (no Claude tokens) ──────────────────────
  # For every non-closed issue in state/issues.json, query GitHub and sync if closed.
  ISSUE_TRACKER_OWNER=$(python3 -c "import json; d=json.load(open('$PROJECT_CONFIG')); print(d.get('issue_tracker',d['github'])['owner'])" 2>/dev/null)
  ISSUE_TRACKER_REPO=$(python3 -c "import json; d=json.load(open('$PROJECT_CONFIG')); print(d.get('issue_tracker',d['github'])['repo'])" 2>/dev/null)
  SYNCED=$(python3 - <<'PYEOF'
import json, urllib.request, os, sys

config_path = os.environ.get('HARNESS_PROJECT_CONFIG', '')
harness_dir = '/home/ubuntu/chainup/moongpt-harness'
token = os.environ.get('GH_TOKEN', '')
project = os.environ.get('HARNESS_PROJECT', 'dex-ui')
issues_path = harness_dir + '/state/' + project + '/issues.json'

try:
    with open(config_path) as f:
        cfg = json.load(f)
    tracker = cfg.get('issue_tracker', cfg['github'])
    owner, repo = tracker['owner'], tracker['repo']

    with open(issues_path) as f:
        data = json.load(f)

    changed = 0
    for issue in data.get('issues', []):
        if issue.get('status') == 'closed':
            continue
        num = issue.get('github_number')
        if not num:
            continue
        try:
            req = urllib.request.Request(
                f'https://api.github.com/repos/{owner}/{repo}/issues/{num}',
                headers={'Authorization': f'token {token}', 'User-Agent': 'moongpt-harness'}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                gh = json.loads(resp.read())
            if gh.get('state') == 'closed':
                issue['status'] = 'closed'
                issue['closed_at'] = (gh.get('closed_at') or '')[:10]
                issue.setdefault('note', '')
                issue['note'] = 'Synced from GitHub (closed by human)'
                changed += 1
        except Exception as e:
            pass

    if changed:
        with open(issues_path, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(changed)
    else:
        print(0)
except Exception as e:
    print(0)
PYEOF
)
  if [ "${SYNCED:-0}" != "0" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] master: synced ${SYNCED} issue(s) closed on GitHub → state updated."
    git -C "$HARNESS_DIR" add state/$PROJECT/issues.json
    git -C "$HARNESS_DIR" commit -m "state: sync ${SYNCED} issue(s) closed on GitHub [$PROJECT]" 2>/dev/null || true
    git -C "$HARNESS_DIR" push origin randd1024 2>/dev/null || true
  fi
  # ─────────────────────────────────────────────────────────────────────────

  if [ "${LOCAL_OPEN:-0}" = "0" ] && [ "${GH_OPEN:-0}" = "0" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] master: no open PRs (local=0, github=0) — skipping (0 tokens used)."
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] master agent completed for $PROJECT."
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
