"""
build_marpet_csvs.py -- Convert parsed marpet email data (JSON) into 2 CSV files
compatible with the audit scripts' auto-detection (new CSV format).

Usage:
    python build_marpet_csvs.py <input_json> <output_dir> [date_label]

Input JSON structure:
[
  {
    "client_name": "כהן אבי",
    "phone": "0501234567",
    "id_number": "123456789",
    "animal_name": "רקסי",
    "visit_date": "17/03/2026",
    "event_type": "אירוע חדש",
    "exclusion": "",
    "items": [
      {"name": "חיסון כלבת", "quantity": 1, "copay": 0},
      {"name": "בדיקה רפואית (ביקור רופא)", "quantity": 1, "copay": 0}
    ]
  },
  ...
]

Output:
  - marpet_vaccines_{date}.csv  (columns: שם לקוח, שם החיה, תאריך, פריט במחירון)
  - marpet_treatments_{date}.csv (columns: שם לקוח, שם החיה, תאריך, פריט לתביעה)
"""

import sys
import io
import os
import json
import csv
import re
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Vaccine keywords — items matching these go to vaccines CSV
VACCINE_KEYWORDS = [
    'חיסון כלבת', 'חיסון משושה', 'חיסון מתומן', 'חיסון מרובע',
    'תולעת הפארק', 'תילוע', 'כלבת', 'משושה', 'מתומן', 'מרובע',
    'dp plus', 'dp +', 'פפי dp',
]


def is_vaccine(item_name: str) -> bool:
    """Check if an item is a vaccination."""
    nl = item_name.strip().lower()
    for kw in VACCINE_KEYWORDS:
        if kw in nl:
            return True
    return False


def normalize_date(date_str: str) -> str:
    """Normalize date to DD/MM/YYYY format."""
    date_str = date_str.strip().strip('="\'')
    for fmt in ('%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y', '%Y-%m-%d'):
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime('%d/%m/%Y')
        except ValueError:
            continue
    return date_str


def build_csvs(data: list, output_dir: str, date_label: str):
    """Split parsed email data into vaccines and treatments CSVs."""
    vax_rows = []
    treat_rows = []

    for claim in data:
        # Support both flat format and nested format (from marpet email JSON)
        if 'owner' in claim:
            # Nested format: {owner: {name: ...}, animal: {name: ...}, items: [{item: ...}]}
            client = claim.get('owner', {}).get('name', '').strip()
            animal = claim.get('animal', {}).get('name', '').strip()
        else:
            # Flat format: {client_name: ..., animal_name: ...}
            client = claim.get('client_name', '').strip()
            animal = claim.get('animal_name', '').strip()
        visit_date = normalize_date(claim.get('visit_date', ''))

        for item in claim.get('items', []):
            # Support both {name: ...} and {item: ...} keys
            item_name = (item.get('name') or item.get('item') or '').strip()
            if not item_name:
                continue

            if is_vaccine(item_name):
                vax_rows.append({
                    'שם לקוח': client,
                    'שם החיה': animal,
                    'תאריך': visit_date,
                    'פריט במחירון': item_name,
                })
            else:
                treat_rows.append({
                    'שם לקוח': client,
                    'שם החיה': animal,
                    'תאריך': visit_date,
                    'פריט לתביעה': item_name,
                })

    # Write vaccines CSV
    vax_path = os.path.join(output_dir, f'marpet_vaccines_{date_label}.csv')
    with open(vax_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['שם לקוח', 'שם החיה', 'תאריך', 'פריט במחירון'])
        writer.writeheader()
        writer.writerows(vax_rows)
    print(f"Vaccines CSV: {vax_path} ({len(vax_rows)} rows)")

    # Write treatments CSV
    treat_path = os.path.join(output_dir, f'marpet_treatments_{date_label}.csv')
    with open(treat_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['שם לקוח', 'שם החיה', 'תאריך', 'פריט לתביעה'])
        writer.writeheader()
        writer.writerows(treat_rows)
    print(f"Treatments CSV: {treat_path} ({len(treat_rows)} rows)")

    return vax_path, treat_path


def parse_email_body(body: str) -> dict:
    """Parse a single marpet claim email body into structured data."""
    result = {
        'client_name': '',
        'phone': '',
        'id_number': '',
        'animal_name': '',
        'visit_date': '',
        'event_type': '',
        'exclusion': '',
        'items': [],
    }

    lines = body.split('\n')
    for line in lines:
        line = line.strip()
        if line.startswith('שם לקוח:'):
            result['client_name'] = line.split(':', 1)[1].strip()
        elif line.startswith('טלפון:'):
            result['phone'] = line.split(':', 1)[1].strip()
        elif line.startswith('ת.ז:') or line.startswith('ת.ז :'):
            result['id_number'] = line.split(':', 1)[1].strip()
        elif line.startswith('שם בעח:') or line.startswith('שם בע"ח:'):
            result['animal_name'] = line.split(':', 1)[1].strip()
        elif line.startswith('תאריך הביקור:'):
            result['visit_date'] = line.split(':', 1)[1].strip()
        elif 'אירוע חדש' in line:
            result['event_type'] = 'אירוע חדש'
        elif 'המשך אירוע' in line:
            result['event_type'] = 'המשך טיפול'
        elif line.startswith('החרגה:'):
            result['exclusion'] = line.split(':', 1)[1].strip()

    # Parse numbered items: "1) בדיקה רפואית (ביקור רופא). כמות: 1.  השתתפות עצמית: 0 ₪"
    item_pattern = re.compile(
        r'^\d+\)\s*(.+?)\.\s*כמות:\s*(\d+)\.\s*השתתפות עצמית:\s*(\d+)',
        re.MULTILINE
    )
    for m in item_pattern.finditer(body):
        result['items'].append({
            'name': m.group(1).strip(),
            'quantity': int(m.group(2)),
            'copay': int(m.group(3)),
        })

    return result


def main():
    if len(sys.argv) < 3:
        print("Usage: python build_marpet_csvs.py <input_json> <output_dir> [date_label]")
        print("  input_json: path to JSON file with parsed email data")
        print("  output_dir: directory for output CSVs")
        print("  date_label: optional label like '2026-03-17' (default: today)")
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    date_label = sys.argv[3] if len(sys.argv) > 3 else datetime.now().strftime('%Y-%m-%d')

    os.makedirs(output_dir, exist_ok=True)

    with open(input_path, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    # Handle both formats: flat list or wrapped {emails: [...]}
    if isinstance(raw, dict) and 'emails' in raw:
        data = raw['emails']
    elif isinstance(raw, list):
        data = raw
    else:
        print(f"ERROR: Unexpected JSON structure in {input_path}")
        sys.exit(1)

    print(f"Loaded {len(data)} claims from {input_path}")
    vax_path, treat_path = build_csvs(data, output_dir, date_label)
    print("Done.")


if __name__ == '__main__':
    main()
