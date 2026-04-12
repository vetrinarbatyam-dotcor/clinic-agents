"""
Router for appointment_booker — thin dispatch to the LLM brain.

Every incoming WhatsApp turn goes through `handle_message`, which:
  1. enforces enable/test-mode/debounce gates,
  2. hydrates (or creates) a session, promoting outbound-queue context into
     it via the "fast path" when the client is replying to a reminder,
  3. short-circuits on hard-coded universal exits (cancel / handoff keywords),
  4. delegates the conversation to `agent_brain.process_message` (Claude
     headless) — async by default (returns immediately, worker sends reply),
     or sync when called from the /test endpoint.
"""
import json
import logging
import threading
from typing import Optional

from db import query, execute
from shared.session_manager import get_active_session, create_session, update_session
from shared import whatsapp_sender as wa_gateway
from agents.appointment_booker import config as cfg_mod

log = logging.getLogger(__name__)

# Terminal session labels that `handle_message` treats specially. Other legacy
# state strings (NEW/IDENTIFY/SHOW_SLOTS/...) may still appear on rows from
# before the cleanup — we just pass them through as-is.
S_HANDOFF = "HANDOFF"
S_DONE = "DONE"


def _ctx(session: dict) -> dict:
    c = session.get("context") or {}
    if isinstance(c, str):
        try:
            c = json.loads(c)
        except Exception:
            c = {}
    return c


def _log_event(event_type: str, phone: str, details: dict):
    try:
        execute("""
            INSERT INTO appt_booker_runs (event_type, phone, details)
            VALUES (%s, %s, %s::jsonb)
        """, (event_type, phone, json.dumps(details, default=str)))
    except Exception as e:
        log.error("[appt_booker] log_event failed: %s", e)


def _outbound_pending(phone: str) -> Optional[dict]:
    rows = query("""
        SELECT * FROM appt_booker_outbound_queue
        WHERE phone = %s AND status IN ('sent','pending')
          AND (sent_at IS NULL OR sent_at > NOW() - INTERVAL '48 hours')
        ORDER BY id DESC LIMIT 1
    """, (phone,))
    return rows[0] if rows else None


def _update_outbound_response(phone, response_text, new_status=None):
    """Mark the latest outbound queue entry as responded by the client."""
    try:
        if new_status:
            execute("""
                UPDATE appt_booker_outbound_queue
                SET status = %s, responded_at = NOW(), last_response = %s
                WHERE phone = %s AND status IN ('sent', 'sent_again')
                  AND id = (SELECT id FROM appt_booker_outbound_queue
                            WHERE phone = %s AND status IN ('sent', 'sent_again')
                            ORDER BY id DESC LIMIT 1)
            """, (new_status, (response_text or "")[:200], phone, phone))
        else:
            execute("""
                UPDATE appt_booker_outbound_queue
                SET responded_at = NOW(), last_response = %s
                WHERE phone = %s AND status IN ('sent', 'sent_again')
                  AND id = (SELECT id FROM appt_booker_outbound_queue
                            WHERE phone = %s AND status IN ('sent', 'sent_again')
                            ORDER BY id DESC LIMIT 1)
            """, ((response_text or "")[:200], phone, phone))
    except Exception as e:
        log.error("[appt_booker] update_outbound_response failed: %s", e)


def _send(phone: str, text: str, category: str = "booking", customer: str = ""):
    """Central WhatsApp gateway send with test-mode allowlist enforcement.

    SAFETY: When `test_mode_use_staff_clients` is on, silently block any
    outbound that targets a phone outside `allowed_test_phones`.
    """
    try:
        _cfg = cfg_mod.load_config()
        if _cfg.test_mode_use_staff_clients and phone not in (_cfg.allowed_test_phones or []):
            log.warning("[appt_booker] BLOCKED send to non-test phone %s (test_mode is on)", phone)
            _log_event("blocked_send_test_mode", phone, {"text": text[:80]})
            return {"blocked": True, "reason": "test_mode_phone_not_allowed"}
    except Exception as _e:
        log.error("[appt_booker] safety check failed: %s", _e)
    return wa_gateway.send(to=phone, message=text, category=category,
                           customer=customer, agent="appointment_booker")


