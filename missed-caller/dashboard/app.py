import os
import hmac
import hashlib
import time
import sqlite3
import psycopg2
import psycopg2.extras
from datetime import datetime, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, Form
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# Load env from parent dir
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

app = FastAPI()

DASHBOARD_SECRET = os.getenv('DASHBOARD_SECRET', 'dashboard_secret_fallback_2306')
DASHBOARD_PIN = '2306'
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'calls.db')
COOKIE_NAME = 'dashboard_auth'
COOKIE_MAX_AGE = 30 * 24 * 3600  # 30 days

# --- Auth helpers ---

def make_token() -> str:
    ts = str(int(time.time()))
    sig = hmac.new(DASHBOARD_SECRET.encode(), ts.encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{sig}"

def verify_token(token: str) -> bool:
    try:
        ts, sig = token.split('.', 1)
        expected = hmac.new(DASHBOARD_SECRET.encode(), ts.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return False
        if int(time.time()) - int(ts) > COOKIE_MAX_AGE:
            return False
        return True
    except Exception:
        return False

def get_auth(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    return bool(token and verify_token(token))

# --- Postgres connection (module-level, lazy) ---
_pg_conn = None

def get_pg():
    global _pg_conn
    try:
        if _pg_conn is None or _pg_conn.closed:
            _pg_conn = psycopg2.connect(
                host=os.getenv('DB_HOST', 'localhost'),
                port=int(os.getenv('DB_PORT', 5432)),
                dbname=os.getenv('DB_NAME', 'clinicpal'),
                user=os.getenv('DB_USER'),
                password=os.getenv('DB_PASSWORD'),
                connect_timeout=5
            )
            _pg_conn.autocommit = True
        _pg_conn.cursor().execute('SELECT 1')
        return _pg_conn
    except Exception:
        _pg_conn = None
        return None

def lookup_client(phone: str):
    if not phone:
        return None
    digits = ''.join(c for c in phone if c.isdigit())
    if digits.startswith('972') and len(digits) > 10:
        digits = '0' + digits[3:]
    pg = get_pg()
    if not pg:
        return None
    try:
        with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT TRIM(COALESCE(first_name,'')||' '||COALESCE(last_name,'')) AS name,
                       pets_list, last_visit, client_debt
                FROM clients
                WHERE regexp_replace(
                    COALESCE(cell_phone,'')||' '||COALESCE(cell_phone2,'')||' '||COALESCE(phone,''),
                    '[^0-9]', '', 'g'
                ) LIKE %s
                ORDER BY last_visit DESC NULLS LAST LIMIT 1
            """, (f'%{digits}%',))
            row = cur.fetchone()
            if row:
                return dict(row)
    except Exception as e:
        print(f"PG lookup error: {e}")
        global _pg_conn
        _pg_conn = None
    return None


# Bulk lookup with 30s in-memory cache — avoids N+1 queries on table-rendering endpoints
_client_cache = {}      # digits → (client_dict_or_None, timestamp)
_CLIENT_CACHE_TTL = 30

INSURANCE_NORMALIZE = {
    'b friend': 'BeFriend', 'b פרנד': 'BeFriend', 'be friend': 'BeFriend',
    'befrand': 'BeFriend', 'בי פרנד': 'BeFriend', 'ביפרינד': 'BeFriend', 'ביפרנד': 'BeFriend',
    'פניקס': 'הפניקס', 'הפניקס': 'הפניקס',
    'מרפאט': 'מרפאט', 'חיותא': 'חיותא', 'ליברה': 'ליברה',
}

def _norm_insurance(v):
    if not v: return ""
    return INSURANCE_NORMALIZE.get(v.strip().lower(), v.strip())

def lookup_clients_batch(phones):
    """Given a list of raw phone strings, return dict: phone -> client_dict|None."""
    import time as _time
    now = _time.time()
    digits_map = {}
    for ph in phones:
        if not ph: continue
        d = "".join(c for c in ph if c.isdigit())
        if d.startswith("972") and len(d) > 10:
            d = "0" + d[3:]
        if len(d) < 9: continue
        digits_map[d] = ph

    result = {ph: None for ph in phones}
    stale = []
    for d, ph in digits_map.items():
        hit = _client_cache.get(d)
        if hit and now - hit[1] < _CLIENT_CACHE_TTL:
            result[ph] = hit[0]
        else:
            stale.append(d)

    sql = """
        WITH matched AS (
          SELECT t.digits, c.user_id,
                 TRIM(COALESCE(c.first_name,'')||' '||COALESCE(c.last_name,'')) AS name,
                 c.pets_list, c.last_visit, c.client_debt
          FROM unnest(%s::text[]) AS t(digits)
          LEFT JOIN LATERAL (
            SELECT user_id, first_name, last_name, pets_list, last_visit, client_debt
            FROM clients
            WHERE regexp_replace(
              COALESCE(cell_phone,'')||' '||COALESCE(cell_phone2,'')||' '||COALESCE(phone,''),
              '[^0-9]', '', 'g'
            ) LIKE '%%' || t.digits || '%%'
            ORDER BY last_visit DESC NULLS LAST LIMIT 1
          ) c ON TRUE
        )
        SELECT m.digits, m.name, m.pets_list, m.last_visit, m.client_debt,
               COALESCE(json_agg(
                 json_build_object(
                   'name', pets.name, 'species', pets.species,
                   'breed', pets.breed, 'insurance', pets.insurance_name
                 ) ORDER BY pets.pet_id
               ) FILTER (WHERE pets.pet_id IS NOT NULL), '[]'::json) AS pets
        FROM matched m
        LEFT JOIN pets ON pets.user_id = m.user_id AND COALESCE(pets.not_active,0) = 0
        GROUP BY m.digits, m.name, m.pets_list, m.last_visit, m.client_debt;
    """

    if stale:
        pg = get_pg()
        if pg:
            try:
                with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    cur.execute(sql, (stale,))
                    for row in cur.fetchall():
                        d = row['digits']
                        if not row['name']:
                            client = None
                        else:
                            pets = []
                            for pet in (row.get('pets') or []):
                                pets.append({
                                    'name': pet.get('name') or '',
                                    'species': (pet.get('species') or '').strip(),
                                    'breed': (pet.get('breed') or '').strip(),
                                    'insurance': _norm_insurance(pet.get('insurance')),
                                })
                            client = {
                                'name': row['name'],
                                'pets_list': row['pets_list'],
                                'pets': pets,
                                'last_visit': row['last_visit'],
                                'client_debt': row['client_debt'],
                            }
                        _client_cache[d] = (client, now)
                        if d in digits_map:
                            result[digits_map[d]] = client
            except Exception as e:
                print(f"PG bulk lookup error: {e}")
                global _pg_conn
                _pg_conn = None

    return result

# --- SQLite helper ---


def _count_vm_as_missed():
    """Read toggle from settings DB. Default false — keeps baseline numbers stable."""
    try:
        import sys as _sys
        _parent = '/home/claude-user/clinic-agents/missed-caller'
        if _parent not in _sys.path:
            _sys.path.insert(0, _parent)
        import settings_store
        return (settings_store.get_setting('count_voicemail_as_missed', 'false') or '').lower() in ('true', '1', 'yes', 'on')
    except Exception:
        return False

VOICEMAIL_THRESHOLD_SEC = 49  # Answered but shorter than this = likely voicemail/IVR

def is_suspected_voicemail(status, total_sec):
    return status == 'Answered' and (total_sec or 0) < _voicemail_threshold()

def _voicemail_threshold():
    """Read voicemail threshold from settings DB, default 49."""
    try:
        import sys as _sys
        _parent = '/home/claude-user/clinic-agents/missed-caller'
        if _parent not in _sys.path:
            _sys.path.insert(0, _parent)
        import settings_store
        v = settings_store.get_setting('voicemail_threshold_sec', '49')
        return int(v) if v else 49
    except Exception:
        return VOICEMAIL_THRESHOLD_SEC


EXTERNAL_FILTER = "from_num GLOB '0[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*' AND from_num != '035513649'"

def get_sqlite():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def days_ago_ts(days: int) -> str:
    return (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S')

# --- Routes ---

@app.get('/', response_class=RedirectResponse)
async def root(request: Request):
    if get_auth(request):
        return RedirectResponse('/app', status_code=302)
    return RedirectResponse('/login', status_code=302)

LOGIN_HTML = """<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><title>כניסה דשבורד שיחות</title>
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-gray-900 text-white flex items-center justify-center min-h-screen">
<div class="bg-gray-800 rounded-2xl p-10 shadow-2xl w-80 text-center">
  <div class="text-4xl mb-4">🐾</div>
  <h1 class="text-xl font-bold mb-2">ווטרינר בת-ים</h1>
  <p class="text-gray-400 text-sm mb-6">דשבורד שיחות — הזן PIN</p>
  <form method="POST" action="/login">
    <input type="password" name="pin" placeholder="PIN" autofocus
      class="w-full text-center text-2xl tracking-widest bg-gray-700 border border-gray-600 rounded-xl p-3 mb-4 focus:outline-none focus:border-indigo-400"/>
    <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition">כניסה</button>
  </form>
  {error}
</div>
</body></html>"""

@app.get('/login', response_class=HTMLResponse)
async def login_page():
    return HTMLResponse(LOGIN_HTML.format(error=''))

@app.post('/login')
async def login_post(pin: str = Form(...)):
    if pin == DASHBOARD_PIN:
        token = make_token()
        resp = RedirectResponse('/app', status_code=302)
        resp.set_cookie(COOKIE_NAME, token, max_age=COOKIE_MAX_AGE, httponly=True, samesite='lax')
        return resp
    html = LOGIN_HTML.format(error='<p class="text-red-400 text-sm mt-3">PIN שגוי, נסה שוב</p>')
    return HTMLResponse(html, status_code=401)

@app.get('/app', response_class=HTMLResponse)
async def serve_app(request: Request):
    if not get_auth(request):
        return RedirectResponse('/login', status_code=302)
    with open(os.path.join(os.path.dirname(__file__), 'static', 'index.html'), 'r', encoding='utf-8') as f:
        return HTMLResponse(f.read())

from starlette.middleware.base import BaseHTTPMiddleware

class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith('/static') or request.url.path in ('/', '/app'):
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return response

app.add_middleware(NoCacheMiddleware)
app.mount('/static', StaticFiles(directory=os.path.join(os.path.dirname(__file__), 'static')), name='static')

# --- API Endpoints ---

@app.get('/api/summary')
async def api_summary(request: Request, days: int = 7):
    if not get_auth(request):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    since = days_ago_ts(days)
    conn = get_sqlite()
    try:
        cur = conn.execute(f"""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status='Answered' THEN 1 ELSE 0 END) AS answered,
                SUM(CASE WHEN status!='Answered' THEN 1 ELSE 0 END) AS missed
            FROM call_summary
            WHERE ts >= ? AND {EXTERNAL_FILTER}
        """, (since,))
        row = cur.fetchone()
        total = row['total'] or 0
        answered = row['answered'] or 0
        missed = row['missed'] or 0

        cur2 = conn.execute(f"""
            SELECT m.from_num, m.ts AS missed_ts
            FROM call_summary m
            WHERE m.ts >= ? AND m.status != 'Answered' AND {EXTERNAL_FILTER}
        """, (since,))
        missed_rows = cur2.fetchall()
        lost = 0
        for mr in missed_rows:
            cur3 = conn.execute("""
                SELECT COUNT(*) FROM call_summary
                WHERE from_num=? AND status='Answered'
                  AND ts > ? AND ts <= datetime(?, '+6 hours')
            """, (mr['from_num'], mr['missed_ts'], mr['missed_ts']))
            if cur3.fetchone()[0] == 0:
                lost += 1

        missed_pct = round(missed / total * 100, 1) if total else 0
        vm_cur = conn.execute(f"""SELECT COUNT(*) FROM call_summary WHERE ts >= ? AND status='Answered' AND total_sec < {_voicemail_threshold()} AND {EXTERNAL_FILTER}""", (since,))
        voicemail_suspect = vm_cur.fetchone()[0] or 0
        if _count_vm_as_missed() and voicemail_suspect:
            answered = max(0, answered - voicemail_suspect)
            missed = missed + voicemail_suspect
            missed_pct = round(missed / total * 100, 1) if total else 0
        return {'total': total, 'answered': answered, 'missed': missed, 'lost': lost, 'missed_pct': missed_pct, 'voicemail_suspect': voicemail_suspect, 'missed_incl_vm': missed + (voicemail_suspect if not _count_vm_as_missed() else 0), 'missed_pct_incl_vm': round((missed + voicemail_suspect)/total*100, 1) if total else 0, 'vm_counts_as_missed': _count_vm_as_missed(), 'days': days}
    finally:
        conn.close()

@app.get('/api/calls')
async def api_calls(request: Request, days: int = 7, status: str = 'all', search: str = '', limit: int = 200):
    if not get_auth(request):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    since = days_ago_ts(days)
    conn = get_sqlite()
    try:
        status_filter = ''
        params = [since]
        if status == 'missed':
            status_filter = "AND status != 'Answered'"
        elif status == 'answered':
            status_filter = "AND status = 'Answered'"

        cur = conn.execute(f"""
            SELECT uniqueid, ts, from_num, caller_id, total_sec, status
            FROM call_summary
            WHERE ts >= ? AND {EXTERNAL_FILTER} {status_filter}
            ORDER BY ts DESC
            LIMIT ?
        """, params + [limit * 3])

        rows = cur.fetchall()
        results = []
        phones = [dict(row)['from_num'] for row in rows]
        client_map = lookup_clients_batch(phones)
        for row in rows:
            r = dict(row)
            client = client_map.get(r['from_num'])
            r['client'] = {
                'name': client['name'] if client else None,
                'pets': client['pets_list'] if client else None,
                'pets_detail': client['pets'] if client else [],
                'last_visit': str(client['last_visit']) if client and client['last_visit'] else None,
                'debt': float(client['client_debt']) if client and client.get('client_debt') else None
            } if client else None

            if search:
                sl = search.lower()
                name_match = r['client'] and r['client']['name'] and sl in r['client']['name'].lower()
                num_match = sl in (r['from_num'] or '')
                if not name_match and not num_match:
                    continue

            results.append(r)
            if len(results) >= limit:
                break

        return results
    finally:
        conn.close()

@app.get('/api/missed/top')
async def api_missed_top(request: Request, days: int = 7, include_suspect: int = 1, limit: int = 50, date_from: str = '', date_to: str = ''):
    if not get_auth(request):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    if date_from and date_to:
        since = date_from + ' 00:00:00'
        until = date_to + ' 23:59:59'
    else:
        since = days_ago_ts(days)
        until = None
    conn = get_sqlite()
    vm_clause = f"OR (status='Answered' AND total_sec < {_voicemail_threshold()})" if include_suspect else ""
    try:
        cur = conn.execute(f"""
            SELECT from_num,
                   COUNT(*) AS miss_count,
                   MAX(ts) AS last_missed,
                   SUM(CASE WHEN status != 'Answered' THEN 1 ELSE 0 END) AS strict_missed,
                   SUM(CASE WHEN status='Answered' AND total_sec < {_voicemail_threshold()} THEN 1 ELSE 0 END) AS voicemail_count
            FROM call_summary
            WHERE ts >= ? AND (status != 'Answered' {vm_clause}) AND {EXTERNAL_FILTER}
              {{until_clause}}
            GROUP BY from_num
            ORDER BY miss_count DESC
            LIMIT ?
        """.replace("{until_clause}", "AND ts <= ?" if until else ""), ([since, until, limit] if until else [since, limit]))
        rows = cur.fetchall()
        results = []
        phones = [dict(row)['from_num'] for row in rows]
        client_map = lookup_clients_batch(phones)
        for row in rows:
            r = dict(row)
            client = client_map.get(r['from_num'])
            r['client'] = {
                'name': client['name'] if client else None,
                'pets': client['pets_list'] if client else None,
                'pets_detail': client['pets'] if client else [],
                'last_visit': str(client['last_visit']) if client and client['last_visit'] else None,
            } if client else None
            r['suspected_voicemail'] = is_suspected_voicemail(r.get('status'), r.get('total_sec'))
            results.append(r)
        return results
    finally:
        conn.close()

@app.get('/api/leads')
async def api_leads(request: Request, days: int = 30, sort: str = 'recent'):
    if not get_auth(request):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    since = days_ago_ts(days)
    order_clause = 'last_seen DESC' if sort == 'recent' else 'miss_count DESC, last_seen DESC'
    conn = get_sqlite()
    try:
        cur = conn.execute(f"""
            SELECT from_num, COUNT(*) AS miss_count, MIN(ts) AS first_seen, MAX(ts) AS last_seen
            FROM call_summary
            WHERE ts >= ? AND status != 'Answered' AND {EXTERNAL_FILTER}
            GROUP BY from_num
            HAVING miss_count >= 2
            ORDER BY {order_clause}
        """, (since,))
        rows = cur.fetchall()
        results = []
        phones = [dict(row)['from_num'] for row in rows]
        client_map = lookup_clients_batch(phones)
        for row in rows:
            r = dict(row)
            client = client_map.get(r['from_num'])
            if client and client.get('name') and client['name'].strip():
                continue
            results.append(r)
        return results
    finally:
        conn.close()

@app.get('/api/client-history')
async def api_client_history(request: Request, phone: str = ''):
    if not get_auth(request):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    conn = get_sqlite()
    try:
        cur = conn.execute(f"""
            SELECT uniqueid, ts, from_num, caller_id, total_sec, status
            FROM call_summary
            WHERE from_num = ? AND {EXTERNAL_FILTER}
            ORDER BY ts DESC
            LIMIT 100
        """, (phone,))
        rows = [dict(r) for r in cur.fetchall()]
        c = lookup_clients_batch([phone]).get(phone)
        client = None if not c else {
            'name': c['name'],
            'pets': c['pets_list'],
            'pets_detail': c['pets'],
            'last_visit': str(c['last_visit']) if c.get('last_visit') else None,
            'client_debt': float(c['client_debt']) if c.get('client_debt') is not None else 0,
        }
        return {'calls': rows, 'client': client}
    finally:
        conn.close()

@app.get('/api/heatmap')
async def api_heatmap(request: Request, days: int = 30):
    if not get_auth(request):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    since = days_ago_ts(days)
    conn = get_sqlite()
    try:
        cur = conn.execute(f"""
            SELECT CAST(strftime('%w', ts) AS INTEGER) AS weekday,
                   CAST(strftime('%H', ts) AS INTEGER) AS hour,
                   COUNT(*) AS cnt
            FROM call_summary
            WHERE ts >= ? AND {EXTERNAL_FILTER}
            GROUP BY weekday, hour
        """, (since,))
        grid = [[0]*24 for _ in range(7)]
        for row in cur.fetchall():
            wd = row[0]
            hr = row[1]
            cnt = row[2]
            if 0 <= wd < 7 and 0 <= hr < 24:
                grid[wd][hr] = cnt
        return {'grid': grid, 'days': days}
    finally:
        conn.close()

@app.get('/api/today-live')
async def api_today_live(request: Request):
    if not get_auth(request):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    today = datetime.now().strftime('%Y-%m-%d')
    conn = get_sqlite()
    try:
        cur = conn.execute(f"""
            SELECT uniqueid, ts, from_num, caller_id, total_sec, status
            FROM call_summary
            WHERE ts >= ? AND {EXTERNAL_FILTER}
            ORDER BY ts DESC
        """, (today + ' 00:00:00',))
        rows = cur.fetchall()
        results = []
        phones = [dict(row)['from_num'] for row in rows]
        client_map = lookup_clients_batch(phones)
        for row in rows:
            r = dict(row)
            client = client_map.get(r['from_num'])
            r['client'] = {
                'name': client['name'] if client else None,
                'pets': client['pets_list'] if client else None,
                'pets_detail': client['pets'] if client else [],
                'last_visit': str(client['last_visit']) if client and client['last_visit'] else None,
            } if client else None
            r['suspected_voicemail'] = is_suspected_voicemail(r.get('status'), r.get('total_sec'))
            results.append(r)
        return results
    finally:
        conn.close()

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=3005)

# --- Settings API ---

import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import settings_store

@app.get('/api/settings')
async def api_settings_get(request: Request):
    if not get_auth(request):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    return JSONResponse(settings_store.get_all_settings())

@app.post('/api/settings')
async def api_settings_post(request: Request):
    if not get_auth(request):
        return JSONResponse({'error': 'Unauthorized'}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({'error': 'Invalid JSON'}, status_code=400)
    updated = []
    for key, value in body.items():
        settings_store.set_setting(str(key), str(value))
        updated.append(key)
    return JSONResponse({'ok': True, 'updated': updated})
