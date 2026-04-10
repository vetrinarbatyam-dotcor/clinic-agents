"""
send_audit_report.py -- Send audit Excel report via Gmail SMTP.

Usage:
    python send_audit_report.py <excel_path> [--date DD/MM/YYYY] [--summary "text"]

Reads config from C:/Users/user/marpat/config.json
"""

import sys
import io
import os
import json
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
from datetime import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

CONFIG_FILE = "C:/Users/user/marpat/config.json"
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def load_config():
    with open(CONFIG_FILE, encoding='utf-8') as f:
        return json.load(f)


def send_report(excel_path: str, date_str: str = None, summary_text: str = None):
    """Send audit report email with Excel attachment."""
    cfg = load_config()
    gmail_user = cfg["gmail_user"]
    recipient = cfg["recipient"]
    app_password = cfg["gmail_app_password"]

    if date_str is None:
        date_str = datetime.now().strftime("%d/%m/%Y")

    filename = os.path.basename(excel_path)

    msg = MIMEMultipart()
    msg["From"] = gmail_user
    msg["To"] = recipient
    msg["Subject"] = f"ביקורת מרפאט - {date_str}"

    if summary_text is None:
        summary_text = ""

    body = f"""שלום,

מצורף דוח ביקורת מרפאט לתאריך {date_str}.

{summary_text}

הדוח כולל:
- תביעות אבודות (טיפולים שבוצעו אך לא דווחו למבטח)
- חיסונים חסרים
- יתומים במרפאט (פריטים במבטח ללא התאמה במרפאה)
- חשד להתאמה (דורש בדיקה ידנית)
- דוח דלתא (התאמות מטושטשות)
- סיכום כולל ערך תביעות אבודות (₪)

בברכה,
מערכת ביקורת מרפאט
"""
    msg.attach(MIMEText(body, "plain", "utf-8"))

    # Attach Excel
    with open(excel_path, "rb") as f:
        part = MIMEBase("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        part.set_payload(f.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
    msg.attach(part)

    print(f"Sending to {recipient}...")
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(gmail_user, app_password)
        server.sendmail(gmail_user, recipient, msg.as_string())
    print(f"Email sent to {recipient} with attachment: {filename}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Send audit report via email')
    parser.add_argument('excel_path', help='Path to Excel report')
    parser.add_argument('--date', default=None, help='Report date (DD/MM/YYYY)')
    parser.add_argument('--summary', default=None, help='Summary text for email body')
    args = parser.parse_args()

    if not os.path.exists(args.excel_path):
        print(f"ERROR: File not found: {args.excel_path}")
        sys.exit(1)

    send_report(args.excel_path, args.date, args.summary)


if __name__ == '__main__':
    main()
