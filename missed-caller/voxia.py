#!/usr/bin/env python3
"""VOXIA (Bicom PBXware) CLI — sync call logs into local SQLite, query, export.

Credentials are read from ~/.clinic-secrets/voxia.env (VOXIA_BASE_URL,
VOXIA_EMAIL, VOXIA_PASSWORD, VOXIA_SERVER_ID).

Transport: session-based scraping of the portal's own CSV export endpoint
(account lacks admin rights to create real API keys). The portal returns
UTF-16 LE + BOM, TAB-delimited, 8 columns:
  from_num, to_ext, datetime, total_dur, rating_dur, status, uniqueid, caller_id

Commands:
  login-test                    verify credentials
  sync [--days N] [--date YYYY-MM-DD]
                                download CDR for last N days (default 1),
                                or a specific date, upsert into calls.db
  query [--from] [--to] [--status ST] [--number N] [--limit N]
  stats [--from YYYY-MM-DD] [--to YYYY-MM-DD]
  export [--from] [--to] [--format csv|json] [-o file]
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable

import ssl
import warnings

import requests
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    # truststore may not work on Linux — fall back to verify=False for self-signed VOXIA cert
    pass

# Force UTF-8 on Windows terminal
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# Suppress SSL warnings for VOXIA self-signed cert on Linux
VOXIA_VERIFY_SSL = sys.platform != "linux"
if not VOXIA_VERIFY_SSL:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "calls.db"
ENV_PATH = Path(__file__).resolve().parent / ".env"


def _load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        sys.exit(f"env file not found: {path}")
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    for required in ("VOXIA_BASE_URL", "VOXIA_EMAIL", "VOXIA_PASSWORD", "VOXIA_SERVER_ID"):
        if required not in out:
            sys.exit(f"missing {required} in {path}")
    return out


class Voxia:
    def __init__(self, env: dict[str, str]):
        self.base = env["VOXIA_BASE_URL"].rstrip("/")
        self.email = env["VOXIA_EMAIL"]
        self.password = env["VOXIA_PASSWORD"]
        self.server = env["VOXIA_SERVER_ID"]
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": "voxia-cli/1.0"})
        self._logged_in = False

    def login(self) -> None:
        r = self.s.get(self.base + "/", timeout=15, verify=VOXIA_VERIFY_SSL)
        r.raise_for_status()
        # extract SMSESSID hidden input
        html = r.text
        marker = 'name="SMSESSID" value="'
        i = html.find(marker)
        if i == -1:
            raise RuntimeError("login page missing SMSESSID field")
        j = html.find('"', i + len(marker))
        smsessid = html[i + len(marker):j]

        r = self.s.post(
            self.base + "/",
            data={
                "SMSESSID": smsessid,
                "email": self.email,
                "password": self.password,
                "sm_int_login": "Login",
            },
            allow_redirects=True,
            timeout=15,
            verify=VOXIA_VERIFY_SSL,
        )
        r.raise_for_status()
        if "Authorization required" in r.text or "Welcome to VOXIA" in r.text and "Reports" not in r.text:
            raise RuntimeError("login failed — check credentials")
        self._logged_in = True

    def _ensure_login(self) -> None:
        if not self._logged_in:
            self.login()

    def fetch_cdr_csv(self, day_from: date, day_to: date) -> bytes:
        """POST to the portal's CSV export. Returns raw UTF-16 LE bytes."""
        self._ensure_login()
        # filter format: "YYYY-MM-DD|YYYY-MM-DD|tx|||all||00:00:00|23:59:59|all||empty"
        raw = f"{day_from:%Y-%m-%d}|{day_to:%Y-%m-%d}|tx|||all||00:00:00|23:59:59|all||empty"
        flt = base64.b64encode(raw.encode("ascii")).decode("ascii")
        r = self.s.post(
            self.base + "/",
            data={
                "app": "pbxware",
                "t": "reports",
                "v": "CDR",
                "server": self.server,
                "download_csv": "1",
                "filter": flt,
                "rpage": "1",
            },
            timeout=60,
            verify=VOXIA_VERIFY_SSL,
        )
        r.raise_for_status()
        ct = r.headers.get("content-type", "")
        if "octet-stream" not in ct and "csv" not in ct.lower():
            raise RuntimeError(
                f"unexpected content-type {ct!r} — probably logged out "
                f"(first 120 bytes: {r.content[:120]!r})"
            )
        return r.content


