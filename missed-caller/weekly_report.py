#!/usr/bin/env python3
"""Weekly missed-calls report — sent every Sunday 07:00 via Gmail Apps Script.

Aggregates last 7 days:
  - Headline counts: total incoming, missed, truly lost
  - Table: day × missed/answered counts
  - Top 10 missed numbers with client names from Postgres
  - Sends to both: vet_batyam@yahoo.com AND vetrinarbatyam@gmail.com
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "calls.db"
load_dotenv(HERE / ".env")

sys.path.insert(0, str(HERE))
from clients_lookup import find_client
import settings_store  # reads report settings from calls.db

GMAIL_URL = os.environ.get("GMAIL_API_URL", "")
GMAIL_TOKEN = os.environ.get("GMAIL_API_TOKEN", "")
_FALLBACK_RECIPIENTS = "vet_batyam@yahoo.com,vetrinarbatyam@gmail.com"
TO_EMAILS = settings_store.get_setting("report_recipients", _FALLBACK_RECIPIENTS)


def _get_db():
    conn = sqlite3.connect(DB_PATH)
    return conn


def _missed_stats(conn, since: str) -> tuple[int, int]:
    """Returns (answered, missed) since date string."""
    row = conn.execute("""
        SELECT
          SUM(CASE WHEN status='Answered' THEN 1 ELSE 0 END),
          SUM(CASE WHEN status!='Answered' THEN 1 ELSE 0 END)
        FROM call_summary WHERE ts >= ?
    """, (since + " 00:00:00",)).fetchone()
    return (row[0] or 0), (row[1] or 0)


def _truly_lost(conn, since: str) -> int:
    row = conn.execute("""
        WITH m AS (
          SELECT uniqueid, ts, from_num
          FROM call_summary WHERE status != 'Answered' AND ts >= ?
        )
        SELECT COUNT(*) FROM m
        WHERE NOT EXISTS (
          SELECT 1 FROM call_summary c
          WHERE c.from_num = m.from_num
            AND c.ts > m.ts
            AND c.ts <= datetime(m.ts, '+60 minutes')
        )
    """, (since + " 00:00:00",)).fetchone()
    return row[0] or 0


def _day_breakdown(conn, since: str) -> list[dict]:
    rows = conn.execute("""
        SELECT date(ts) d,
               SUM(CASE WHEN status='Answered' THEN 1 ELSE 0 END) answered,
               SUM(CASE WHEN status!='Answered' THEN 1 ELSE 0 END) missed
        FROM call_summary WHERE ts >= ?
        GROUP BY d ORDER BY d
    """, (since + " 00:00:00",)).fetchall()
    return [{"date": r[0], "answered": r[1], "missed": r[2]} for r in rows]


def _top_missed(conn, since: str, limit: int = 10) -> list[tuple[str, int]]:
    rows = conn.execute("""
        SELECT from_num, COUNT(*) c FROM call_summary
        WHERE status != 'Answered' AND ts >= ?
        GROUP BY from_num ORDER BY c DESC LIMIT ?
    """, (since + " 00:00:00", limit)).fetchall()
    return [(r[0], r[1]) for r in rows]


def build_html(since_date: date) -> str:
    conn = _get_db()
    since = since_date.isoformat()
    today = date.today()

    answered, missed = _missed_stats(conn, since)
    total = answered + missed
    lost = _truly_lost(conn, since)
    days = _day_breakdown(conn, since)
    top_missed = _top_missed(conn, since)

    # Enrich top missed with client names
    enriched = []
    for num, count in top_missed:
        client = find_client(num)
        if client:
            name = f"{client.get('first_name', '')} {client.get('last_name', '')}".strip()
        else:
            name = "לא מזוהה"
        enriched.append((num, count, name))

    # Build day table rows
    day_rows_html = ""
    for d in days:
        day_rows_html += f"""
        <tr>
          <td style="padding:6px 12px;border:1px solid #ddd;">{d['date']}</td>
          <td style="padding:6px 12px;border:1px solid #ddd;text-align:center;">{d['answered']}</td>
          <td style="padding:6px 12px;border:1px solid #ddd;text-align:center;color:#c0392b;font-weight:bold;">{d['missed']}</td>
        </tr>"""

    # Build top missed rows
    missed_rows_html = ""
    for num, count, name in enriched:
        missed_rows_html += f"""
        <tr>
          <td style="padding:6px 12px;border:1px solid #ddd;direction:ltr;">{num}</td>
          <td style="padding:6px 12px;border:1px solid #ddd;text-align:center;">{count}</td>
          <td style="padding:6px 12px;border:1px solid #ddd;">{name}</td>
        </tr>"""

    date_range = f"{since_date.strftime('%d/%m/%Y')}–{today.strftime('%d/%m/%Y')}"

    html = f"""<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><title>סיכום שיחות שבועי</title></head>
