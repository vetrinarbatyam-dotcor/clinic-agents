#!/usr/bin/env python3
"""
Sync ClinicaOnline price catalog -> PostgreSQL catalog_items + price_history.
Self-contained script for Contabo server.
"""
import json, os, sys, time
from datetime import datetime

import psycopg2
import requests
from bs4 import BeautifulSoup

BASE = "https://clinicaonline.co.il"
WBASE = "https://www.clinicaonline.co.il"
LOGIN_URL = BASE + "/Login.aspx"
SELECT_URL = BASE + "/SelectClinic.aspx"
ASMX = WBASE + "/Restricted/dbCalander.asmx"
CLINIC_ID = "53"
USERNAME = "rupi"
PASSWORD = "sahar2306"
JSON_HDR = {"Content-Type": "application/json; charset=utf-8"}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
ASP_FIELDS = ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION",
              "__EVENTTARGET", "__EVENTARGUMENT", "__sc")

DB_PASS = os.environ.get("DB_PASSWORD", "clinicpal2306")


class Clinica:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.ok = False

    def login(self):
        r = self.s.get(LOGIN_URL, timeout=20)
        soup = BeautifulSoup(r.text, "html.parser")
        d = {}
        for f in ASP_FIELDS:
            tag = soup.find(attrs={"name": f})
            if tag:
                d[f] = tag.get("value", "")
        d["ctl00$MainContent$Login1$UserName"] = USERNAME
        d["ctl00$MainContent$Login1$Password"] = PASSWORD
        d["ctl00$MainContent$Login1$LoginButton"] = "login"
        self.s.post(LOGIN_URL, data=d, timeout=30, allow_redirects=True)
        r2 = self.s.get(SELECT_URL, timeout=20)
        soup2 = BeautifulSoup(r2.text, "html.parser")
        d2 = {}
        for f in ASP_FIELDS:
            tag = soup2.find(attrs={"name": f})
            if tag:
                d2[f] = tag.get("value", "")
        d2["ctl00$MainContent$DropDownList1"] = CLINIC_ID
        d2["ctl00$MainContent$Button1"] = "send"
        self.s.post(SELECT_URL, data=d2, timeout=30, allow_redirects=True)
        self.s.get(WBASE + "/vetclinic/managers/admin.aspx", timeout=20)
        self.ok = True
        print("  Logged in to ClinicaOnline")

    def call(self, method, params=None):
        if not self.ok:
            self.login()
        try:
            return self._do(method, params or {})
        except Exception:
            self.login()
            return self._do(method, params or {})

    def _do(self, method, params):
        r = self.s.post(ASMX + "/" + method, json=params, headers=JSON_HDR, timeout=30)
        if "Login.aspx" in r.url:
            self.ok = False
            raise Exception("session expired")
        if r.status_code != 200:
            raise Exception(method + " " + str(r.status_code) + ": " + r.text[:200])
        raw = json.loads(r.text)
        data = raw.get("d", raw) if isinstance(raw, dict) else raw
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                pass
        return data


