#!/usr/bin/env python3
"""Client lookup from Postgres clinicpal DB by phone number.

Usage:
  python clients_lookup.py <phone>   — search and print client info
  from clients_lookup import find_client — programmatic use
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit("psycopg2-binary not installed — run: pip install psycopg2-binary")

from dotenv import load_dotenv
import os

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")


def _get_conn():
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", 5432)),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        connect_timeout=10,
    )


def _normalize_phone(phone: str) -> str:
    """Strip all non-digit characters."""
    return re.sub(r"[^0-9]", "", phone)


def find_client(phone: str) -> dict | None:
    """Look up a client by phone number (any of cell_phone, cell_phone2, phone).

    Returns a dict with display fields or None if not found.
    """
    norm = _normalize_phone(phone)
    if not norm:
        return None

    sql = """
        SELECT user_id, first_name, last_name, cell_phone, cell_phone2, phone,
               pets_list, last_visit, client_debt, num_pets
        FROM clients
        WHERE regexp_replace(
                  COALESCE(cell_phone, '') || ' ' ||
                  COALESCE(cell_phone2, '') || ' ' ||
                  COALESCE(phone, ''),
                  '[^0-9]', '', 'g'
              ) LIKE %s
        ORDER BY last_visit DESC NULLS LAST
        LIMIT 1
    """
    try:
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, (f"%{norm}%",))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            return dict(row)
        return None
    except Exception as e:
        print(f"[clients_lookup] DB error: {e}", file=sys.stderr)
        return None


def format_client(client: dict | None) -> str:
    """Human-readable single-line summary."""
    if not client:
        return "לקוח לא מזוהה במערכת (יכול להיות חדש)"
    name = f"{client.get('first_name') or ''} {client.get('last_name') or ''}".strip()
    pets = client.get('pets_list') or '—'
    last = client.get('last_visit') or '—'
    debt = client.get('client_debt') or 0
    debt_str = f"  | חוב: ₪{debt}" if debt and float(str(debt)) != 0 else ''
    return f"{name} | חיות: {pets} | ביקור אחרון: {last}{debt_str}"


def build_clinic_block(client: dict | None, from_num: str) -> str:
    """Build the clinic internal message block."""
    if not client:
        return "לקוח לא מזוהה במערכת (יכול להיות חדש)"
    name = f"{client.get('first_name') or ''} {client.get('last_name') or ''}".strip()
    pets = client.get('pets_list') or '—'
    last = client.get('last_visit') or '—'
    return f"לקוח: {name}\nחיות: {pets}\nביקור אחרון: {last}"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python clients_lookup.py <phone>")
        sys.exit(1)
    phone = sys.argv[1]
    client = find_client(phone)
    if client:
        name = f"{client.get('first_name') or ''} {client.get('last_name') or ''}".strip()
        print(f"נמצא: {name}")
        print(f"  טלפונים: {client.get('cell_phone')}, {client.get('cell_phone2')}, {client.get('phone')}")
        print(f"  חיות: {client.get('pets_list')}")
        print(f"  ביקור אחרון: {client.get('last_visit')}")
        print(f"  חוב: {client.get('client_debt')}")
        print(f"  מס' חיות: {client.get('num_pets')}")
    else:
        print(f"לא נמצא לקוח עם מספר {phone}")
