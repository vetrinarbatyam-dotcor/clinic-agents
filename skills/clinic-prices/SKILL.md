---
name: clinic-prices
description: "ניהול מחירון קליניקה אונליין — חיפוש, קריאה ועדכון מחירים. Triggers: 'מחירון', 'עדכן מחיר', 'מחירים', 'clinic prices', 'price list', 'עלה מחיר', 'הורד מחיר', 'שנה מחיר', 'כמה עולה', 'price update'."
argument-hint: "[search|list|update] [term/tab] [+/-amount]"
---

# Clinic Prices — ניהול מחירון קליניקה אונליין

ניהול מחירון המרפאה דרך ClinicaOnline ASMX API.  
שלוש פעולות: **חיפוש**, **רשימת מחירון**, **עדכון מחיר**.

## Pre-flight

לפני כל פעולה, שאל את המשתמש:
- **חיפוש/רשימה**: "פורמט פלט: טבלה / קובץ Excel / רשימה?"
- **עדכון**: הצג את המחירים הנוכחיים + המחירים החדשים בטבלה, ובקש אישור לפני ביצוע

## Setup

```python
import sys, os
sys.path.insert(0, "/c/Users/user/clinic-pal-hub/backend")
from clinica.client import get_client
client = get_client()
```

## API Methods

### 1. SearchPriceItem — חיפוש פריט במחירון

```python
items = client.call("SearchPriceItem", {"Barcod": 0, "str": "search_term"})
```

**פרמטרים:**
- `Barcod`: int — תמיד 0 לחיפוש טקסט
- `str`: string — מונח חיפוש בעברית (למשל "סימפריקה", "בדיקה", "חיסון")

**מחזיר:** רשימת `RegProfessional` objects:
```json
{
  "__type": "RegProfessional",
  "FieldID": "138751",        // מזהה ייחודי — נדרש לעדכון
  "FieldName": "חבילה סימפריקה 1.3-2.5",  // שם הפריט
  "FieldValue": "200",        // המחיר הנוכחי (₪)
  "Type": 7,                  // סוג (2=בדיקות, 7=מוצרים)
  "SectionID": 1176,          // מזהה קטגוריה
  "FullPath": "מזון ומוצרים / פרעושים וקרציות / ",
  "IsInventory": false,
  "InventoryAmount": 0,
  "MinAmount": 0,
  "IsStandingOrder": 0
}
```

### 2. LoadPriceList — טעינת מחירון לפי טאב

```python
items = client.call("LoadPriceList", {"TabNumber": tab_number})
```

**טאבים זמינים:**

| TabNumber | תיאור | כמות פריטים |
|-----------|--------|-------------|
| 1 | טאב 1 | ~130 |
| 2 | טאב 2 | ~265 |
| 3 | טאב 3 | ~115 |
| 4 | טאב 4 (מוצרים) | ~700 |
| 5 | טאב 5 (תרופות/חומרים) | ~484 |
| 6 | טאב 6 | ~15 |
| 7 | טאב 7 | ~11 |

**שים לב:** LoadPriceList מחזיר פריטים **ללא FieldName** — רק FieldID + FieldValue (מחיר). להצלבה עם שמות, השתמש ב-SearchPriceItem.

### 3. UpdatePiceFromInvetory — עדכון מחיר פריט

```python
result = client.call("UpdatePiceFromInvetory", {
    "FieldID": 158931,      # int — מזהה הפריט
    "Price": "100"          # string — המחיר החדש
})
# result = [100, 84.75]  →  [מחיר_כולל_מעמ, מחיר_לפני_מעמ]
```

