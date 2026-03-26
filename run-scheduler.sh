#!/bin/bash
# Rotating test scheduler — runs one test module per hour, cycling through all modules
# Usage: ./run-scheduler.sh [project]
#
# Add new test modules:
#   1. Edit state/test-schedule.json → add to "modules" array and "run_counts"
#   2. Create tests/xxx.spec.js + agents/xxx-agent.md
# No changes to cron or this script needed.

set -e

PROJECT=${1:-dex-ui}
HARNESS_DIR="/home/ubuntu/chainup/moongpt-harness"
SCHEDULE_FILE="$HARNESS_DIR/state/test-schedule.json"
LOG_DIR="$HARNESS_DIR/logs"

# Load secrets
if [ -f "$HARNESS_DIR/.env" ]; then
  export $(grep -v '^#' "$HARNESS_DIR/.env" | xargs)
fi

# Pull latest state
cd "$HARNESS_DIR"
git pull origin randd1024 --quiet 2>/dev/null || true

# Read current module
CURRENT_INDEX=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(d['current_index'])")
MODULES_LIST=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(' '.join(d['modules']))")
MODULES_COUNT=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(len(d['modules']))")
CURRENT_MODULE=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(d['modules'][d['current_index']])")
RUN_COUNT=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(d.get('run_counts',{}).get('$CURRENT_MODULE', 0))")

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Scheduler: module [$((CURRENT_INDEX+1))/$MODULES_COUNT] = $CURRENT_MODULE (run #$((RUN_COUNT+1)), project: $PROJECT)"
echo "Order: $MODULES_LIST"

# Run the selected module
bash "$HARNESS_DIR/run-agent.sh" "$CURRENT_MODULE" "$PROJECT" \
  >> "$LOG_DIR/test-${CURRENT_MODULE}.log" 2>&1
EXIT=$?
echo "[$(date '+%Y-%m-%d %H:%M:%S')] $CURRENT_MODULE done (exit: $EXIT)"

# Advance index, increment run count, record timestamp
NEXT_INDEX=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print((d['current_index']+1) % len(d['modules']))")
python3 - <<PYEOF
import json, datetime
with open('$SCHEDULE_FILE', 'r') as f:
    d = json.load(f)
d['current_index'] = $NEXT_INDEX
d.setdefault('run_counts', {})['$CURRENT_MODULE'] = d.get('run_counts', {}).get('$CURRENT_MODULE', 0) + 1
d.setdefault('last_runs', {})['$CURRENT_MODULE'] = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
with open('$SCHEDULE_FILE', 'w') as f:
    json.dump(d, f, indent=2)
PYEOF

NEXT_MODULE=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(d['modules'][d['current_index']])")
NEW_COUNT=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(d['run_counts'].get('$CURRENT_MODULE', 0))")

# Commit updated schedule
git add state/test-schedule.json
git commit -m "test-schedule: $CURRENT_MODULE run #${NEW_COUNT} → next: ${NEXT_MODULE}" --quiet
git push origin randd1024 --quiet

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Updated test-schedule.json ($CURRENT_MODULE run_count=${NEW_COUNT}). Next: $NEXT_MODULE"