def main():
    print("=== Price Sync " + datetime.now().strftime("%Y-%m-%d %H:%M") + " ===")

    c = Clinica()

    # 1. Load all tabs
    print("\n[1/3] Loading price lists (tabs 1-7)...")
    items = {}
    for tab in range(1, 8):
        try:
            result = c.call("LoadPriceList", {"TabNumber": tab})
            if result and isinstance(result, list):
                for it in result:
                    fid = str(it.get("FieldID", ""))
                    if fid and fid != "0":
                        items[fid] = {
                            "FieldID": fid,
                            "FieldName": it.get("FieldName", ""),
                            "FieldValue": it.get("FieldValue", "0"),
                            "Type": it.get("Type", 0),
                            "SectionID": it.get("SectionID", 0),
                            "FullPath": it.get("FullPath", ""),
                            "IsInventory": it.get("IsInventory", False),
                            "InventoryAmount": it.get("InventoryAmount", 0),
                            "MinAmount": it.get("MinAmount", 0),
                            "IsStandingOrder": it.get("IsStandingOrder", 0),
                            "Frequency": it.get("Frequency", 0),
                            "Alert": it.get("Alert", 0),
                        }
                print("  Tab " + str(tab) + ": " + str(len(result)) + " items")
        except Exception as e:
            print("  Tab " + str(tab) + ": ERROR - " + str(e))
    print("  Total from tabs: " + str(len(items)))

    # 2. Enrich with names via search
    print("\n[2/3] Enriching with item names...")
    terms = [
        "בדיקה", "חיסון", "ניתוח", "אולטרסאונד", "רנטגן", "סימפריקה", "ברווקטו",
        "נקסגארד", "רויאל", "הילס", "פרו פלאן", "אדוונטיקס", "סרסטו",
        "דם", "שתן", "צילום", "הרדמה", "עיקור", "סירוס", "אשפוז",
        "זריקה", "תרופ", "אנטיביוטיקה", "כלבת", "משושה", "מרובע",
        "ציפורן", "שיניים", "עיניים", "אוזניים", "עור", "מזון",
        "פרעוש", "קרציות", "תולע", "גירוד", "פצע", "תפירה",
        "CBC", "כימיה", "T4", "גלוקוז", "אלרג", "פרוביוטיקה",
        "שמפו", "טיפות", "משחה", "כדור", "אמפולה", "עירוי",
        "cat", "dog", "royal", "hills", "pro plan",
    ]
    new_from_search = 0
    enriched = 0
    for term in terms:
        try:
            results = c.call("SearchPriceItem", {"Barcod": 0, "str": term})
            if results and isinstance(results, list):
                for r in results:
                    fid = str(r.get("FieldID", ""))
                    if not fid or fid == "0":
                        continue
                    if fid in items:
                        if r.get("FieldName"):
                            items[fid]["FieldName"] = r["FieldName"]
                            enriched += 1
                        if r.get("FullPath"):
                            items[fid]["FullPath"] = r["FullPath"]
                        if r.get("SectionID"):
                            items[fid]["SectionID"] = r["SectionID"]
                        if r.get("Type"):
                            items[fid]["Type"] = r["Type"]
                    else:
                        items[fid] = {
                            "FieldID": fid,
                            "FieldName": r.get("FieldName", ""),
                            "FieldValue": r.get("FieldValue", "0"),
                            "Type": r.get("Type", 0),
                            "SectionID": r.get("SectionID", 0),
                            "FullPath": r.get("FullPath", ""),
                            "IsInventory": r.get("IsInventory", False),
                            "InventoryAmount": r.get("InventoryAmount", 0),
                            "MinAmount": r.get("MinAmount", 0),
                            "IsStandingOrder": r.get("IsStandingOrder", 0),
                            "Frequency": r.get("Frequency", 0),
                            "Alert": r.get("Alert", 0),
                        }
                        new_from_search += 1
            time.sleep(0.05)
        except Exception as e:
            print("  Search '" + term + "': " + str(e))
    print("  Enriched " + str(enriched) + " names, found " + str(new_from_search) + " new")
    print("  Total catalog: " + str(len(items)))

    # 3. Sync to DB
    print("\n[3/3] Syncing to PostgreSQL...")
    conn = psycopg2.connect(host="localhost", port=5432, database="clinicpal",
                            user="clinicpal_user", password=DB_PASS)
    cur = conn.cursor()

    cur.execute("SELECT field_id, price FROM catalog_items WHERE field_id IS NOT NULL")
    existing = {r[0]: float(r[1] or 0) for r in cur.fetchall()}

    added = updated = price_changes = 0
    for fid_str, item in items.items():
        fid = int(fid_str)
        name = item.get("FieldName", "")
        ps = str(item.get("FieldValue", "0")).strip()
        try:
            price = float(ps) if ps else 0
        except (ValueError, TypeError):
            price = 0
        fp = item.get("FullPath", "")
        cat = fp.split("/")[0].strip() if fp else ""

        if fid in existing:
            old_price = existing[fid]
            cur.execute(
                "UPDATE catalog_items SET "
                "name=COALESCE(NULLIF(%s,''),name), category=COALESCE(NULLIF(%s,''),category), "
                "price=%s, full_path=COALESCE(NULLIF(%s,''),full_path), "
                "section_id=%s, item_type=%s, is_inventory=%s, inventory_amount=%s, "
                "min_amount=%s, is_standing_order=%s, frequency=%s, alert=%s, updated_at=NOW() "
                "WHERE field_id=%s",
                (name, cat, price, fp, item.get("SectionID", 0), item.get("Type", 0),
                 item.get("IsInventory", False), item.get("InventoryAmount", 0),
                 item.get("MinAmount", 0), item.get("IsStandingOrder", 0),
                 item.get("Frequency", 0), item.get("Alert", 0), fid))
            updated += 1
            if abs(old_price - price) > 0.01 and price > 0:
                cur.execute(
                    "INSERT INTO price_history(field_id,item_name,old_price,new_price,changed_by) "
                    "VALUES(%s,%s,%s,%s,'sync')",
                    (fid, name, old_price, price))
                price_changes += 1
        else:
            cur.execute(
                "INSERT INTO catalog_items "
                "(name,category,price,field_id,full_path,section_id,item_type,"
                "is_inventory,inventory_amount,min_amount,is_standing_order,"
                "frequency,alert,active,updated_at) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,NOW())",
                (name, cat, price, fid, fp, item.get("SectionID", 0), item.get("Type", 0),
                 item.get("IsInventory", False), item.get("InventoryAmount", 0),
                 item.get("MinAmount", 0), item.get("IsStandingOrder", 0),
                 item.get("Frequency", 0), item.get("Alert", 0)))
            added += 1
            if price > 0:
                cur.execute(
                    "INSERT INTO price_history(field_id,item_name,old_price,new_price,changed_by) "
                    "VALUES(%s,%s,NULL,%s,'initial_sync')",
                    (fid, name, price))

    # Backfill visit_items categories
    cur.execute(
        "UPDATE visit_items vi SET category=ci.category "
        "FROM catalog_items ci WHERE vi.field_id=ci.field_id "
        "AND (vi.category IS NULL OR vi.category='') "
        "AND ci.category IS NOT NULL AND ci.category!=''"
    )
    backfilled = cur.rowcount

    conn.commit()
    cur.close()
    conn.close()

    print("  Added: " + str(added))
    print("  Updated: " + str(updated))
    print("  Price changes: " + str(price_changes))
    print("  Visit items backfilled: " + str(backfilled))
    print("\nDone!")


if __name__ == "__main__":
    main()
