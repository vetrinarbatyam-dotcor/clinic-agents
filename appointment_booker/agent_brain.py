"""LLM-driven agent brain — Claude via headless mode (claude -p).

Uses a thread-pool with a concurrency semaphore so at most MAX_CONCURRENT_CLAUDE
subprocess calls run in parallel. Prompt is passed via stdin (no tmpfile)."""
import concurrent.futures
import json
import logging
import subprocess
import threading
import time
from datetime import datetime
from typing import Optional, Dict, Any

# ── concurrency control ──
# Limit parallel `claude -p` calls — each eats ~200MB RAM + CPU.
# With Claude Max (not API), this prevents resource exhaustion.
MAX_CONCURRENT_CLAUDE = 2
_claude_semaphore = threading.Semaphore(MAX_CONCURRENT_CLAUDE)
_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=MAX_CONCURRENT_CLAUDE,
    thread_name_prefix="claude-worker",
)

log = logging.getLogger(__name__)

HEB_WEEKDAY_EN_HE = {
    "Sunday": "ראשון",
    "Monday": "שני",
    "Tuesday": "שלישי",
    "Wednesday": "רביעי",
    "Thursday": "חמישי",
    "Friday": "שישי",
    "Saturday": "שבת",
}

HEBREW_DAYS_FULL = {
    "sunday": "ראשון",
    "monday": "שני",
    "tuesday": "שלישי",
    "wednesday": "רביעי",
    "thursday": "חמישי",
    "friday": "שישי",
    "saturday": "שבת",
}


