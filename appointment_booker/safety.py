"""
book_with_lock — the core safety primitive.
Working hours, rate limit, advisory lock, double-check, shadow mode, double-verify.
"""
import contextlib
import json
import logging
from datetime import datetime, timedelta
from db import execute

from shared.working_hours import is_within_working_hours
from shared.rate_limiter import check_rate_limit
from shared.slot_lock import slot_lock_id, pg_advisory_lock
from clinica import appointments as appt

log = logging.getLogger(__name__)


class BookingError(Exception): ...
class NotInWorkingHoursError(BookingError): ...
class SlotTakenError(BookingError): ...
class RateLimitError(BookingError): ...
class TestModeBlockedError(BookingError): ...


def _log_run(event_type: str, phone: str, details: dict):
    try:
        execute("""
            INSERT INTO appt_booker_runs (event_type, phone, details)
            VALUES (%s, %s, %s::jsonb)
        """, (event_type, phone, json.dumps(details, default=str)))
    except Exception as e:
        log.error("[appt_booker] failed to log run: %s", e)


def book_with_lock(
    *,
    config,
    treatment_key: str,
    therapist_id: str,
    patient_id: str,
    pet_ids: list,
    begin: datetime,
    duration_min: int,
    description: str,
    cellphone: str,
    notes: str,
    treatment_id: int,
    phone_for_rate_limit: str,
    insurance_name: str = "",
) -> dict:
    """
    Returns: {event_id, simulated, ...}
    Raises: BookingError subclasses on failure.
    """
    end = begin + timedelta(minutes=duration_min)

    # Test mode allowlist
    if config.test_mode_use_staff_clients and phone_for_rate_limit not in config.allowed_test_phones:
        raise TestModeBlockedError(f"phone {phone_for_rate_limit} not in test allowlist")

    # 1. Working hours (skipped in test mode if test_mode_outside_work_hours)
    if not (config.test_mode_use_staff_clients and config.test_mode_outside_work_hours):
        if not is_within_working_hours(begin, duration_min, config):
            raise NotInWorkingHoursError(f"{begin} not within working hours")

    # 2. Rate limit
    if config.rate_limit_enabled:
        rl = check_rate_limit(phone_for_rate_limit, config.alert_threshold, config.block_threshold)
        if not rl["allowed"]:
            raise RateLimitError(f"rate limit hit: {rl['count']} bookings this week")

    # 3. Advisory lock + double-check + create
    lock_id = slot_lock_id(therapist_id, begin.strftime("%Y-%m-%d"), begin.strftime("%H:%M"))
    cm = pg_advisory_lock(lock_id) if config.advisory_lock else contextlib.nullcontext()

    with cm:
        # 4. Re-check slot is free INSIDE lock
        if config.double_check_after_lock:
            day_str = begin.strftime("%Y-%m-%d")
            events = appt.get_day_events(therapist_id, day_str) or []
            for ev in events:
                if appt.overlaps(ev, begin, end):
                    raise SlotTakenError(f"slot {begin} already taken")

        # 5. Build CalEvent
        cal_event = appt.build_cal_event(
            calendar_id=therapist_id,
            patient_id=patient_id,
            pet_id=pet_ids[0] if pet_ids else 0,
            description=description,
            begin=begin,
            end=end,
            notes=notes,
            cellphone=cellphone,
            treatment_id=treatment_id,
            insurance_name=insurance_name,
        )

        # 6. Shadow / dry_run
        if config.mode != "live":
            _log_run("shadow_book", phone_for_rate_limit, {
                "treatment_key": treatment_key,
                "begin": begin,
                "duration_min": duration_min,
                "patient_id": patient_id,
                "pet_ids": pet_ids,
                "mode": config.mode,
            })
            execute("""
                INSERT INTO appt_booker_appointments
                    (treatment_key, event_id, phone, patient_id, pet_ids,
                     therapist_id, scheduled_at, duration_min, simulated, notes)
                VALUES (%s, 0, %s, %s, %s, %s, %s, %s, TRUE, %s)
            """, (treatment_key, phone_for_rate_limit, patient_id, pet_ids,
                  therapist_id, begin, duration_min, f"[{config.mode}] {notes}"))
            return {"event_id": 0, "simulated": True, "mode": config.mode}

        # 7. Live: CreateEvent (Expanded MUST be int 0!)
        result = appt.create_event(cal_event)
        event_id = (result or {}).get("EventID") or 0
        if not event_id:
            raise BookingError(f"CreateEvent returned no EventID: {result}")

        # 8. Double-verify
        if config.double_check_after_lock:
            verify = appt.get_event(event_id)
            if not verify:
                raise BookingError(f"verification failed for event {event_id}")

        # 9. Record in our DB
        execute("""
            INSERT INTO appt_booker_appointments
                (treatment_key, event_id, phone, patient_id, pet_ids,
                 therapist_id, scheduled_at, duration_min, simulated, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FALSE, %s)
        """, (treatment_key, event_id, phone_for_rate_limit, patient_id, pet_ids,
              therapist_id, begin, duration_min, notes))

        _log_run("live_book", phone_for_rate_limit, {
            "event_id": event_id,
            "treatment_key": treatment_key,
            "begin": begin,
        })
        return {"event_id": event_id, "simulated": False, "mode": "live"}