def handoff(session: dict, config) -> str:
    """Move a session into HANDOFF state and notify the team if configured."""
    update_session(session["id"], state=S_HANDOFF)
    if config.alert_on_handoff:
        try:
            _send(config.team_alert_phone, f"🔔 [appt_booker] handoff מ-{session['phone']}")
        except Exception:
            pass
    return config.handoff_text


def _process_llm(session, text, config, outbound_info, phone) -> dict:
    """Run the LLM brain synchronously and return the result.

    Used directly by `handle_message(sync=True)` (/test endpoint) and by
    the async worker thread for production webhooks.
    """
    try:
        from agents.appointment_booker import agent_brain
        result = agent_brain.process_message(session, text, config, outbound_info)

        # Update outbound queue if booked
        if result.get("action") == "booked":
            try:
                _update_outbound_response(phone, text, new_status="booked")
                event_id = result.get("event_id", 0)
                if event_id:
                    execute("""
                        UPDATE appt_booker_outbound_queue
                        SET booked_event_id = %s
                        WHERE phone = %s
                          AND id = (SELECT id FROM appt_booker_outbound_queue
                                    WHERE phone = %s ORDER BY id DESC LIMIT 1)
                    """, (event_id, phone, phone))
            except Exception as _e:
                log.error("[appt_booker] queue update failed: %s", _e)
        return result
    except Exception as e:
        log.exception("[appt_booker] LLM brain error")
        _log_event("error_llm_brain", phone, {"error": str(e)[:300], "text": text[:80]})
        if config.alert_on_error:
            try:
                _send(config.team_alert_phone, f"⚠️ [appt_booker] LLM brain crash {phone}: {str(e)[:120]}")
            except Exception:
                pass
        update_session(session["id"], state=S_HANDOFF)
        return {"reply": handoff(session, config), "state": S_HANDOFF, "action": "error_llm"}


def _async_worker(session, text, config, outbound_info, phone):
    """Background thread: call LLM, then send the reply via WhatsApp."""
    try:
        result = _process_llm(session, text, config, outbound_info, phone)
        reply = result.get("reply")
        if reply:
            if config.test_mode_use_staff_clients and phone not in (config.allowed_test_phones or []):
                log.warning("[appt_booker] worker: BLOCKED reply to %s (not in allowed_test_phones)", phone)
            else:
                _send(phone, reply)
        _log_event("async_worker_done", phone, {
            "state": result.get("state"),
            "action": result.get("action"),
            "had_reply": bool(reply),
        })
    except Exception as e:
        log.exception("[appt_booker] async_worker crashed for %s", phone)
        _log_event("async_worker_error", phone, {"error": str(e)[:300]})


