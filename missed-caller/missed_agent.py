#!/usr/bin/env python3
"""Missed-call detector for the veterinary clinic's PBX (Bicom/VOXIA).

Reads the local SQLite DB populated by voxia.py, identifies true missed
customer calls (unanswered, external Israeli mobile/landline, not yet
notified), and dry-runs the WhatsApp message that WOULD be sent.

No WhatsApp is sent yet — this is detection + JSONL logging only.

Commands:
  scan [--dry-run] [--no-sync] [--backtest --date YYYY-MM-DD]
                                  detect missed calls and log them
  list [--date YYYY-MM-DD]        show already-processed rows for a date
  reset [--date YYYY-MM-DD]       delete processed rows for a date (re-test)
  stats                           count detections per day (last 7 days)
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Force UTF-8 on Windows terminal
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# ── Config constants (edit here without touching logic) ─────────────────────
DENYLIST: list[str] = ["035513649"]       # specific from_num to skip (main trunk)
ALWAYS_INCLUDE: list[str] = []            # test numbers to always include
MIN_AGE_MINUTES: int = 3                  # grace period — how old the miss must be
MAX_AGE_HOURS: int = 6                    # don't reach out to stale calls
CALLBACK_WINDOW_MINUTES: int = 30         # if customer called back + answered, skip
LOG_DIR: Path = Path(__file__).resolve().parent / "logs"

# ── Paths ────────────────────────────────────────────────────────────────────
HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "calls.db"
VOXIA_PY = HERE / "voxia.py"

# ── Regex for external Israeli phones (mobile 05x or landline 0x) ───────────
EXTERNAL_PHONE_RE = r"^0\d{8,10}$"


def _regexp(pattern: str, value: str | None) -> int:
    """SQLite REGEXP function: returns 1 if value fully matches pattern."""
    if value is None:
        return 0
    return 1 if re.fullmatch(pattern, value) else 0


def open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.create_function("REGEXP", 2, _regexp)
    return conn


def init_agent_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS missed_processed (
            uniqueid     TEXT PRIMARY KEY,
            from_num     TEXT NOT NULL,
            call_ts      TEXT NOT NULL,
            processed_at TEXT NOT NULL,
            mode         TEXT NOT NULL   -- 'dry-run' | 'backtest' | 'live'
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_send_counter (
            from_num TEXT NOT NULL,
            date     TEXT NOT NULL,      -- YYYY-MM-DD
            count    INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (from_num, date)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mp_from_date ON missed_processed(from_num, call_ts)")
    conn.commit()


# ── helpers ──────────────────────────────────────────────────────────────────

def _denylist_placeholders() -> tuple[str, list[str]]:
    """Return (SQL IN-clause, params list) for DENYLIST."""
    if not DENYLIST:
        return "('')", []
    ph = ",".join("?" * len(DENYLIST))
    return f"({ph})", list(DENYLIST)


def _build_candidates_sql(now_str: str, denylist_params: list[str]) -> tuple[str, list]:
    """Build the SELECT query for missed-call candidates.

    Returns (sql, params).  The ALWAYS_INCLUDE list bypasses regex/denylist
    but still respects processed/daily-counter/callback-window.
    """
    dl_ph = ",".join("?" * len(DENYLIST)) if DENYLIST else "''"
    ai_ph = ",".join("?" * len(ALWAYS_INCLUDE)) if ALWAYS_INCLUDE else "''"

    # Build WHERE clause for from_num:
    #   (matches external regex OR is in ALWAYS_INCLUDE) AND NOT in DENYLIST
    if ALWAYS_INCLUDE:
        num_clause = f"(from_num REGEXP ? OR from_num IN ({ai_ph}))"
        num_params = [EXTERNAL_PHONE_RE] + list(ALWAYS_INCLUDE)
    else:
        num_clause = "from_num REGEXP ?"
        num_params = [EXTERNAL_PHONE_RE]

    denylist_in = f"({dl_ph})" if DENYLIST else "('')"

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
          AND NOT EXISTS (
              SELECT 1 FROM call_summary c2
              WHERE c2.from_num = call_summary.from_num
                AND c2.status = 'Answered'
                AND c2.ts > call_summary.ts
                AND c2.ts <= datetime(call_summary.ts, '+{CALLBACK_WINDOW_MINUTES} minutes')
          )
          AND NOT EXISTS (
              SELECT 1 FROM daily_send_counter
              WHERE from_num = call_summary.from_num
                AND date = date(call_summary.ts)
          )
        ORDER BY ts
    """
    # params order: age_minutes now_str, window start now_str, grace now_str,
    #               num_params, denylist_params
    params = [now_str, now_str, now_str] + num_params + denylist_params
    return sql, params


# ── commands ─────────────────────────────────────────────────────────────────

