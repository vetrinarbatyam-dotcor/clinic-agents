"""
CLI/dashboard runner for appointment_booker.
Lets the dashboard trigger one-off actions: status, dry-run, list-profiles, etc.
"""
import json
import sys
from agents.appointment_booker import config as cfg_mod
from agents.appointment_booker import state_machine


def cmd_status():
    cfg = cfg_mod.load_config()
    print(json.dumps({
        "enabled": cfg.enabled,
        "mode": cfg.mode,
        "profiles": {k: {"enabled": p.enabled, "name": p.name} for k, p in cfg.profiles.items()},
    }, ensure_ascii=False, indent=2))


def cmd_test(phone: str, text: str):
    result = state_machine.handle_message(phone, text)
    print(json.dumps(result, ensure_ascii=False, default=str, indent=2))


def main():
    if len(sys.argv) < 2:
        print("usage: runner.py {status|test PHONE TEXT}")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "status":
        cmd_status()
    elif cmd == "test":
        cmd_test(sys.argv[2], " ".join(sys.argv[3:]))
    else:
        print(f"unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