def build_system_prompt(customer_name: str, pet_name: str, vaccine_name: str,
                        free_slots: list, duration_min: int,
                        working_hours_summary: str, today_str: str,
                        pet_type: str = "", no_appointment_info: dict = None) -> str:
    """Build the system prompt with all context."""
    slots_by_day = {}
    for s in free_slots:
        key = f"{s['day_name_he']} {s['date_str']}"
        slots_by_day.setdefault(key, []).append((s['time_str'], s['iso']))
    lines = []
    for day, entries in slots_by_day.items():
        shown = [f"{tm} <{iso}>" for tm, iso in entries]
        lines.append(f"- {day}: " + ", ".join(shown))
    slots_text = "\n".join(lines) if lines else "(אין סלוטים פנויים)"

    pet_line = f"חיה ({pet_type}): {pet_name}" if pet_type else f"חיה: {pet_name}"
    if vaccine_name:
        vaccine_line = f"- חיסון/טיפול נדרש: {vaccine_name} (משך {duration_min} דקות)"
    else:
        vaccine_line = "- הלקוח פנה מיוזמתו — לא הוזכרה בקשה ספציפית. שאל בעדינות במה אפשר לעזור."
    no_appt_block = ""
    if no_appointment_info and no_appointment_info.get("keywords"):
        kw = ", ".join(no_appointment_info.get("keywords") or [])
        msg = no_appointment_info.get("message") or ""
        if vaccine_name:
            # Cross-sell: client has an open vaccine reminder — combine into an appointment CTA
            no_appt_block = (
                f"\n\nמוצרים/שירותים מסוג זה (ברבקטו/סימפריקה/הדברה וכו'):"
                f"\n- מילות מפתח: {kw}"
                f"\n- אסטרטגיה: ללקוח יש תזכורת פתוחה לחיסון ({vaccine_name}). *אל* תענה שאין צורך בתור — במקום זה הצע לשלב: offer_slot לחיסון, ובהודעה ציין שכשיגיעו נוכל להמליץ על מוצר ההדברה המתאים מתוך מגוון."
                f"\n- דוגמת תשובה: 'בטח! כשתבואו לחיסון {vaccine_name} ליפצוק נמליץ לך על מוצר ההדברה המתאים — יש כמה אופציות. מתי נוח לך לבוא?'"
                f"\n- action=offer_slot (לא no_appointment) כי המטרה היא להביא את הלקוח למרפאה."
            )
        else:
            # No open vaccine — pure informational response
            no_appt_block = (
                f"\n\nמוצרים/שירותים ללא צורך בתור (action=no_appointment):"
                f"\n- מילות מפתח: {kw}"
                f"\n- תשובה ללקוח: {msg} (צרף שעות פעילות מהרשימה למעלה)"
                f"\n- אם בהמשך הלקוח מזכיר צורך בבדיקה/התייעצות רחבה יותר — מותר להציע לקבוע תור רגיל."
            )

    medical_block = (
        "\n\nבעיות רפואיות (action=handoff — לא תור חיסון):"
        "\n- סימני אזהרה: מקיא, משלשל, לא אוכל, לא שותה, לא מרגיש טוב, אפתי, חולה, כאבים, חום, פציעה, דם, נפיחות, קשיי נשימה, צולע, כל תלונה רפואית לא שגרתית."
        "\n- יוצאים מהכלל (אפשר להציע תור רגיל): גרד, ליקוקים בלבד בלי סימפטום אחר, חיסון שנתי, בדיקה שגרתית."
        "\n- חשוב: אתה עצמך אלכס המזכירה הדיגיטלית — אל תפנה את הלקוח אליך. הפנה רק לצוות האנושי."
        "\n- תשובה ללקוח: 'היי 🐾 זה לא הערוץ המתאים לבעיה רפואית. חשוב שתיצור קשר עם המרפאה:\\n📞 טלפון: 035513649 (עד 19:30)\\n💬 או וואטסאפ לאותו מספר\\nצוות המרפאה יחזור אליך מהר יותר ככה 🙏'"
        "\n- תמיד להעביר את האחריות ליצירת קשר אל הלקוח — לא להבטיח שמישהו יחזור אוטומטית."
    )

    prompt = f"""אתה סוכן AI של מרפאה וטרינרית. אתה מדבר עברית טבעית עם לקוחות בוואטסאפ ומסייע להם לקבוע תורים לחיסונים.

היום: {today_str}

שעות פעילות המרפאה:
{working_hours_summary}

הלקוח:
- שם: {customer_name}
- {pet_line}
{vaccine_line}{no_appt_block}{medical_block}

תורים פנויים בימים הקרובים (כל שורה: יום תאריך, שעות פנויות עם ISO בסוגריים מחודדים):
{slots_text}

המשימה שלך:
1. להבין מה הלקוח רוצה מתוך השיחה (גם אם לא טמפלייטי)
2. להציע תור מתאים — אחד בכל פעם, הכי קרוב להעדפה
3. אם הלקוח אומר יום/זמן — למצוא מהרשימה את הסלוט הכי קרוב להעדפה ולהחזיר את ה-ISO שלו בשדה slot_iso
4. לאחר אישור (כן/מאשר/בטח/אוקיי) — להזמין תור (action=book) עם ה-ISO של ההצעה הקודמת (מהשיחה בהיסטוריה)
5. אם הלקוח דוחה הצעה — להציע אחרת באותה העדפה (יום/שעה)
6. אם לא מבין או הלקוח מבלבל אחרי כמה ניסיונות — להעביר לצוות (action=handoff)

המרה של העדפות זמן:
- "בוקר" = 08:00-12:00
- "צהריים" = 12:00-15:00
- "אחר הצהריים" = 15:00-17:00
- "ערב" = 17:00 ואילך
- "מחר" = היום הבא שבו המרפאה פתוחה

חובה חמורה: בחר slot_iso אך ורק מתוך הרשימה 'תורים פנויים' למעלה — העתק את ה-ISO בדיוק כפי שמופיע בסוגריים <...>. אל תמציא שעות/תאריכים שאינם ברשימה, גם אם הלקוח מבקש זמן שלא פנוי. אם אין סלוט שמתאים להעדפה — בחר מהרשימה את הקרוב ביותר והסבר בקצרה שזה מה שפנוי.

תגובה: הגב אך ורק ב-JSON תקף, בלי טקסט מסביב, בלי markdown code block:
{{
  "action": "offer_slot" | "book" | "ask_question" | "handoff" | "no_appointment" | "done",
  "reply": "הטקסט הטבעי ללקוח בעברית, עד 2 שורות",
  "slot_iso": "<ISO datetime מדויק מהרשימה, רק אם action=book או offer_slot>",
  "reasoning": "<למה בחרת, לא נשלח ללקוח>"
}}

דוגמאות החלטה:
- לקוח אומר "שני בערב" → חפש סלוט ביום שני אחרי 17:00 → החזר offer_slot עם ה-ISO
- לקוח אומר "כן" אחרי offer_slot → החזר book עם אותו ISO של ההצעה הקודמת (ראה בהיסטוריה)
- לקוח אומר "לא" → הצע אחר באותה העדפה
- לקוח מדווח סימפטום רפואי (מקיא/חולה/אפתי/לא אוכל/משלשל וכו') → handoff עם ההודעה הרפואית המוכנה
- לקוח שואל על מחיר → handoff
- לקוח שואל על מוצר מרשימת ה-no_appointment: אם יש לו חיסון פתוח → offer_slot עם הודעה cross-sell ('תבואו לחיסון ונמליץ על הדברה'). אם אין חיסון פתוח → no_appointment עם ההודעה המוכנה + שעות פעילות.
- לקוח בלבול/חוזר על עצמו שלוש פעמים → handoff
- אחרי הזמנה מוצלחת → done"""
    return prompt