def cmd_scan(args) -> None:
    # 1. optional sync
    if not args.no_sync:
        print("🔄 מסנכרן שיחות...")
        result = subprocess.run(
            [sys.executable, str(VOXIA_PY), "sync", "--days", "1"],
            capture_output=False,
        )
        if result.returncode != 0:
            print("⚠️  sync נכשל — ממשיך עם DB קיים", file=sys.stderr)
    else:
        print("⏭  --no-sync: מדלג על סנכרון")

    # 2. determine "now"
    if args.backtest and args.date:
        now_dt = datetime.strptime(args.date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        mode = "backtest"
        print(f"🕰  backtest mode — now = {now_dt}")
    else:
        now_dt = datetime.now()
        mode = "dry-run"

    now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
    log_date = now_dt.strftime("%Y-%m-%d")

    # 3. connect + init tables
    conn = open_db()
    init_agent_tables(conn)

    # 4. build + run query
    dl_params = list(DENYLIST) if DENYLIST else []
    sql, params = _build_candidates_sql(now_str, dl_params)
    rows = conn.execute(sql, params).fetchall()

    # 5. process each candidate
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"missed_{log_date}.jsonl"
    processed_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print()
    print(f"{'שעה':20s}  {'מספר':14s}  {'caller_id':20s}  {'גיל (דק׳)':>10s}")
    print("-" * 72)

    inserted = 0
    for uniqueid, ts, from_num, caller_id, age_minutes in rows:
        record = {
            "uniqueid": uniqueid,
            "from_num": from_num,
            "ts": ts,
            "caller_id": caller_id or "",
            "age_minutes": age_minutes,
            "mode": mode,
            "processed_at": processed_at,
            "would_send_wa": f"שלום! התקשרת אלינו למרפאה וטרינרית בת-ים ולא הספקנו לענות. "
                             f"נשמח לחזור אליך בהקדם! 🐾",
        }

        # append to JSONL
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

        # insert into missed_processed
        conn.execute(
            "INSERT OR IGNORE INTO missed_processed (uniqueid, from_num, call_ts, processed_at, mode) "
            "VALUES (?, ?, ?, ?, ?)",
            (uniqueid, from_num, ts, processed_at, mode),
        )
        # insert / increment daily_send_counter
        call_date = ts[:10]
        conn.execute(
            "INSERT INTO daily_send_counter (from_num, date, count) VALUES (?, ?, 1) "
            "ON CONFLICT(from_num, date) DO UPDATE SET count = count + 1",
            (from_num, call_date),
        )

        print(f"{ts:20s}  {from_num:14s}  {(caller_id or ''):20s}  {age_minutes:>10d}")
        inserted += 1

    conn.commit()
    conn.close()

    print()
    print(f"✅  {inserted} שיחות שהוחמצו זוהו — לוג: {log_path}")
    if inserted == 0:
        print("   (אין שיחות חדשות בחלון הזמן)")


def cmd_list(args) -> None:
    target_date = args.date or date.today().isoformat()
    conn = open_db()
    init_agent_tables(conn)
    rows = conn.execute(
        "SELECT uniqueid, from_num, call_ts, processed_at, mode "
        "FROM missed_processed "
        "WHERE date(call_ts) = ? "
        "ORDER BY call_ts",
        (target_date,),
    ).fetchall()
    conn.close()

    print(f"שיחות שטופלו ב-{target_date}:")
    print(f"{'uniqueid':36s}  {'מספר':14s}  {'שעת שיחה':20s}  {'טופל ב':20s}  mode")
    print("-" * 105)
    for uniqueid, from_num, call_ts, processed_at, mode in rows:
        print(f"{uniqueid:36s}  {from_num:14s}  {call_ts:20s}  {processed_at:20s}  {mode}")
    print(f"\n{len(rows)} שורות")


def cmd_reset(args) -> None:
    target_date = args.date or date.today().isoformat()
    conn = open_db()
    init_agent_tables(conn)
    mp_del = conn.execute(
        "DELETE FROM missed_processed WHERE date(call_ts) = ?", (target_date,)
    ).rowcount
    dsc_del = conn.execute(
        "DELETE FROM daily_send_counter WHERE date = ?", (target_date,)
    ).rowcount
    conn.commit()
    conn.close()
    print(f"🗑  {target_date}: נמחקו {mp_del} שורות מ-missed_processed, {dsc_del} מ-daily_send_counter")


def cmd_stats(args) -> None:
    conn = open_db()
    init_agent_tables(conn)
    today = date.today()
    print(f"{'תאריך':12s}  {'זוהו':>6s}  {'מספרים ייחודיים':>20s}")
    print("-" * 45)
    for i in range(7):
        d = (today - timedelta(days=i)).isoformat()
        row = conn.execute(
            "SELECT COUNT(*), COUNT(DISTINCT from_num) FROM missed_processed WHERE date(call_ts) = ?",
            (d,),
        ).fetchone()
        total, unique = row
        print(f"{d:12s}  {total:>6d}  {unique:>20d}")
    conn.close()


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(
        prog="missed_agent",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    # scan
    sc = sub.add_parser("scan", help="זהה שיחות שהוחמצו ורשום ל-JSONL")
    sc.add_argument("--dry-run", action="store_true", default=True,
                    help="dry-run (ברירת מחדל — אין שליחת WhatsApp)")
    sc.add_argument("--no-sync", action="store_true",
                    help="דלג על voxia.py sync")
    sc.add_argument("--backtest", action="store_true",
                    help="מצב backtest — דרוש --date")
    sc.add_argument("--date", help="YYYY-MM-DD (ל-backtest)")

    # list
    ls = sub.add_parser("list", help="הצג שורות שכבר עובדו")
    ls.add_argument("--date", help="YYYY-MM-DD (ברירת מחדל: היום)")

    # reset
    rs = sub.add_parser("reset", help="מחק שורות של תאריך (לבדיקות חוזרות)")
    rs.add_argument("--date", help="YYYY-MM-DD (ברירת מחדל: היום)")

    # stats
    sub.add_parser("stats", help="ספירות זיהוי ב-7 ימים אחרונים")

    args = p.parse_args()
    handlers = {
        "scan": cmd_scan,
        "list": cmd_list,
        "reset": cmd_reset,
        "stats": cmd_stats,
    }
    handlers[args.cmd](args)


if __name__ == "__main__":
    main()
