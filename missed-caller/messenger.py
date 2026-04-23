#!/usr/bin/env python3
"""Missed-caller messenger — DRY-RUN only (v1).

Flow (tick):
  1. Optionally sync VOXIA CDR.
  2. Query SQLite for missed-call candidates.
  3. For each: enrich from Postgres, classify open/closed, queue or execute send.
  4. Drain pending_sends where due_at <= now.

All "sends" logged to logs/sent_YYYY-MM-DD.jsonl -- NO real WhatsApp calls.

Commands:
  tick [--dry-run] [--no-sync] [--backtest --date YYYY-MM-DD]
  drain-overnight
  list-pending
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / 'calls.db'
VOXIA_PY = HERE / 'voxia.py'
LOG_DIR = HERE / 'logs'

sys.path.insert(0, str(HERE))
from clinic_hours import classify, next_open_time
from clients_lookup import find_client, build_clinic_block
import settings_store  # templates from calls.db app_settings

DENYLIST: list[str] = ['035513649']
ALWAYS_INCLUDE: list[str] = []
MIN_AGE_MINUTES: int = 5
MAX_AGE_HOURS: int = 6
CALLBACK_WINDOW_MINUTES: int = 5

# ---- Live WhatsApp sending (Green API) ----
DAILY_CAP = 150
MIN_DELAY_BETWEEN_SENDS_SEC = 30
MAX_DELAY_BETWEEN_SENDS_SEC = 90
_last_send_at = {"t": 0.0}  # in-process memory


def wa_send(phone: str, message: str) -> dict:
    """Send a WhatsApp message via Green API. Returns {ok, message_id|error}."""
    import time, random, requests
    import os
    instance = os.environ.get("CLINIC_WHATSAPP_INSTANCE")
    token = os.environ.get("CLINIC_WHATSAPP_TOKEN")
    if not instance or not token:
        return {"ok": False, "error": "missing CLINIC_WHATSAPP creds"}

    # rate limit — random delay 30-90s between sends (anti-block)
    elapsed = time.time() - _last_send_at["t"]
    if elapsed < MIN_DELAY_BETWEEN_SENDS_SEC:
        wait = MIN_DELAY_BETWEEN_SENDS_SEC - elapsed + random.uniform(0, MAX_DELAY_BETWEEN_SENDS_SEC - MIN_DELAY_BETWEEN_SENDS_SEC)
        time.sleep(wait)

    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith("0"):
        digits = "972" + digits[1:]
    chat_id = f"{digits}@c.us"
    url = f"https://api.green-api.com/waInstance{instance}/sendMessage/{token}"
    try:
        r = requests.post(url, json={"chatId": chat_id, "message": message}, timeout=15)
        _last_send_at["t"] = time.time()
        if r.status_code == 200:
            return {"ok": True, "message_id": r.json().get("idMessage", "")}
        return {"ok": False, "error": f"{r.status_code}: {r.text[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def daily_cap_reached(conn) -> bool:
    """Return True if today's cap is reached."""
    today = datetime.now().strftime("%Y-%m-%d")
    cur = conn.execute("SELECT COALESCE(SUM(count), 0) FROM daily_send_counter WHERE date = ?", (today,))
    used = cur.fetchone()[0] or 0
    return used >= DAILY_CAP

EXTERNAL_PHONE_RE = r'^0\\d{8,10}$'

def _tmpl_warm_open() -> str:
    return settings_store.get_setting(
        'template_warm_open',
        'היי! ראיתי שהתקשרת 🐾 פספסנו אותך. איך אפשר לעזור? (שעות פעילות א-ה 10:00-20:00, ו׳ 9:00-14:00)'
    )


def _tmpl_overnight_long() -> str:
    return settings_store.get_setting(
        'template_overnight_long',
        'תודה על פנייתך. איננו זמינים כעת, אך נשיב לך ברגע שנוכל.\n\nהמרכז הווטרינרי פט קייר סגור כרגע.\nשעות הפעילות: א-ה 10:00-20:00, ו׳ 9:00-14:00.\n\nבמקרי חירום בלבד ניתן לשלוח הודעה ל-0543123419.\n\nניתן גם להתקשר למרכזי חירום שפועלים 24 שעות:\n• בית החולים הווטרינרי מורשת, רחובות — 08-9390738\n• בית החולים טיפול נמרץ בן שמן — 086280200\n• בית החולים הווטרינרי בית דגן — 03-9688533\n• בית החולים הווטרינרי חוות דעת, כפר סבא — 09-7431117\n• בית החולים הווטרינרי ראש העין — 09-9668133'
    )


