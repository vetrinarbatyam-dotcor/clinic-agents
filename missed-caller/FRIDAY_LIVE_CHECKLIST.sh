#!/bin/bash
# Enables live WhatsApp send for the missed-caller agent.
# Run this Friday 2026-04-24 to flip from dry-run → live.
#
# Current state: messenger.py has --dry-run default=True.
# To go live, we need to:
#   1. Implement actual Green API send in messenger.py (currently no send code)
#   2. Change default to --dry-run=False (or add --live flag)
#
# THIS SCRIPT IS A PLACEHOLDER — invoke it manually on Friday, it reminds the
# owner that live-send code still needs to be implemented before activation.

echo "FRIDAY FLIP CHECKLIST"
echo "====================="
echo ""
echo "Before flipping to live, these need to be done:"
echo ""
echo "  [ ] Add Green API send code to messenger.py's send_now() function"
echo "      (currently only writes to sent_*.jsonl)"
echo "  [ ] Use CLINIC_WHATSAPP_INSTANCE + CLINIC_WHATSAPP_TOKEN from .env"
echo "      (Green API for 035513649)"
echo "  [ ] Add rate limiting: 30-90s delay between messages"
echo "      (per whatsapp_tablet_blocked_2026-04-20 memory)"
echo "  [ ] Cap at 150 sends/day"
echo "  [ ] Test with Gil's personal number first (GIL_WHATSAPP_*)"
echo "  [ ] Review last 72h of logs/sent_*.jsonl to confirm detection quality"
echo "  [ ] After validation, remove --dry-run default and set --live as explicit flag"
echo ""
echo "Logs to review:"
echo "  /home/claude-user/clinic-agents/missed-caller/logs/sent_*.jsonl"
echo "  /home/claude-user/clinic-agents/missed-caller/logs/tick.log"