def _run_claude_stdin(full_prompt: str, timeout_sec: int = 60) -> Optional[str]:
    """Low-level: run `claude -p` as claude-user, passing prompt via stdin.

    Returns raw stdout on success, None on failure.
    No tmpfile — prompt goes straight into the subprocess pipe.
    Guarded by _claude_semaphore so at most MAX_CONCURRENT_CLAUDE run in parallel.
    """
    cmd = ["su", "-", "claude-user", "-c", "claude -p --output-format text"]
    with _claude_semaphore:
        t0 = time.time()
        try:
            result = subprocess.run(
                cmd,
                input=full_prompt,
                capture_output=True,
                text=True,
                timeout=timeout_sec,
            )
        except subprocess.TimeoutExpired:
            log.warning("[agent_brain] claude timeout after %ds (%.1fs queued+exec)",
                        timeout_sec, time.time() - t0)
            return None
        elapsed = time.time() - t0
        log.info("[agent_brain] claude took %.1fs rc=%d", elapsed, result.returncode)

        if result.returncode != 0:
            log.warning(
                "[agent_brain] claude rc=%d stderr=%s stdout=%s",
                result.returncode,
                (result.stderr or "")[:300],
                (result.stdout or "")[:300],
            )
            return None

        raw = (result.stdout or "").strip()
        if not raw:
            log.warning("[agent_brain] empty response from claude")
            return None
        return raw