**פרמטרים:**
- `FieldID`: int — מזהה הפריט (מתוך SearchPriceItem)
- `Price`: string — המחיר החדש בשקלים (כולל מע"מ)

**מחזיר:** list של 2 ערכים: `[מחיר_חדש, מחיר_לפני_מעמ]`

**שם המתודה:** `UpdatePiceFromInvetory` — כן, יש שגיאת כתיב (Pice, Invetory) — זה כך ב-API המקורי.

## Workflow — עדכון מחירים

### עדכון בודד
```python
# 1. חפש את הפריט
items = client.call("SearchPriceItem", {"Barcod": 0, "str": "סימפריקה"})

# 2. הצג מחירים נוכחיים בטבלה למשתמש

# 3. אחרי אישור — עדכן
result = client.call("UpdatePiceFromInvetory", {
    "FieldID": int(item['FieldID']),
    "Price": str(new_price)
})

# 4. וודא שהמחיר עודכן
print(f"עודכן: {result[0]} ₪ (לפני מע\"מ: {result[1]:.2f} ₪)")
```

### עדכון מרובה (העלאה/הורדה אחידה)
```python
# העלה את כל מחירי הסימפריקה ב-10 ₪
items = client.call("SearchPriceItem", {"Barcod": 0, "str": "סימפריקה"})

# הצג טבלת לפני/אחרי לאישור
for item in items:
    old_price = int(item['FieldValue'])
    new_price = old_price + 10
    print(f"{item['FieldName']}: {old_price} → {new_price}")

# אחרי אישור המשתמש:
for item in items:
    old_price = int(item['FieldValue'])
    new_price = old_price + 10
    result = client.call("UpdatePiceFromInvetory", {
        "FieldID": int(item['FieldID']),
        "Price": str(new_price)
    })
    print(f"✓ {item['FieldName']}: {old_price} → {result[0]}")
```

### עדכון באחוזים
```python
# העלה ב-5%
for item in items:
    old_price = float(item['FieldValue'])
    new_price = round(old_price * 1.05)
    result = client.call("UpdatePiceFromInvetory", {
        "FieldID": int(item['FieldID']),
        "Price": str(new_price)
    })
```

## Safety Rules

1. **תמיד הצג טבלת לפני/אחרי** לפני ביצוע עדכון
2. **בקש אישור מפורש** מהמשתמש לפני כל עדכון מחיר
3. **עדכון מרובה** — הצג סיכום כולל (כמה פריטים, סכום שינוי כולל)
4. **לא לעגל** למספרים שלמים אלא אם המשתמש מבקש
5. **שמור לוג** של כל שינוי: פריט, מחיר ישן, מחיר חדש, תאריך

## Known Gotchas

1. `FieldValue` מוחזר כ-**string**, לא int — המר בקוד
2. `SearchPriceItem` דורש `Barcod` כ-**int** (0 לחיפוש טקסט). מחרוזת ריקה תגרום לשגיאה
3. `UpdatePiceFromInvetory` — שם המתודה עם שגיאות כתיב. לא לתקן
4. `Price` חייב להיות **string**, לא int
5. `FieldID` חייב להיות **int**, לא string
6. **LoadPriceList** לא מחזיר שמות — רק ID + מחיר

## Output Format

### טבלת מחירים (ברירת מחדל)
```
| פריט | מחיר נוכחי | קטגוריה |
|------|------------|---------|
| סימפריקה 1.3-2.5 | 75 ₪ | מזון ומוצרים / פרעושים |
```

### טבלת עדכון
```
| פריט | מחיר ישן | מחיר חדש | שינוי |
|------|----------|----------|-------|
| סימפריקה 1.3-2.5 | 75 ₪ | 85 ₪ | +10 ₪ |
```

## Database — PostgreSQL on Contabo

All prices are synced to `clinicpal` DB on 167.86.69.208.

### Tables

**catalog_items** — 1,720 פריטים מהמחירון
```sql
-- חיפוש פריט
SELECT name, price, full_path, field_id FROM catalog_items WHERE name LIKE '%סימפריקה%';

-- כל הפריטים בקטגוריה
SELECT name, price FROM catalog_items WHERE category = 'מזון ומוצרים' ORDER BY name;
```

**price_history** — לוג שינויי מחירים
```sql
-- היסטוריית מחירים של פריט
SELECT item_name, old_price, new_price, change_amount, change_pct, changed_at
FROM price_history WHERE field_id = 138751 ORDER BY changed_at DESC;
```

### Views — דוחות מכירות

**sales_by_item** — מה נמכר הכי הרבה
```sql
SELECT item_name, times_sold, total_revenue, avg_price, first_sold, last_sold
FROM sales_by_item LIMIT 20;
```

**sales_by_client** — מי הלקוחות הכי גדולים
```sql
SELECT client_name, cell_phone, num_visits, total_spent, last_purchase
FROM sales_by_client LIMIT 20;
```

**sales_monthly** — דוח מכירות חודשי
```sql
SELECT month, item_name, times_sold, quantity, revenue
FROM sales_monthly WHERE item_name LIKE '%סימפריקה%' ORDER BY month DESC;
```

### DB Connection
```
Host: 167.86.69.208 (or localhost on Contabo)
DB: clinicpal
User: clinicpal_user
Password: clinicpal2306
```

### Sync Script
```bash
# On Contabo:
cd /home/claude-user/clinic-agents
bun run data-warehouse/src/sync-prices.ts          # Full sync
bun run data-warehouse/src/sync-prices.ts --search סימפריקה  # Specific
```

### Related Tables
- **visit_items** — 112K+ שורות מכירות עם field_id, price, amount, discount
- **visits** — 58K ביקורים עם pet_id, user_id, therapist
- **clients** — 5,350 לקוחות עם טלפון, כתובת, חוב
- **pets** — חיות מחמד מקושרות ללקוחות

## Example Invocations

- `/clinic-prices search סימפריקה` — חפש כל פריטי סימפריקה
- `/clinic-prices search חיסון` — חפש כל החיסונים
- `/clinic-prices list 4` — הצג מחירון טאב 4
- `/clinic-prices update סימפריקה +10` — העלה סימפריקה ב-10 ₪
- `/clinic-prices update בדיקה רפואית 250` — קבע מחיר ל-250 ₪
- `/clinic-prices sales סימפריקה` — דוח מכירות סימפריקה
- `/clinic-prices top-sellers` — הפריטים הכי נמכרים
- `/clinic-prices top-clients` — הלקוחות הכי גדולים
