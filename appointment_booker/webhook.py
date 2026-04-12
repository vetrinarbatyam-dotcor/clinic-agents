"""
FastAPI router for appointment_booker.
- POST /webhook   — Green API incoming message webhook
- GET  /config    — current config
- POST /config    — update config (dashboard)
- GET  /status    — quick status
- GET  /runs      — recent runs (dashboard)
- POST /test      — send a test message through state machine (no Green API send)
- POST /reset_session — clear active session for a phone
"""
import json
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from db import query, execute
from agents.appointment_booker import config as cfg_mod
from agents.appointment_booker import state_machine

log = logging.getLogger(__name__)

router = APIRouter()


def _normalize_phone(chat_id: str) -> str:
    """972543123419@c.us → 0543123419"""
    digits = "".join(c for c in chat_id if c.isdigit())
    if digits.startswith("972"):
        return "0" + digits[3:]
    return digits


@router.post("/webhook")
async def webhook(request: Request):
    """Green API incoming message webhook."""
    try:
        body = await request.json()
    except Exception:
        body = {}

    type_ = body.get("typeWebhook", "")
    if type_ != "incomingMessageReceived":
        return {"status": "ignored", "type": type_}

    sender_data = body.get("senderData", {}) or {}
    msg_data = body.get("messageData", {}) or {}
    text_msg = (msg_data.get("textMessageData") or {}).get("textMessage", "")
    extended = (msg_data.get("extendedTextMessageData") or {}).get("text", "")
    text = text_msg or extended or ""

    chat_id = sender_data.get("chatId", "")
    phone = _normalize_phone(chat_id)

    if not phone or not text:
        return {"status": "ignored", "reason": "missing_phone_or_text"}

    log.info("[appt_booker] incoming from %s: %s", phone, text[:80])

    # Record this incoming message in the gateway so future sends to this phone
    # are auto-classified as reply (within 24h) or warm (after 24h).
    try:
        from shared import whatsapp_sender as wa_gateway
        wa_gateway.record_incoming(phone, agent="appointment_booker", snippet=text)
    except Exception as e:
        log.error("[appt_booker] record_incoming failed: %s", e)

    # Async: handle_message queues LLM work to a background worker and
    # returns immediately.  The worker sends the reply via WhatsApp when done.
    # This keeps the webhook response fast so Green API doesn't retry.
    result = state_machine.handle_message(phone, text)

    return {"status": "ok", "state": result.get("state"), "action": result.get("action")}


@router.get("/config")
async def get_config():
    cfg = cfg_mod.load_config()
    return cfg.model_dump()


class ConfigUpdate(BaseModel):
    config: dict
    updated_by: Optional[str] = "dashboard"


@router.post("/config")
async def update_config(payload: ConfigUpdate):
    try:
        cfg = cfg_mod.AppointmentBookerConfig(**payload.config)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid config: {e}")
    cfg_mod.save_config(cfg, updated_by=payload.updated_by or "dashboard")
    return {"status": "ok", "config": cfg.model_dump()}


@router.get("/status")
async def status():
    cfg = cfg_mod.load_config()
    sessions = query("""
        SELECT COUNT(*) AS c FROM appt_booker_sessions WHERE expires_at > NOW()
    """)
    appts = query("""
        SELECT COUNT(*) AS c FROM appt_booker_appointments
        WHERE booked_at > NOW() - INTERVAL '7 days'
    """)
    runs = query("""
        SELECT COUNT(*) AS c FROM appt_booker_runs
        WHERE created_at > NOW() - INTERVAL '24 hours'
    """)
    return {
        "enabled": cfg.enabled,
        "mode": cfg.mode,
        "active_sessions": sessions[0]["c"] if sessions else 0,
        "appointments_last_7d": appts[0]["c"] if appts else 0,
        "runs_last_24h": runs[0]["c"] if runs else 0,
        "profiles_enabled": [k for k, p in cfg.profiles.items() if p.enabled],
    }


@router.get("/runs")
async def runs(limit: int = 50):
    rows = query("""
        SELECT id, event_type, phone, details, created_at
        FROM appt_booker_runs
        ORDER BY created_at DESC LIMIT %s
    """, (limit,))
    return {"runs": rows}


@router.get("/appointments")
async def appointments(limit: int = 50):
    rows = query("""
        SELECT id, treatment_key, event_id, phone, scheduled_at,
               duration_min, simulated, status, booked_at
        FROM appt_booker_appointments
        ORDER BY booked_at DESC LIMIT %s
    """, (limit,))
    return {"appointments": rows}


class TestMessage(BaseModel):
    phone: str
    text: str


