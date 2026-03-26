#!/bin/bash
# Rotating test scheduler — runs one module per hour, cycling through all modules
# Usage: ./run-scheduler.sh [project]
#
# Add new test modules: edit state/schedule.json → modules array
# No changes to cron or this script needed.

set -e

PROJECT=${1:-dex-ui}
HARNESS_DIR="/home/ubuntu/chainup/moongpt-harness"
SCHEDULE_FILE="$HARNESS_DIR/state/schedule.json"
LOG_DIR="$HARNESS_DIR/logs"

# Load secrets
if [ -f "$HARNESS_DIR/.env" ]; then
  export $(grep -v '^#' "$HARNESS_DIR/.env" | xargs)
fi

# Pull latest state
cd "$HARNESS_DIR"
git pull origin randd1024 --quiet 2>/dev/null || true

# Read current module from schedule
CURRENT_INDEX=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(d['current_index'])")
MODULES=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(' '.join(d['modules']))")
MODULES_COUNT=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(len(d['modules']))")
CURRENT_MODULE=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(d['modules'][d['current_index']])")

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Scheduler: running module [$((CURRENT_INDEX+1))/$MODULES_COUNT] = $CURRENT_MODULE (project: $PROJECT)"
echo "Module order: $MODULES"

# Run the selected module
bash "$HARNESS_DIR/run-agent.sh" "$CURRENT_MODULE" "$PROJECT" \
  >> "$LOG_DIR/${CURRENT_MODULE}-agent.log" 2>&1
EXIT=$?
echo "[$(date '+%Y-%m-%d %H:%M:%S')] $CURRENT_MODULE completed (exit: $EXIT)"

# Advance index and record last run
NEXT_INDEX=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print((d['current_index']+1) % len(d['modules']))")
python3 - <<PYEOF
import json, datetime
with open('$SCHEDULE_FILE', 'r') as f:
    d = json.load(f)
d['current_index'] = $NEXT_INDEX
d.setdefault('last_runs', {})['$CURRENT_MODULE'] = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
with open('$SCHEDULE_FILE', 'w') as f:
    json.dump(d, f, indent=2)
PYEOF

# Commit updated schedule state
git add state/schedule.json
git commit -m "schedule: ran $CURRENT_MODULE → next: $(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(d['modules'][d['current_index']])")" --quiet
git push origin randd1024 --quiet

NEXT_MODULE=$(python3 -c "import json; d=json.load(open('$SCHEDULE_FILE')); print(d['modules'][d['current_index']])")
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Scheduler done. Next run: $NEXT_MODULE"