def _tmpl_overnight_morning() -> str:
    return settings_store.get_setting(
        'template_overnight_morning',
        'היי! התקשרת אתמול בערב, פספסנו אותך 🐾 אתה מוזמן לשלוח הודעה או להתקשר אחרי השעה 10.'
    )


TMPL_WARM_OPEN = _tmpl_warm_open()
TMPL_OVERNIGHT_LONG = _tmpl_overnight_long()
TMPL_OVERNIGHT_WARM = _tmpl_overnight_morning()
TMPL_CLINIC_INTERNAL = '📞 שיחה שפספסנו\nמספר: {from_num}\nשעה: {ts}\n{client_info_block}'




def _regexp(pattern: str, value: str | None) -> int:
    if value is None:
        return 0
    return 1 if re.fullmatch(pattern, value) else 0


def open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.create_function("REGEXP", 2, _regexp)
    return conn


def init_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS missed_processed (
            uniqueid     TEXT PRIMARY KEY,
            from_num     TEXT NOT NULL,
            call_ts      TEXT NOT NULL,
            processed_at TEXT NOT NULL,
            mode         TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_send_counter (
            from_num TEXT NOT NULL,
            date     TEXT NOT NULL,
            count    INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (from_num, date)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS pending_sends (
            uniqueid  TEXT PRIMARY KEY,
            from_num  TEXT NOT NULL,
            call_ts   TEXT NOT NULL,
            due_at    TEXT NOT NULL,
            template  TEXT NOT NULL,
            queued_at TEXT NOT NULL,
            sent_at   TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mp_from_date ON missed_processed(from_num, call_ts)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ps_due ON pending_sends(due_at)")
    conn.commit()


def _build_candidates_sql(now_str: str) -> tuple[str, list]:
    dl_ph = ",".join("?" * len(DENYLIST)) if DENYLIST else "''"
    num_clause = "from_num REGEXP ?"
    num_params = [EXTERNAL_PHONE_RE]
    denylist_in = f"({dl_ph})" if DENYLIST else "("")"
    sql = f"""
        SELECT
            uniqueid,
            ts,
            from_num,
            caller_id,
            CAST((julianday(?) - julianday(ts)) * 1440 AS INTEGER) AS age_minutes
        FROM call_summary
        WHERE status != 'Answered'
          AND ts >= datetime(?, '-{MAX_AGE_HOURS} hours')
          AND ts <= datetime(?, '-{MIN_AGE_MINUTES} minutes')
          AND {num_clause}
          AND from_num NOT IN {denylist_in}
          AND uniqueid NOT IN (SELECT uniqueid FROM missed_processed)
          AND uniqueid NOT IN (SELECT uniqueid FROM pending_sends WHERE sent_at IS NULL)
          AND NOT EXISTS (
              -- if ANY later call answered → skip (customer got through)
              SELECT 1 FROM call_summary c2
              WHERE c2.from_num = call_summary.from_num
                AND c2.status = 'Answered'
                AND c2.ts > call_summary.ts
                AND c2.ts <= datetime(call_summary.ts, '+{CALLBACK_WINDOW_MINUTES} minutes')
          )
          AND NOT EXISTS (
              -- if a NEWER missed call exists → wait for it (restart 5-min timer)
              SELECT 1 FROM call_summary c3
              WHERE c3.from_num = call_summary.from_num
                AND c3.ts > call_summary.ts
          )
          AND NOT EXISTS (
              SELECT 1 FROM daily_send_counter
              WHERE from_num = call_summary.from_num
                AND date = date('now', 'localtime')
          )
        ORDER BY ts
    """
    params = [now_str, now_str, now_str] + num_params + list(DENYLIST)
    return sql, params


def log_send(record: dict, log_date: str) -> None:
    """Append a record to the daily JSONL log."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"sent_{log_date}.jsonl"
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")


def execute_send(
    conn: sqlite3.Connection,
    uniqueid: str,
    from_num: str,
    call_ts: str,
    template: str,
    now_dt: datetime,
    mode: str,
) -> None:
    """Dry-run: build the message texts, log to JSONL, mark as sent."""
    call_dt = datetime.strptime(call_ts, "%Y-%m-%d %H:%M:%S")
    client = find_client(from_num)
    client_block = build_clinic_block(client, from_num)

    if template == "warm_open":
        to_customer_text = TMPL_WARM_OPEN
    else:
        to_customer_text = TMPL_OVERNIGHT_LONG + "\n\n---\n\n" + TMPL_OVERNIGHT_WARM

    to_clinic_text = TMPL_CLINIC_INTERNAL.format(
        from_num=from_num,
        ts=call_ts,
        client_info_block=client_block,
    )

    log_date = now_dt.strftime("%Y-%m-%d")
    processed_at = now_dt.isoformat()
    call_date = call_dt.strftime("%Y-%m-%d")

    record = {
        "uniqueid": uniqueid,
        "from_num": from_num,
        "call_ts": call_ts,
        "template": template,
        "mode": mode,
        "processed_at": processed_at,
        "to_customer": to_customer_text,
        "to_clinic": to_clinic_text,
        "client_name": (
            ((client.get("first_name", "") or "") + " " + (client.get("last_name", "") or "")).strip()
            if client else None
        ),
        "client_pets": client.get("pets_list") if client else None,
        "client_last_visit": str(client.get("last_visit")) if client and client.get("last_visit") else None,
    }
    # LIVE: actually send via Green API
    send_status = "dry-run"
    send_error = None
    if mode == "live":
        if daily_cap_reached(conn):
            record["skipped"] = "daily_cap_reached"
            send_status = "skipped-cap"
        else:
            res = wa_send(from_num, to_customer_text)
            if res.get("ok"):
                send_status = "sent"
                record["message_id"] = res.get("message_id")
            else:
                send_status = "error"
                send_error = res.get("error")
                record["error"] = send_error
    record["status"] = send_status
    log_send(record, log_date)

    conn.execute(
        "INSERT OR IGNORE INTO missed_processed (uniqueid, from_num, call_ts, processed_at, mode) VALUES (?, ?, ?, ?, ?)",
        (uniqueid, from_num, call_ts, processed_at, "dry-run"),
    )
    conn.execute(
        "INSERT INTO daily_send_counter (from_num, date, count) VALUES (?, ?, 1)"
        " ON CONFLICT(from_num, date) DO UPDATE SET count = count + 1",
        (from_num, datetime.now().strftime('%Y-%m-%d')),
    )
    if mode == "drain":
        conn.execute(
            "UPDATE pending_sends SET sent_at = ? WHERE uniqueid = ?",
            (processed_at, uniqueid),
        )
    conn.commit()
    print(f"  [DRY-RUN] logged send: {from_num} → {template} ({call_ts})")


def cmd_tick(args: argparse.Namespace) -> None:
    # Refresh templates from DB on each tick
    global TMPL_WARM_OPEN, TMPL_OVERNIGHT_LONG, TMPL_OVERNIGHT_WARM
    TMPL_WARM_OPEN = _tmpl_warm_open()
    TMPL_OVERNIGHT_LONG = _tmpl_overnight_long()
    TMPL_OVERNIGHT_WARM = _tmpl_overnight_morning()
    print(f"[DEBUG] template_warm_open from DB: {TMPL_WARM_OPEN[:60]}")

    mode = "dry-run" if args.dry_run else "live"

    if not args.no_sync:
        print("Syncing VOXIA...")
        sync_args = [sys.executable, str(VOXIA_PY), "sync", "--days", "1"]
        if args.backtest and args.date:
            sync_args += ["--date", args.date]
        subprocess.run(sync_args)
    else:
        print("--no-sync: skipping VOXIA sync")

    if args.backtest and args.date:
        now_dt = datetime.strptime(args.date, "%Y-%m-%d").replace(hour=23, minute=59, second=1)
        print(f"Backtest mode — now = {now_dt}")
    else:
        now_dt = datetime.now()

    now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
    conn = open_db()
    init_tables(conn)

    sql, params = _build_candidates_sql(now_str)
    rows = conn.execute(sql, params).fetchall()
    print(f"Found {len(rows)} missed-call candidates")

    queued = 0
    sent_now = 0
    for row in rows:
        uniqueid, ts, from_num, caller_id, age_minutes = row
        call_dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
        call_status = classify(call_dt)

        if call_status == "open":
            template = "warm_open"
            due_at = now_dt
        else:
            template = "overnight_combined"
            nxt = next_open_time(call_dt)
            due_at = max(nxt, now_dt)

        due_str = due_at.strftime("%Y-%m-%d %H:%M:%S")
        queued_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")

        print(f"  call_status={call_status}")
        print(f"  template={template}")
        print(f"  due={due_str}")

        if due_at <= now_dt:
            execute_send(conn, uniqueid, from_num, ts, template, now_dt, mode)
            sent_now += 1
        else:
            conn.execute(
                "INSERT OR IGNORE INTO pending_sends (uniqueid, from_num, call_ts, due_at, template, queued_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (uniqueid, from_num, ts, due_str, template, queued_str),
            )
            conn.commit()
            print(f"    → queued for {due_str}")
            queued += 1

    pending = conn.execute(
        "SELECT uniqueid, from_num, call_ts, template FROM pending_sends WHERE due_at <= ? AND sent_at IS NULL",
        (now_str,),
    ).fetchall()
    print(f"\nDraining {len(pending)} pending sends due now...")
    for uniqueid, from_num, call_ts, template in pending:
        execute_send(conn, uniqueid, from_num, call_ts, template, now_dt, "drain")
        sent_now += 1

    conn.close()
    print(f"\nDone — {sent_now} sent (dry-run), {queued} queued for later")


def cmd_drain_overnight(args: argparse.Namespace) -> None:
    now_dt = datetime.now()
    now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
    conn = open_db()
    init_tables(conn)
    pending = conn.execute(
        "SELECT uniqueid, from_num, call_ts, template FROM pending_sends WHERE due_at <= ? AND sent_at IS NULL",
        (now_str,),
    ).fetchall()
    print(f"Draining {len(pending)} overnight sends...")
    for uniqueid, from_num, call_ts, template in pending:
        execute_send(conn, uniqueid, from_num, call_ts, template, now_dt, "drain")
    conn.close()
    print("Drain done.")


def cmd_list_pending(args: argparse.Namespace) -> None:
    conn = open_db()
    init_tables(conn)
    rows = conn.execute(
        "SELECT uniqueid, from_num, call_ts, due_at, template, queued_at, sent_at FROM pending_sends ORDER BY due_at"
    ).fetchall()
    print("-" * 130)
    for r in rows:
        print(r[0], r[1], r[2], r[3], r[4], r[6] or "(pending)")
    print(f"{len(rows)} rows")
    conn.close()


def main() -> None:
    p = argparse.ArgumentParser(prog="messenger", description=__doc__)
    sub = p.add_subparsers(dest="cmd")

    tk = sub.add_parser("tick", help="scan + send/queue")
    tk.add_argument("--dry-run", action="store_true")
    tk.add_argument("--no-sync", action="store_true")
    tk.add_argument("--backtest", action="store_true")
    tk.add_argument("--date", metavar="YYYY-MM-DD (for backtest)")

    dr = sub.add_parser("drain-overnight", help="drain pending overnight sends")
    dr.add_argument("--live", dest="dry_run", action="store_false")
    dr.set_defaults(dry_run=True)
    sub.add_parser("list-pending", help="list pending_sends table")

    args = p.parse_args()
    handlers = {
        "tick": cmd_tick,
        "drain-overnight": cmd_drain_overnight,
        "list-pending": cmd_list_pending,
    }
    if args.cmd in handlers:
        handlers[args.cmd](args)
    else:
        p.print_help()


if __name__ == "__main__":
    main()
