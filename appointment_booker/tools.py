"""Tools available to the LLM agent."""
from datetime import datetime, timedelta
import logging

from clinica import appointments as appt
from agents.appointment_booker import safety
from shared.working_hours import get_windows_for_day, next_working_days

log = logging.getLogger(__name__)

# Python weekday(): 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun
HEBREW_DAYS = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"]


def get_free_slots(calendar_id: str, config, days: int = 7, duration_min: int = 20) -> list:
    """Pre-fetch free slots for the next N working days.
    Returns list of dicts: {iso, day_name_he, date_str, time_str, weekday, hour}.
    """
    today = datetime.now().date()
    days_list = next_working_days(today, days, config)
    all_slots = []
    for d in days_list:
        windows = get_windows_for_day(d, config.working_days)
        if not windows:
            continue
        try:
            # Call find_free_slots per window so we don't run out of budget
            # on the morning window and miss evening slots.
            slots = []
            for win in windows:
                win_slots = appt.find_free_slots(
                    calendar_id,
                    datetime.combine(d, datetime.min.time()),
                    duration_min,
                    [win],
                    max_slots=12,
                )
                slots.extend(win_slots)
        except Exception as e:
            log.error("[tools] find_free_slots failed for %s: %s", d, e)
            continue
        for s in slots:
            all_slots.append({
                "iso": s.isoformat(),
                "day_name_he": HEBREW_DAYS[s.weekday()],
                "date_str": s.strftime("%d/%m"),
                "time_str": s.strftime("%H:%M"),
                "weekday": s.weekday(),
                "hour": s.hour,
            })
    return all_slots


def _lookup_owner_insurance(patient_id: str, pet_id: int) -> dict:
    """Fetch owner last_name + insurance_name from local synced DB.

    Fast path for enriching calendar events — not super-fresh but good enough.
    Returns {} if not found or on error.
    """
    try:
        from db import query
        out = {}
        if patient_id:
            rows = query("SELECT first_name, last_name FROM clients WHERE user_id=%s LIMIT 1",
                         (str(patient_id),))
            if rows:
                out["owner_first_name"] = (rows[0].get("first_name") or "").strip()
                out["owner_last_name"] = (rows[0].get("last_name") or "").strip()
        if pet_id:
            rows = query("SELECT insurance_name FROM pets WHERE pet_id=%s LIMIT 1", (int(pet_id),))
            if rows:
                out["insurance_name"] = (rows[0].get("insurance_name") or "").strip()
        return out
    except Exception as e:
        log.warning("[tools] owner/insurance lookup failed: %s", e)
        return {}


def book_slot_tool(config, session: dict, iso_datetime: str, pet_id: int, patient_id: str,
                   pet_name: str, vaccine_name: str, treatment_id: int, calendar_id: str,
                   duration_min: int) -> dict:
    """Book a slot via safety.book_with_lock. Returns {ok, event_id?, simulated?, error?}."""
    try:
        begin = datetime.fromisoformat(iso_datetime)
        enrich = _lookup_owner_insurance(patient_id, pet_id)
        owner_last = enrich.get("owner_last_name") or ""
        insurance = enrich.get("insurance_name") or ""
        # Description shown prominently in calendar view
        description = f"{pet_name} - {owner_last}" if owner_last else pet_name
        notes_parts = [vaccine_name]
        if insurance:
            notes_parts.append(f"ביטוח: {insurance}")
        notes_parts.append("[AUTO-LLM]")
        notes = " | ".join(notes_parts)
        result = safety.book_with_lock(
            config=config,
            treatment_key="vaccine",
            therapist_id=calendar_id,
            patient_id=patient_id,
            pet_ids=[pet_id],
            begin=begin,
            duration_min=duration_min,
            description=description,
            cellphone=session["phone"],
            notes=notes,
            treatment_id=treatment_id,
            phone_for_rate_limit=session["phone"],
            insurance_name=insurance,
        )
        return {
            "ok": True,
            "event_id": result.get("event_id", 0),
            "simulated": result.get("simulated", False),
        }
    except safety.SlotTakenError:
        return {"ok": False, "error": "slot_taken"}
    except safety.RateLimitError:
        return {"ok": False, "error": "rate_limited"}
    except safety.NotInWorkingHoursError:
        return {"ok": False, "error": "not_in_working_hours"}
    except Exception as e:
        log.exception("[llm_agent] book error")
        return {"ok": False, "error": str(e)[:200]}
