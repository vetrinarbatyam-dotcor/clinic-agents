#!/bin/bash
# Weekly caller enrichment — pulls real client/pet/insurance from ClinicaOnline
set -a
source /home/claude-user/clinic-agents/.env
source /home/claude-user/clinic-pal-hub/backend/.env
set +a

LOG=/home/claude-user/logs/enrich-$(date +%Y%m%d-%H%M).log
mkdir -p /home/claude-user/logs
cd /home/claude-user/clinic-agents
/root/.bun/bin/bun run /home/claude-user/clinic-agents/missed-caller/enrich_callers.ts > $LOG 2>&1
