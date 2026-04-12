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


def book_slot_tool(config, session: dict, iso_datetime: str, pet_id: int, patient_id: str,
                   pet_name: str, vaccine_name: str, treatment_id: int, calendar_id: str,
                   duration_min: int) -> dict:
    """Book a slot via safety.book_with_lock. Returns {ok, event_id?, simulated?, error?}."""
    try:
        begin = datetime.fromisoformat(iso_datetime)
        result = safety.book_with_lock(
            config=config,
            treatment_key="vaccine",
            therapist_id=calendar_id,
            patient_id=patient_id,
            pet_ids=[pet_id],
            begin=begin,
            duration_min=duration_min,
            description=pet_name,
            cellphone=session["phone"],
            notes=f"{vaccine_name} [AUTO-LLM]",
            treatment_id=treatment_id,
            phone_for_rate_limit=session["phone"],
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
