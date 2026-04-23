#!/usr/bin/env python3
"""settings_store.py — Shared settings backed by calls.db app_settings table.

API:
  get_setting(key, default='') -> str
  set_setting(key, value) -> None
  get_all_settings() -> dict[str, str]
  seed_defaults() -> None   # idempotent, called on import
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "calls.db"

# ── Template defaults (from messenger.py hardcoded values) ──────────────────
_TEMPLATE_WARM_OPEN = (
    "היי! ראיתי שהתקשרת 🐾 פספסנו אותך. "
    "איך אפשר לעזור? (שעות פעילות א-ה 10:00-20:00, ו׳ 9:00-14:00)"
)

_TEMPLATE_OVERNIGHT_LONG = """תודה על פנייתך. איננו זמינים כעת, אך נשיב לך ברגע שנוכל.

המרכז הווטרינרי פט קייר סגור כרגע.
שעות הפעילות: א-ה 10:00-20:00, ו׳ 9:00-14:00.

במקרי חירום בלבד ניתן לשלוח הודעה ל-0543123419.

ניתן גם להתקשר למרכזי חירום שפועלים 24 שעות:
• בית החולים הווטרינרי מורשת, רחובות — 08-9390738
• בית החולים טיפול נמרץ בן שמן — 086280200
• בית החולים הווטרינרי בית דגן — 03-9688533
• בית החולים הווטרינרי חוות דעת, כפר סבא — 09-7431117
• בית החולים הווטרינרי ראש העין — 09-9668133"""

_TEMPLATE_OVERNIGHT_MORNING = (
    "היי! התקשרת אתמול בערב, פספסנו אותך 🐾 "
    "אתה מוזמן לשלוח הודעה או להתקשר אחרי השעה 10."
)

_DEFAULTS: dict[str, str] = {
    "report_recipients": "vet_batyam@yahoo.com, vetrinarbatyam@gmail.com",
    "report_day_of_week": "0",
    "report_hour": "7",
    "count_voicemail_as_missed": "false",
    "voicemail_threshold_sec": "49",
    "report_enabled": "true",
    "template_warm_open": _TEMPLATE_WARM_OPEN,
    "template_overnight_long": _TEMPLATE_OVERNIGHT_LONG,
    "template_overnight_morning": _TEMPLATE_OVERNIGHT_MORNING,
}


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()


def seed_defaults() -> None:
    """Insert defaults for any missing keys — never overwrites existing values."""
    with _conn() as conn:
        _ensure_table(conn)
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        for key, value in _DEFAULTS.items():
            conn.execute(
                "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
                (key, value, now),
            )
        conn.commit()


def get_setting(key: str, default: str = "") -> str:
    try:
        with _conn() as conn:
            _ensure_table(conn)
            row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else default
    except Exception:
        return default


def set_setting(key: str, value: str) -> None:
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as conn:
        _ensure_table(conn)
        conn.execute(
            """INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
            (key, value, now),
        )
        conn.commit()


def get_all_settings() -> dict[str, str]:
    try:
        with _conn() as conn:
            _ensure_table(conn)
            rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
            return {r["key"]: r["value"] for r in rows}
    except Exception:
        return {}


# Seed on import — idempotent
seed_defaults()