def _prepare_session(phone: str, config):
    """Gate checks + session hydration. Shared by sync & async paths.

    Returns (session, outbound_info) on success, or (None, result_dict)
    if the message should be short-circuited (disabled, blocked, debounced,
    terminal state).
    """
    if not config.enabled:
        _log_event("ignored_disabled", phone, {"text": ""})
        return None, {"reply": None, "state": "DISABLED", "action": "ignored"}

    if config.test_mode_use_staff_clients and phone not in config.allowed_test_phones:
        _log_event("ignored_not_allowed", phone, {"text": ""})
        return None, {"reply": None, "state": "BLOCKED", "action": "ignored_test_mode"}

    # Debounce
    try:
        recent = query("""
            SELECT EXTRACT(EPOCH FROM (NOW() - last_msg_at)) AS sec_ago
            FROM appt_booker_sessions
            WHERE phone = %s AND last_msg_at IS NOT NULL
            ORDER BY id DESC LIMIT 1
        """, (phone,))
        if recent and recent[0].get("sec_ago") is not None and float(recent[0]["sec_ago"]) < 2:
            _log_event("debounced", phone, {"sec_ago": float(recent[0]["sec_ago"])})
            return None, {"reply": None, "state": "DEBOUNCED", "action": "debounced"}
    except Exception as _e:
        log.warning("[appt_booker] debounce check failed: %s", _e)

    session = get_active_session(phone)

    if not session:
        outbound = _outbound_pending(phone)
        path = "fast" if outbound else "advisor"
        session = create_session(phone, ttl_min=config.session_ttl_min, path=path)
        if outbound:
            ctx = {"outbound_id": outbound["id"], "treatment_key": outbound["treatment_key"]}
            if outbound.get("vaccine_name"):
                ctx["outbound_vaccine_name"] = outbound.get("vaccine_name")
            if outbound.get("vaccine_category"):
                ctx["outbound_vaccine_category"] = outbound.get("vaccine_category")
                _cat_obj = config.vaccine_categories.get(outbound.get("vaccine_category"))
                if _cat_obj:
                    ctx["detected_duration"] = _cat_obj.duration_min
                    ctx["vaccine_category"] = outbound.get("vaccine_category")
            if outbound.get("pet_id"):
                ctx["outbound_pet_id"] = outbound.get("pet_id")
            if outbound.get("pet_name"):
                ctx["outbound_pet_name"] = outbound.get("pet_name")
            if outbound.get("patient_id"):
                ctx["patient_id"] = str(outbound.get("patient_id"))
            update_session(session["id"], context=ctx, treatment_key=outbound["treatment_key"],
                           patient_id=outbound.get("patient_id"),
                           pet_ids=[outbound["pet_id"]] if outbound.get("pet_id") else None)
            session = get_active_session(phone)

    state = session.get("state")
    if state in (S_HANDOFF, S_DONE, "HANDOFF", "DONE"):
        _log_event("ignored_terminal_state", phone, {"state": state})
        return None, {"reply": None, "state": state, "action": "ignored_terminal"}

    # Build outbound_info
    ctx = _ctx(session)
    outbound_info = {
        "customer_name": "לקוח",
        "pet_name": ctx.get("outbound_pet_name") or "החיה",
        "vaccine_name": ctx.get("outbound_vaccine_name") or "משושה",
        "pet_id": ctx.get("outbound_pet_id"),
        "patient_id": session.get("patient_id") or ctx.get("patient_id"),
        "treatment_id": 3338,
        "duration_min": ctx.get("detected_duration") or config.vaccine_default_duration_min,
    }
    vac_profile = config.profiles.get("vaccine")
    if vac_profile:
        outbound_info["calendar_id"] = vac_profile.calendar_id
        outbound_info["treatment_id"] = vac_profile.treatment_id

    if outbound_info.get("patient_id"):
        try:
            from clinica import appointments as _appt
            clients = _appt.search_by_phone(phone)
            if clients:
                c = clients[0]
                fn = (c.get("FirstName") or "").strip()
                ln = (c.get("LastName") or "").strip()
                nm = (fn + " " + ln).strip()
                if nm:
                    outbound_info["customer_name"] = nm
        except Exception:
            pass

    return session, outbound_info


def handle_message(phone: str, text: str, *, sync: bool = False) -> dict:
    """Main entry point.

    Args:
        phone: normalized Israeli phone (0XXXXXXXXX).
        text: incoming message text.
        sync: if True, block until LLM responds and return the reply
              (used by /test endpoint). Default False = fire-and-forget
              (webhook returns immediately, worker sends reply later).
    """
    config = cfg_mod.load_config()

    session, early = _prepare_session(phone, config)
    if session is None:
        return early  # gate check short-circuit

    # Universal exits — hard keyword shortcuts, no LLM needed
    text_lower = (text or "").strip().lower()
    if text_lower in ("ביטול", "cancel", "stop"):
        update_session(session["id"], state=S_DONE)
        reply = "ביטלתי. תמיד אפשר לפנות שוב 🙏"
        if not sync:
            _send(phone, reply)
        return {"reply": reply, "state": S_DONE, "action": "cancelled"}
    if text_lower in ("נציג", "צוות", "human"):
        reply = handoff(session, config)
        if not sync:
            _send(phone, reply)
        return {"reply": reply, "state": S_HANDOFF, "action": "handoff"}

    outbound_info = early  # from _prepare_session (when session is not None, early = outbound_info)

    if sync:
        # /test endpoint — block and return full result
        return _process_llm(session, text, config, outbound_info, phone)

    # Production path — fire and forget, worker sends reply via WhatsApp
    thread = threading.Thread(
        target=_async_worker,
        args=(session, text, config, outbound_info, phone),
        name=f"appt-worker-{phone}",
        daemon=True,
    )
    thread.start()
    return {"reply": None, "state": "PROCESSING", "action": "queued_for_llm"}