COLUMNS = ("from_num", "to_ext", "datetime_raw", "total_dur",
           "rating_dur", "status", "uniqueid", "caller_id")


def parse_cdr_csv(raw: bytes) -> list[dict[str, str]]:
    """UTF-16 LE + BOM, TAB-delimited, quoted fields, no header row."""
    text = raw.decode("utf-16")
    rows: list[dict[str, str]] = []
    reader = csv.reader(io.StringIO(text), delimiter="\t", quotechar='"')
    for rec in reader:
        if not rec:
            continue
        # pad/truncate defensively
        rec = (rec + [""] * len(COLUMNS))[: len(COLUMNS)]
        rows.append(dict(zip(COLUMNS, (c.strip() for c in rec))))
    return rows


def dur_to_seconds(h: str) -> int:
    """'00:02:37' -> 157. '0' -> 0."""
    h = h.strip()
    if not h or h == "0":
        return 0
    parts = h.split(":")
    if len(parts) == 3:
        try:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except ValueError:
            return 0
    return 0


def parse_voxia_datetime(s: str) -> str:
    """'20 Apr 2026 11:23:34' -> '2026-04-20 11:23:34' (ISO-ish)."""
    try:
        return datetime.strptime(s.strip(), "%d %b %Y %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return s.strip()


def init_db(conn: sqlite3.Connection) -> None:
    # One row per leg. PBXware emits multiple legs per call (same uniqueid,
    # different to_ext). Dedup on exact leg tuple so re-syncs don't duplicate.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uniqueid TEXT NOT NULL,
            from_num TEXT,
            to_ext TEXT,
            ts TEXT,
            total_sec INTEGER,
            rating_sec INTEGER,
            status TEXT,
            caller_id TEXT,
            raw_datetime TEXT,
            UNIQUE(uniqueid, to_ext, status, total_sec)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_calls_ts ON calls(ts)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_calls_from ON calls(from_num)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_calls_uniqueid ON calls(uniqueid)")
    # view that collapses legs → one row per call (Answered wins if any leg answered)
    conn.execute("""
        CREATE VIEW IF NOT EXISTS call_summary AS
        SELECT
            uniqueid,
            MIN(ts) AS ts,
            from_num,
            caller_id,
            MAX(total_sec) AS total_sec,
            CASE WHEN SUM(status='Answered') > 0 THEN 'Answered' ELSE MAX(status) END AS status
        FROM calls
        GROUP BY uniqueid
    """)
    conn.commit()


def upsert(conn: sqlite3.Connection, rows: Iterable[dict[str, str]]) -> int:
    n = 0
    for r in rows:
        if not r.get("uniqueid"):
            continue
        try:
            conn.execute(
                """INSERT OR IGNORE INTO calls
                   (uniqueid, from_num, to_ext, ts, total_sec, rating_sec, status, caller_id, raw_datetime)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    r["uniqueid"],
                    r["from_num"],
                    r["to_ext"],
                    parse_voxia_datetime(r["datetime_raw"]),
                    dur_to_seconds(r["total_dur"]),
                    dur_to_seconds(r["rating_dur"]),
                    r["status"],
                    r["caller_id"],
                    r["datetime_raw"],
                ),
            )
            n += 1
        except sqlite3.IntegrityError:
            pass
    conn.commit()
    return n


# ---------- commands ----------

def cmd_login_test(args, env):
    v = Voxia(env)
    v.login()
    print(f"OK — logged into {v.base} as {v.email}")


def cmd_sync(args, env):
    v = Voxia(env)
    if args.date:
        days = [date.fromisoformat(args.date)]
    else:
        today = date.today()
        days = [today - timedelta(days=i) for i in range(args.days)]
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    total = 0
    for d in days:
        raw = v.fetch_cdr_csv(d, d)
        rows = parse_cdr_csv(raw)
        n = upsert(conn, rows)
        total += n
        print(f"{d}  fetched={len(rows):5d}  upserted={n}")
    conn.close()
    print(f"done — {total} rows. db={DB_PATH}")


def _range_clause(args) -> tuple[str, list]:
    clauses, params = [], []
    if args.from_:
        clauses.append("ts >= ?")
        params.append(args.from_ + " 00:00:00")
    if args.to:
        clauses.append("ts <= ?")
        params.append(args.to + " 23:59:59")
    return (" AND ".join(clauses) if clauses else "1=1"), params


def cmd_query(args, env):
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    where, params = _range_clause(args)
    if args.status:
        where += " AND status = ?"
        params.append(args.status)
    if args.number:
        where += " AND (from_num LIKE ? OR caller_id LIKE ? OR to_ext LIKE ?)"
        params += [f"%{args.number}%"] * 3
    sql = (f"SELECT ts, from_num, to_ext, total_sec, status, caller_id "
           f"FROM calls WHERE {where} ORDER BY ts DESC LIMIT ?")
    params.append(args.limit)
    rows = conn.execute(sql, params).fetchall()
    print(f"{'time':20s} {'from':14s} {'to':22s} {'sec':>5s} {'status':12s} caller_id")
    for r in rows:
        print(f"{r[0]:20s} {r[1]:14s} {(r[2] or ''):22s} {r[3]:>5d} {r[4]:12s} {r[5] or ''}")
    print(f"\n{len(rows)} rows")
    conn.close()


def cmd_stats(args, env):
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    where, params = _range_clause(args)
    cur = conn.execute(f"SELECT COUNT(*), SUM(total_sec), AVG(total_sec) FROM calls WHERE {where}", params)
    total, total_sec, avg_sec = cur.fetchone()
    total_sec = total_sec or 0
    avg_sec = avg_sec or 0
    print(f"range    : {args.from_ or 'ALL'}  →  {args.to or 'ALL'}")
    print(f"total    : {total}")
    print(f"duration : {total_sec//3600:d}h {(total_sec%3600)//60:02d}m  (avg {int(avg_sec)}s)")
    print()
    print("by status:")
    for st, n in conn.execute(
        f"SELECT status, COUNT(*) c FROM calls WHERE {where} GROUP BY status ORDER BY c DESC",
        params,
    ):
        print(f"  {st:20s} {n:6d}")
    print()
    print("top 10 callers:")
    for num, n, sec in conn.execute(
        f"SELECT from_num, COUNT(*) c, SUM(total_sec) s FROM calls WHERE {where} "
        f"GROUP BY from_num ORDER BY c DESC LIMIT 10",
        params,
    ):
        print(f"  {num:14s} {n:5d} calls  {sec or 0:6d} sec")
    print()
    print("busiest hours:")
    for hr, n in conn.execute(
        f"SELECT substr(ts,12,2) h, COUNT(*) c FROM calls WHERE {where} "
        f"GROUP BY h ORDER BY c DESC LIMIT 8",
        params,
    ):
        print(f"  {hr}:00   {n}")
    conn.close()


HEBREW_DOW = ["ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳", "א׳"]  # sqlite strftime('%w'): 0=Sun..6=Sat → reorder via mapping below
DOW_IDX = {"0": "א׳", "1": "ב׳", "2": "ג׳", "3": "ד׳", "4": "ה׳", "5": "ו׳", "6": "ש׳"}


def cmd_report(args, env):
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)

    today = date.today()
    d7 = today - timedelta(days=7)
    d30 = today - timedelta(days=30)
    d90 = today - timedelta(days=90)

    # earliest data point
    first = conn.execute("SELECT MIN(ts), MAX(ts), COUNT(DISTINCT uniqueid) FROM calls").fetchone()
    earliest, latest, unique_calls = first
    total_legs = conn.execute("SELECT COUNT(*) FROM calls").fetchone()[0]

    print("═" * 66)
    print("  📊  דוח שיחות — ווטרינר בת-ים")
    print("═" * 66)
    print(f"  טווח: {earliest}  ←→  {latest}")
    print(f"  שיחות ייחודיות: {unique_calls:,}  |  רגליים: {total_legs:,}")
    print()

    # -------- missed calls by window --------
    def missed_in(since: str) -> tuple[int, int, float]:
        row = conn.execute(
            """SELECT
                 SUM(CASE WHEN status='Answered' THEN 1 ELSE 0 END) a,
                 SUM(CASE WHEN status!='Answered' THEN 1 ELSE 0 END) m,
                 COUNT(*) t
               FROM call_summary WHERE ts >= ?""",
            (since + " 00:00:00",),
        ).fetchone()
        a, m, t = row[0] or 0, row[1] or 0, row[2] or 0
        pct = (m / t * 100) if t else 0
        return a, m, pct

    print("  ⚠️  שיחות שלא ענינו להן")
    print("  " + "-" * 60)
    for label, since in [("היום       ", today), ("7 ימים     ", d7), ("30 ימים    ", d30), ("90 ימים    ", d90)]:
        a, m, pct = missed_in(since.isoformat())
        bar = "█" * int(pct / 2) + "·" * (50 - int(pct / 2))
        print(f"  {label}  {m:4d} מתוך {a+m:5d}  ({pct:5.1f}%)  {bar[:30]}")
    print()

    # -------- truly lost: missed and never called back --------
    print("  💸  שיחות אבודות באמת (לא נענו, ולא חזרו מהמספר אח״כ תוך 60 דק׳)")
    print("  " + "-" * 60)
    # a missed call is "lost" if no later call FROM the same number within 60min
    lost = conn.execute("""
        WITH m AS (
          SELECT uniqueid, ts, from_num
          FROM call_summary WHERE status != 'Answered'
        )
        SELECT
          SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) d7,
          SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) d30,
          COUNT(*) d90
        FROM m
        WHERE NOT EXISTS (
          SELECT 1 FROM call_summary c
          WHERE c.from_num = m.from_num
            AND c.ts > m.ts
            AND c.ts <= datetime(m.ts, '+60 minutes')
        )
    """, (d7.isoformat() + " 00:00:00", d30.isoformat() + " 00:00:00")).fetchone()
    print(f"     7 ימים אחרונים : {lost[0] or 0}")
    print(f"     30 ימים אחרונים: {lost[1] or 0}")
    print(f"     סה״כ בטווח     : {lost[2] or 0}")
    print()

    # -------- repeat callers (same # called 2+ times within 4h, at least one missed) --------
    print("  🔁  מי חזר להתקשר כי לא ענינו לו (2+ שיחות תוך 4 שעות)")
    print("  " + "-" * 60)
    repeat = conn.execute("""
        WITH seqs AS (
          SELECT from_num, ts, status,
                 LAG(ts) OVER (PARTITION BY from_num ORDER BY ts) prev_ts,
                 LAG(status) OVER (PARTITION BY from_num ORDER BY ts) prev_status
          FROM call_summary WHERE ts >= ?
        )
        SELECT from_num, COUNT(*) retries
        FROM seqs
        WHERE prev_ts IS NOT NULL
          AND julianday(ts) - julianday(prev_ts) < 4.0/24
          AND prev_status != 'Answered'
        GROUP BY from_num ORDER BY retries DESC LIMIT 10
    """, (d30.isoformat() + " 00:00:00",)).fetchall()
    if repeat:
        for num, n in repeat:
            print(f"     {num:15s}  ניסה שוב  {n}  פעמים")
    else:
        print("     (אין)")
    print()

    # -------- peak hour × day-of-week heatmap (last 30d) --------
    print("  🕒  עומס לפי שעה × יום בשבוע (30 ימים אחרונים)")
    print("  " + "-" * 60)
    heat = conn.execute("""
        SELECT strftime('%w', ts) dow, CAST(substr(ts,12,2) AS INT) hr, COUNT(*) n
        FROM call_summary WHERE ts >= ?
        GROUP BY dow, hr
    """, (d30.isoformat() + " 00:00:00",)).fetchall()
    grid: dict[tuple[str, int], int] = {}
    for dow, hr, n in heat:
        grid[(dow, hr)] = n
    # print: rows=hour 7..20, cols=day א-ש
    header = "       "
    for dow_num in ("0", "1", "2", "3", "4", "5", "6"):
        header += f"  {DOW_IDX[dow_num]} "
    print(header)
    max_n = max(grid.values()) if grid else 1
    for hr in range(7, 21):
        line = f"   {hr:2d}:00"
        for dow_num in ("0", "1", "2", "3", "4", "5", "6"):
            n = grid.get((dow_num, hr), 0)
            if n == 0:
                cell = "  ·"
            else:
                intensity = min(int(n / max_n * 5), 4)
                cell = "  " + "·░▒▓█"[intensity]
                if n >= 10:
                    cell = f" {n:2d}"
            line += f" {cell}"
        print(line)
    print()

    # -------- busiest weekday over last 30 days --------
    print("  📅  עומס לפי יום בשבוע (30 ימים)")
    print("  " + "-" * 60)
    dow_totals = conn.execute("""
        SELECT strftime('%w', ts) dow, COUNT(*) n
        FROM call_summary WHERE ts >= ?
        GROUP BY dow ORDER BY n DESC
    """, (d30.isoformat() + " 00:00:00",)).fetchall()
    max_dow = max([n for _, n in dow_totals], default=1)
    for dow, n in dow_totals:
        bar = "█" * int(n / max_dow * 40)
        print(f"     {DOW_IDX[dow]}   {n:4d}  {bar}")
    print()

    # -------- call duration distribution (answered only, last 30d) --------
    print("  ⏱️   משך שיחה (שיחות שנענו, 30 ימים)")
    print("  " + "-" * 60)
    durs = conn.execute("""
        SELECT total_sec FROM call_summary
        WHERE status='Answered' AND ts >= ? AND total_sec > 0
        ORDER BY total_sec
    """, (d30.isoformat() + " 00:00:00",)).fetchall()
    ds = [d[0] for d in durs]
    if ds:
        n = len(ds)
        avg = sum(ds) / n
        median = ds[n // 2]
        p95 = ds[int(n * 0.95)]
        longest = ds[-1]
        print(f"     שיחות נמדדו   : {n}")
        print(f"     ממוצע         : {int(avg)//60}:{int(avg)%60:02d} דק׳")
        print(f"     חציון         : {median//60}:{median%60:02d} דק׳")
        print(f"     95%           : {p95//60}:{p95%60:02d} דק׳")
        print(f"     הארוכה ביותר  : {longest//60}:{longest%60:02d} דק׳")
    print()

    # -------- talk time per extension (last 30d) --------
    print("  📞  זמן שיחה פר שלוחה (30 ימים, שיחות שנענו)")
    print("  " + "-" * 60)
    exts = conn.execute("""
        SELECT to_ext, COUNT(*) c, SUM(total_sec) s, AVG(total_sec) a
        FROM calls
        WHERE status='Answered' AND ts >= ? AND total_sec > 0 AND to_ext != ''
        GROUP BY to_ext ORDER BY s DESC LIMIT 15
    """, (d30.isoformat() + " 00:00:00",)).fetchall()
    for ext, c, s, a in exts:
        s = s or 0
        a = a or 0
        print(f"     {ext[:28]:28s}  {c:4d} שיחות  {int(s)//3600:2d}:{(int(s)%3600)//60:02d} שעות  (ממוצע {int(a)}ש׳)")
    print()

    # -------- top missed numbers (who we're losing most, last 30d) --------
    print("  😔  המספרים שהכי הפסדנו (30 ימים)")
    print("  " + "-" * 60)
    missed_top = conn.execute("""
        SELECT from_num, COUNT(*) c FROM call_summary
        WHERE status != 'Answered' AND ts >= ?
        GROUP BY from_num ORDER BY c DESC LIMIT 10
    """, (d30.isoformat() + " 00:00:00",)).fetchall()
    for num, c in missed_top:
        print(f"     {num:15s}  {c:3d} שיחות שלא נענו")
    print()

    # -------- headline / insights --------
    print("═" * 66)
    print("  💡  תובנות")
    print("═" * 66)

    # compute biggest pain point
    a7, m7, p7 = missed_in(d7.isoformat())
    a30, m30, p30 = missed_in(d30.isoformat())
    # worst hour-dow cell
    if grid:
        worst = max(grid.items(), key=lambda kv: kv[1])
        worst_dow, worst_hr = worst[0]
        print(f"  • הפסדת {m7} שיחות ב-7 הימים האחרונים ({p7:.0f}% מהסך)")
        print(f"  • השעה הכי עמוסה ב-30 יום: יום {DOW_IDX[worst_dow]} בשעה {worst_hr}:00 "
              f"({worst[1]} שיחות)")
    if repeat:
        total_retries = sum(n for _, n in repeat)
        print(f"  • {len(repeat)} לקוחות התאמצו וחזרו להתקשר — סה״כ {total_retries} ניסיונות "
              f"(אלה הלקוחות הכי שווים, ולא ענינו להם)")
    lost_30 = lost[1] or 0
    if lost_30:
        print(f"  • {lost_30} שיחות אבודות לחלוטין ב-30 יום (מספר לא חזר בכלל)")
    print()
    conn.close()


def cmd_export(args, env):
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    where, params = _range_clause(args)
    rows = conn.execute(
        f"SELECT uniqueid, ts, from_num, to_ext, total_sec, rating_sec, status, caller_id "
        f"FROM calls WHERE {where} ORDER BY ts",
        params,
    ).fetchall()
    cols = ["uniqueid", "ts", "from_num", "to_ext", "total_sec", "rating_sec", "status", "caller_id"]
    out = sys.stdout if not args.output else open(args.output, "w", encoding="utf-8", newline="")
    try:
        if args.format == "json":
            json.dump([dict(zip(cols, r)) for r in rows], out, ensure_ascii=False, indent=2)
        else:
            w = csv.writer(out)
            w.writerow(cols)
            w.writerows(rows)
    finally:
        if args.output:
            out.close()
    if args.output:
        print(f"wrote {len(rows)} rows to {args.output}", file=sys.stderr)


def main():
    p = argparse.ArgumentParser(prog="voxia", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("login-test", help="verify credentials")

    s = sub.add_parser("sync", help="pull CDR into local DB")
    s.add_argument("--days", type=int, default=1, help="last N days (default 1=today)")
    s.add_argument("--date", help="specific date YYYY-MM-DD")

    q = sub.add_parser("query")
    q.add_argument("--from", dest="from_", help="YYYY-MM-DD")
    q.add_argument("--to")
    q.add_argument("--status", help="Answered / Not Answered / Busy / Failed")
    q.add_argument("--number", help="substring match against from/to/caller_id")
    q.add_argument("--limit", type=int, default=50)

    st = sub.add_parser("stats")
    st.add_argument("--from", dest="from_")
    st.add_argument("--to")

    sub.add_parser("report", help="business-language report with insights")

    e = sub.add_parser("export")
    e.add_argument("--from", dest="from_")
    e.add_argument("--to")
    e.add_argument("--format", choices=("csv", "json"), default="csv")
    e.add_argument("-o", "--output")

    args = p.parse_args()
    env = _load_env(ENV_PATH)

    handlers = {
        "login-test": cmd_login_test,
        "sync": cmd_sync,
        "query": cmd_query,
        "stats": cmd_stats,
        "report": cmd_report,
        "export": cmd_export,
    }
    handlers[args.cmd](args, env)


if __name__ == "__main__":
    main()