<body style="font-family:Arial,sans-serif;direction:rtl;max-width:700px;margin:20px auto;color:#222;">
  <h2 style="color:#2c3e50;">📞 סיכום שיחות שבועי — ווטרינר בת-ים</h2>
  <p style="color:#666;">{date_range}</p>

  <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin:16px 0;display:flex;gap:24px;">
    <div style="text-align:center;">
      <div style="font-size:2em;font-weight:bold;color:#2980b9;">{total}</div>
      <div style="color:#666;">שיחות נכנסות</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:2em;font-weight:bold;color:#e67e22;">{missed}</div>
      <div style="color:#666;">לא נענו</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:2em;font-weight:bold;color:#c0392b;">{lost}</div>
      <div style="color:#666;">אבודות באמת</div>
    </div>
  </div>

  <h3>פירוט יומי</h3>
  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
    <thead>
      <tr style="background:#2c3e50;color:white;">
        <th style="padding:8px 12px;text-align:right;">תאריך</th>
        <th style="padding:8px 12px;">נענו</th>
        <th style="padding:8px 12px;">לא נענו</th>
      </tr>
    </thead>
    <tbody>{day_rows_html}</tbody>
  </table>

  <h3>Top 10 מספרים שהוחמצו</h3>
  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
    <thead>
      <tr style="background:#2c3e50;color:white;">
        <th style="padding:8px 12px;text-align:right;">מספר</th>
        <th style="padding:8px 12px;">פעמים</th>
        <th style="padding:8px 12px;text-align:right;">לקוח</th>
      </tr>
    </thead>
    <tbody>{missed_rows_html}</tbody>
  </table>

  <p style="color:#999;font-size:0.85em;margin-top:32px;">
    נשלח אוטומטית ע"י missed-caller agent — Pet Care Veterinary Clinic
  </p>
</body>
</html>"""

    conn.close()
    return html


def send_report() -> None:
    # Check if report is enabled
    if settings_store.get_setting("report_enabled", "true").lower() not in ("true", "1", "yes"):
        print("[weekly_report] report_enabled=false, skipping.")
        return
    # Refresh recipients from DB
    global TO_EMAILS
    TO_EMAILS = settings_store.get_setting("report_recipients", _FALLBACK_RECIPIENTS)
    today = date.today()
    since = today - timedelta(days=7)
    date_range = f"{since.strftime('%d/%m/%Y')}–{today.strftime('%d/%m/%Y')}"
    subject = f"סיכום שיחות שבועי — ווטרינר בת-ים — {date_range}"
    html = build_html(since)

    if not GMAIL_URL or not GMAIL_TOKEN:
        print("[weekly_report] GMAIL_API_URL or GMAIL_API_TOKEN not set", file=sys.stderr)
        sys.exit(1)

    payload = {
        "action": "send",
        "token": GMAIL_TOKEN,
        "to": TO_EMAILS,
        "subject": subject,
        "html": html,
    }
    r = requests.post(GMAIL_URL, json=payload, timeout=30)
    if r.ok:
        print(f"Report sent to {TO_EMAILS} — subject: {subject}")
    else:
        print(f"Failed to send report: {r.status_code} {r.text[:200]}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    send_report()
