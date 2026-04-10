#!/bin/bash
# marpet-audit cron entry point — runs at 02:00, audits yesterday
set -e

AGENT_DIR="/home/claude-user/clinic-agents/marpet-audit"
LOG_DIR="/home/claude-user/marpat/logs"
mkdir -p "$LOG_DIR" /home/claude-user/marpat

YESTERDAY_ISO=$(date -d 'yesterday' +%Y-%m-%d)
YESTERDAY_HUMAN=$(date -d 'yesterday' +%d/%m/%Y)
LOG_FILE="$LOG_DIR/run-$YESTERDAY_ISO.log"

echo "=== marpet-audit run for $YESTERDAY_HUMAN ($(date)) ===" | tee -a "$LOG_FILE"

cd "$AGENT_DIR"

PROMPT=$(cat "$AGENT_DIR/audit-prompt.md")
PROMPT="$PROMPT

Target date: $YESTERDAY_HUMAN ($YESTERDAY_ISO)"

claude -p "$PROMPT" \
  --allowed-tools "Read,Write,Bash,Edit" \
  --output-format text \
  >> "$LOG_FILE" 2>&1 || echo "claude -p exited with $?" | tee -a "$LOG_FILE"

/root/.bun/bin/bun run "$AGENT_DIR/src/post-audit.ts" "$YESTERDAY_ISO" >> "$LOG_FILE" 2>&1 || echo "post-audit failed" | tee -a "$LOG_FILE"

echo "=== finished $(date) ===" | tee -a "$LOG_FILE"