def _parse_json_response(raw: str) -> Optional[Dict[str, Any]]:
    """Extract the first JSON object from Claude's raw text output."""
    if "```" in raw:
        for part in raw.split("```"):
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{"):
                raw = part
                break

    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end < 0:
        log.warning("[agent_brain] no JSON in response: %s", raw[:300])
        return None
    try:
        return json.loads(raw[start:end + 1])
    except json.JSONDecodeError as e:
        log.warning("[agent_brain] JSON parse error: %s raw=%s", e, raw[:400])
        return None


def call_claude(system_prompt: str, conversation_history: list, new_message: str,
                timeout_sec: int = 60) -> Optional[Dict[str, Any]]:
    """Call Claude via headless mode with conversation context.

    Prompt is passed via stdin (no tmpfile). Concurrency is limited by
    _claude_semaphore — excess callers block until a slot frees up.
    Returns parsed JSON response or None on failure.
    """
    conv_lines = []
    for m in conversation_history[-10:]:
        role = "לקוח" if m.get("role") == "user" else "סוכן"
        conv_lines.append(f"{role}: {m.get('content', '')}")
    conv_lines.append(f"לקוח: {new_message}")
    conv_text = "\n".join(conv_lines)

    full_prompt = (
        system_prompt
        + "\n\nהשיחה עד עכשיו:\n"
        + conv_text
        + "\n\nהגב ב-JSON בלבד:"
    )

    raw = _run_claude_stdin(full_prompt, timeout_sec)
    if not raw:
        return None
    return _parse_json_response(raw)


def _log_event(phone: str, event_type: str, details: dict):
    try:
        from db import execute
        execute(
            """
            INSERT INTO appt_booker_runs (event_type, phone, details)
            VALUES (%s, %s, %s::jsonb)
            """,
            (event_type, phone, json.dumps(details, default=str)),
        )
    except Exception as e:
        log.error("[agent_brain] log_event failed: %s", e)


def _append_and_save(session, ctx, history, text, reply, new_state):
    from shared.session_manager import update_session
    history.append({"role": "user", "content": text, "ts": datetime.now().isoformat()})
    history.append({"role": "assistant", "content": reply, "ts": datetime.now().isoformat()})
    ctx["history"] = history[-20:]
    update_session(session["id"], state=new_state, context=ctx)


def _handoff(session, ctx, text, history, reply, phone, reason,
             config=None, alert=False, pet_name="", extra=None):
    _log_event(phone, reason, {"text": text[:120], **(extra or {})})
    _append_and_save(session, ctx, history, text, reply, "HANDOFF")
    if alert and config is not None:
        try:
            from shared import whatsapp_sender as wa_gateway
            if getattr(config, "alert_on_handoff", False) and getattr(config, "team_alert_phone", None):
                wa_gateway.send(
                    to=config.team_alert_phone,
                    message=f"⚠️ [appt_booker] {reason} — {phone} ({pet_name}): {text[:80]}",
                    category="alert",
                    agent="appointment_booker",
                )
        except Exception:
            log.exception("[agent_brain] handoff alert failed")
    return {"reply": reply, "state": "HANDOFF", "action": reason}


def process_message(session, text, config, outbound_info: dict) -> dict:
    """Main entry point — processes a message through the LLM agent.
    Returns {reply, state, action} compatible with the webhook contract.
    """
    from agents.appointment_booker import tools
    from shared.session_manager import update_session

    phone = session["phone"]
    customer_name = outbound_info.get("customer_name", "לקוח")
    pet_name = outbound_info.get("pet_name") or "החיה"
    vaccine_name = outbound_info.get("vaccine_name") or ""
    pet_id = outbound_info.get("pet_id")
    patient_id = outbound_info.get("patient_id")
    treatment_id = outbound_info.get("treatment_id", 3338)
    duration_min = outbound_info.get("duration_min", 20)
    calendar_id = outbound_info.get("calendar_id")

    ctx = session.get("context") or {}
    if isinstance(ctx, str):
        try:
            ctx = json.loads(ctx)
        except Exception:
            ctx = {}
    history = ctx.get("history") or []

    if not calendar_id:
        _log_event(phone, "llm_no_calendar", {"outbound_info": outbound_info})
        return _handoff(
            session, ctx, text, history,
            "מצטערים, יש בעיה טכנית. מישהו מהצוות יחזור אליך 🙏",
            phone, "no_calendar",
        )

    try:
        free_slots = tools.get_free_slots(
            calendar_id, config, days=getattr(config, 'days_ahead', 30), duration_min=duration_min
        )
        valid_isos = {s["iso"] for s in free_slots}
    except Exception as e:
        log.exception("[agent_brain] get_free_slots failed")
        _log_event(phone, "llm_slots_error", {"error": str(e)[:200]})
        return _handoff(
            session, ctx, text, history,
            "מצטערים, יש בעיה זמנית בלוח. מישהו מהצוות יחזור אליך 🙏",
            phone, "slots_error",
        )

    wh_lines = []
    for day_key, day_he in HEBREW_DAYS_FULL.items():
        day_cfg = (config.working_days or {}).get(day_key) or {}
        if day_cfg.get("enabled"):
            windows = day_cfg.get("windows", [])
            times = ", ".join(f"{w['start']}-{w['end']}" for w in windows)
            wh_lines.append(f"- {day_he}: {times}")
        else:
            wh_lines.append(f"- {day_he}: סגור")
    wh_summary = "\n".join(wh_lines)

    today_str = datetime.now().strftime("%A %d/%m/%Y")
    for en, he in HEB_WEEKDAY_EN_HE.items():
        today_str = today_str.replace(en, he)

    pet_type = outbound_info.get("pet_type", "") or ""
    no_appt_info = None
    try:
        vc = getattr(config, "vaccine_categories", None) or {}
        if isinstance(vc, dict):
            na = vc.get("no_appointment")
            if na is not None:
                if isinstance(na, dict):
                    no_appt_info = {
                        "keywords": na.get("keywords") or [],
                        "message": na.get("message") or "",
                    }
                else:
                    no_appt_info = {
                        "keywords": getattr(na, "keywords", []) or [],
                        "message": getattr(na, "message", "") or "",
                    }
    except Exception:
        no_appt_info = None

    system_prompt = build_system_prompt(
        customer_name=customer_name,
        pet_name=pet_name,
        vaccine_name=vaccine_name,
        free_slots=free_slots,
        duration_min=duration_min,
        working_hours_summary=wh_summary,
        today_str=today_str,
        pet_type=pet_type,
        no_appointment_info=no_appt_info,
    )

    llm_result = call_claude(system_prompt, history, text, timeout_sec=60)

    if not llm_result:
        return _handoff(
            session, ctx, text, history,
            "מצטערים, יש בעיה טכנית. מישהו מהצוות יחזור אליך בהקדם 🙏",
            phone, "llm_failed", config=config, alert=True, pet_name=pet_name,
        )

    action = llm_result.get("action", "ask_question")
    reply = (llm_result.get("reply") or "").strip()
    slot_iso = llm_result.get("slot_iso")
    reasoning = llm_result.get("reasoning", "")

    _log_event(phone, "llm_decision", {
        "action": action,
        "slot_iso": slot_iso,
        "reasoning": (reasoning or "")[:200],
        "input": text[:120],
    })

    # BOOK
    if action == "book" and slot_iso:
        # SAFETY: LLM must pick an ISO from the list we showed it.
        # Without this check, a prompt-injected or hallucinating model
        # can book an arbitrary datetime — working_hours is the only other gate.
        if slot_iso not in valid_isos:
            _log_event(phone, "llm_iso_not_in_offered_list", {
                "slot_iso": slot_iso,
                "valid_count": len(valid_isos),
                "reasoning": (reasoning or "")[:200],
            })
            return _handoff(
                session, ctx, text, history,
                "מצטערים, יש בעיה טכנית בקביעת התור. מישהו מהצוות יחזור אליך 🙏",
                phone, "iso_not_in_offered_list",
                config=config, alert=True, pet_name=pet_name,
                extra={"slot_iso": slot_iso},
            )
        book_result = tools.book_slot_tool(
            config=config, session=session, iso_datetime=slot_iso,
            pet_id=pet_id, patient_id=patient_id, pet_name=pet_name,
            vaccine_name=vaccine_name, treatment_id=treatment_id,
            calendar_id=calendar_id, duration_min=duration_min,
        )
        if book_result.get("ok"):
            event_id = book_result.get("event_id", 0)
            simulated = book_result.get("simulated")
            _log_event(phone, "llm_booked", book_result)
            if not reply or "נקבע" not in reply:
                reply = f"נקבע תור ל{pet_name} ביום {slot_iso[:10]} בשעה {slot_iso[11:16]} 🐾"
            if simulated and "[הדמיה]" not in reply:
                reply = "[הדמיה] " + reply
            ctx["last_offered_slot"] = None
            _append_and_save(session, ctx, history, text, reply, "DONE")
            return {"reply": reply, "state": "DONE", "action": "booked", "event_id": event_id}

        err = book_result.get("error", "unknown")
        _log_event(phone, "llm_book_failed", {"error": err, "slot_iso": slot_iso})
        if err == "slot_taken":
            reply = "סליחה, הסלוט הזה כבר נתפס 😓 רוצים שאציע אחר?"
            _append_and_save(session, ctx, history, text, reply, "ASK")
            return {"reply": reply, "state": "ASK", "action": "slot_taken"}
        if err == "rate_limited":
            reply = "יש לך כבר תורים רבים השבוע. צור קשר: 035513649"
            _append_and_save(session, ctx, history, text, reply, "DONE")
            return {"reply": reply, "state": "DONE", "action": "rate_limited"}
        if err == "not_in_working_hours":
            reply = "השעה שבחרת מחוץ לשעות הפעילות. רוצים זמן אחר?"
            _append_and_save(session, ctx, history, text, reply, "ASK")
            return {"reply": reply, "state": "ASK", "action": "out_of_hours"}
        return _handoff(
            session, ctx, text, history,
            "מצטערים, יש בעיה טכנית בקביעת התור. מישהו מהצוות יחזור אליך 🙏",
            phone, "book_error", config=config, alert=True, pet_name=pet_name,
            extra={"book_err": err},
        )

    # Non-booking actions
    state_map = {
        "offer_slot": "OFFER",
        "ask_question": "ASK",
        "handoff": "HANDOFF",
        "no_appointment": "DONE",
        "done": "DONE",
    }
    new_state = state_map.get(action, "ASK")

    if not reply:
        reply = "איך אפשר לעזור לך עם התור?"

    if getattr(config, "mode", "live") == "dry_run" and "[הדמיה]" not in reply:
        reply = "[הדמיה] " + reply

    if slot_iso:
        # Only cache offered slot if it's from the list — otherwise
        # a hallucinated ISO sneaks into history and gets booked on next "כן".
        if slot_iso in valid_isos:
            ctx["last_offered_slot"] = slot_iso
        else:
            _log_event(phone, "llm_offered_iso_not_in_list", {
                "slot_iso": slot_iso,
                "valid_count": len(valid_isos),
            })
            # BUG FIX: Do not send LLM reply with invalid slot to customer.
            # Replace with safe fallback; stay in ASK so next msg re-fetches slots.
            reply = "אנא המתן, אני בודק שוב את הזמנים הפנויים..."
            if getattr(config, 'mode', 'live') == 'dry_run':
                reply = '[הדמיה] ' + reply
            new_state = "ASK"
    _append_and_save(session, ctx, history, text, reply, new_state)

    if action == "handoff":
        try:
            from shared import whatsapp_sender as wa_gateway
            if getattr(config, "alert_on_handoff", False) and getattr(config, "team_alert_phone", None):
                MEDICAL_KW = [
                    "מקיא", "הקיא", "משלשל", "שלשול", "חולה", "אפתי", "אפטי",
                    "לא אוכל", "לא שותה", "לא מרגיש", "כאב", "כואב", "חום",
                    "פציעה", "נפצע", "דם", "מדמם", "נפיחות", "נפוח",
                    "קשיי נשימה", "נושם", "צולע", "לא זז", "רועד", "עייף"
                ]
                tl = (text or "").lower()
                is_medical = any(kw in tl for kw in MEDICAL_KW)
                header = "🚨 *רפואי דחוף*" if is_medical else "🔔 *handoff*"
                alert_msg = (
                    f"{header}\n"
                    f"לקוח: {customer_name or '—'}\n"
                    f"טלפון: {phone}\n"
                    f"חיה: {pet_name}\n"
                    f"ההודעה שלו: \"{text[:200]}\"\n"
                    f"👉 חזור אליו בהקדם"
                )
                wa_gateway.send(
                    to=config.team_alert_phone,
                    message=alert_msg,
                    category="alert",
                    agent="appointment_booker",
                )
        except Exception:
            log.exception("[agent_brain] alert send failed")

    return {"reply": reply, "state": new_state, "action": action}