@router.post("/test")
async def test_message(payload: TestMessage):
    """Run a message through the LLM brain synchronously (for testing/dashboard)."""
    result = state_machine.handle_message(payload.phone, payload.text, sync=True)
    return result


class ResetSession(BaseModel):
    phone: str


@router.post("/reset_session")
async def reset_session(payload: ResetSession):
    execute("""
        UPDATE appt_booker_sessions SET expires_at = NOW()
        WHERE phone = %s AND expires_at > NOW()
    """, (payload.phone,))
    return {"status": "ok"}


@router.get("/therapists")
async def therapists():
    """List all therapists/calendars from ClinicaOnline."""
    from clinica.appointments import get_therapists
    try:
        data = get_therapists()
        return {"therapists": [
            {"id": t.get("TherapistID", ""), "name": t.get("TherapistName", "")}
            for t in data
        ]}
    except Exception as e:
        return {"error": str(e), "therapists": []}


@router.get("/waiting_list")
async def waiting_list(status: str = "waiting", limit: int = 100):
    """Get waiting list entries."""
    rows = query("""
        SELECT id, vaccine_name, phone, patient_id, pet_ids, pet_names, notes,
               created_at, notified_at, status
        FROM appt_booker_waiting_list
        WHERE status = %s
        ORDER BY created_at DESC
        LIMIT %s
    """, (status, limit))
    return {"waiting_list": rows}


@router.get("/waiting_list/summary")
async def waiting_list_summary():
    """Group waiting list by vaccine."""
    rows = query("""
        SELECT vaccine_name, COUNT(*) AS count
        FROM appt_booker_waiting_list
        WHERE status = 'waiting'
        GROUP BY vaccine_name
        ORDER BY count DESC
    """)
    return {"summary": rows}


class NotifyWaitingList(BaseModel):
    vaccine_name: str
    custom_message: Optional[str] = None


@router.post("/waiting_list/notify")
async def notify_waiting_list(payload: NotifyWaitingList):
    """Send 'back in stock' notification to all clients waiting for a specific vaccine."""
    cfg = cfg_mod.load_config()
    msg = payload.custom_message or cfg.out_of_stock_back_in_stock_message

    rows = query("""
        SELECT id, phone FROM appt_booker_waiting_list
        WHERE vaccine_name = %s AND status = 'waiting'
    """, (payload.vaccine_name,))

    sent = 0
    failed = 0
    from shared import whatsapp_sender as wa_gateway

    for row in rows:
        try:
            wa_gateway.send(
                to=row["phone"],
                message=msg,
                category="reminder",
                agent="appointment_booker",
            )
            execute("""
                UPDATE appt_booker_waiting_list
                SET status = 'notified', notified_at = NOW()
                WHERE id = %s
            """, (row["id"],))
            sent += 1
        except Exception as e:
            log.error("[appt_booker] notify failed for %s: %s", row["phone"], e)
            failed += 1

    return {"vaccine": payload.vaccine_name, "sent": sent, "failed": failed, "total": len(rows)}


class RemoveFromWaitingList(BaseModel):
    id: int


@router.post("/waiting_list/remove")
async def remove_from_waiting_list(payload: RemoveFromWaitingList):
    """Mark a waiting list entry as cancelled."""
    execute("""
        UPDATE appt_booker_waiting_list
        SET status = 'cancelled'
        WHERE id = %s
    """, (payload.id,))
    return {"status": "ok"}



@router.get("/outbound_queue")
async def outbound_queue(status: Optional[str] = None, limit: int = 100):
    where = ""
    params = []
    if status:
        where = "WHERE status = %s"
        params.append(status)
    rows = query(f"""
        SELECT id, phone, pet_id, pet_name, vaccine_name, vaccine_category,
               item_type, due_date, sent_at, status, snoozed_until, snooze_count,
               needs_callback, last_response, responded_at
        FROM appt_booker_outbound_queue
        {where}
        ORDER BY id DESC LIMIT %s
    """, tuple(params + [limit]))
    return {"queue": rows}


@router.get("/outbound_queue/stats")
async def outbound_queue_stats():
    rows = query("""
        SELECT 
            status, 
            COUNT(*) AS count
        FROM appt_booker_outbound_queue
        WHERE sent_at > NOW() - INTERVAL '60 days'
        GROUP BY status
    """)
    summary = {r["status"]: r["count"] for r in rows}
    total = sum(summary.values())
    booked = summary.get("booked", 0)
    conversion = round(100 * booked / total, 1) if total else 0
    return {
        "summary": summary,
        "total": total,
        "conversion_rate": conversion,
    }
