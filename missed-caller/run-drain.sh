#!/bin/bash
set -a
source /home/claude-user/clinic-pal-hub/backend/.env
source /home/claude-user/clinic-agents/.env
set +a
cd /home/claude-user/clinic-agents/missed-caller
.venv/bin/python messenger.py drain-overnight --live
