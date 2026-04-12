"""
appointment_booker config — generic with treatment profiles.
Loaded from agent_configs table (JSONB). Defaults defined here.
"""
import json
from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field
from db import query, execute


AGENT_NAME = "appointment_booker"


class TreatmentProfile(BaseModel):
    """One bookable treatment type (vaccine, checkup, surgery, ...)."""
    name: str
    treatment_id: int
    calendar_id: str
    duration_min: int = 10
    double_slot_threshold_pets: int = 3
    double_slot_duration_min: int = 20
    requires_team_approval: bool = False
    enabled: bool = False
    keywords: List[str] = []



class VaccineCategory(BaseModel):
    """Classification rule for vaccine duration."""
    keywords: List[str] = []
    duration_min: int = 10
    description: str = ""
    message: str = ""  # only for no_appointment category

class ReminderRule(BaseModel):
    """Rule for when to send a proactive vaccine reminder."""
    enabled: bool = True
    label: str = ""              # Human-readable name (e.g., "חיסון משושה")
    treatment_id: int = 0        # ClinicaOnline treatment ID (0 = match by keyword)
    keywords: List[str] = []     # Match vaccine name by keywords if treatment_id=0
    days_before: int = 14        # Send reminder this many days before due
    description: str = ""        # Optional notes
    # NEW: Retry/snooze settings
    retry_enabled: bool = True       # If client doesn't book, try again
    retry_after_days: int = 10       # Wait N days before retrying
    max_retries: int = 2             # Maximum number of follow-up reminders


class OutOfStockItem(BaseModel):
    """A vaccine/item that is currently out of stock — clients get added to waiting list."""
    name: str = ""              # Display name (e.g., "משושה")
    keywords: List[str] = []    # Match in client message
    enabled: bool = False       # True = currently out of stock
    out_of_stock_message: str = ""  # Custom message, falls back to default


class AppointmentBookerConfig(BaseModel):
    # State
    enabled: bool = False
    # LLM hybrid mode
    llm_enabled: bool = True
    llm_min_confidence: float = 0.6  # below this, fall back to template
    llm_timeout_sec: int = 8
    mode: Literal["shadow", "dry_run", "live"] = "shadow"

    # Treatment profiles — vaccine active, others ready to enable
    profiles: Dict[str, TreatmentProfile] = Field(default_factory=lambda: {
        "vaccine": TreatmentProfile(
            name="חיסון",
            treatment_id=3338,
            calendar_id="e0bd1141-ac5d-4703-8e92-93cf5dad9b06",
            duration_min=10,
            double_slot_threshold_pets=3,
            double_slot_duration_min=20,
            enabled=True,
            keywords=["חיסון", "חיסונים", "משושה", "כלבת", "אנפלוקסיס"],
        ),
        "checkup": TreatmentProfile(
            name="בדיקה וטרינרית",
            treatment_id=2583,
            calendar_id="",  # fill from dashboard
            duration_min=20,
            enabled=False,
            keywords=["בדיקה", "ביקורת", "checkup"],
        ),
        "surgery": TreatmentProfile(
            name="ניתוח",
            treatment_id=2582,
            calendar_id="",
            duration_min=60,
            requires_team_approval=True,
            enabled=False,
            keywords=["ניתוח", "סירוס", "עיקור"],
        ),
    })

    # Vaccine duration categories — keyword-based classification
    vaccine_categories: Dict[str, VaccineCategory] = Field(default_factory=lambda: {
        "no_appointment": VaccineCategory(
            keywords=["ברבקטו", "סימפריקא", "תילוע", "הדברה", "bravecto", "simparica"],
            duration_min=0,
            description="הדברה וכדורים — ללא ךור",
            message="היי! 🐾 בשביל הדברה וכדורים אין צורך לקבוע תור — אפשר לרכוש בכל שבות הפעילות. מחכים לכם! 😊",
        ),
        "short": VaccineCategory(
            keywords=["תולעת הפארק", "park worm"],
            duration_min=10,
            description="חיסונים פשוטים (10 דק')",
        ),
        "long": VaccineCategory(
            keywords=["משושה", "כלבת", "hexavalent", "rabies"],
            duration_min=20,
            description="חיסונים מורכבים (20 דק')",
        ),
    })
    # Vaccine reminder rules — which vaccines we proactively remind about
    reminder_rules: List[ReminderRule] = Field(default_factory=lambda: [
        ReminderRule(
            enabled=True,
            label="משושה / כלבת (חיסון שנתי)",
            treatment_id=3338,
            keywords=["משושה", "כלבת", "hexavalent", "rabies"],
            days_before=14,
            description="חיסון שנתי חובה — תזכורת 14 יום לפני"
        ),
        ReminderRule(
            enabled=False,
            label="תולעת הפארק",
            treatment_id=0,
            keywords=["תולעת הפארק", "park worm"],
            days_before=7,
            description="חיסון תולעת הפארק — תזכורת 7 יום לפני"
        ),
        ReminderRule(
            enabled=False,
            label="חיסון גורים",
            treatment_id=0,
            keywords=["גור", "puppy"],
            days_before=21,
            description="חיסונים לגורים — תזכורת 21 יום לפני"
        ),
    ])
    # Out-of-stock vaccines — clients trying to book these get added to waiting list
    out_of_stock_items: List[OutOfStockItem] = Field(default_factory=lambda: [
        OutOfStockItem(
            name="משושה",
            keywords=["משושה", "hexavalent"],
            enabled=False,
        ),
        OutOfStockItem(
            name="כלבת",
            keywords=["כלבת", "rabies"],
            enabled=False,
        ),
        OutOfStockItem(
            name="מרובע",
            keywords=["מרובע", "tetra"],
            enabled=False,
        ),
    ])
    out_of_stock_default_message: str = "היי 🐾 החיסון שביקשת חסר כרגע במלאי. הוספתי אותך לרשימת המתנה — נחזור אליך מיד כשהחיסון יגיע! 🙏"
    out_of_stock_back_in_stock_message: str = "היי! 🎉 החיסון שחיכית לו הגיע למרפאה. אפשר לקבוע תור עכשיו — שלח/י 'היי' ונקבע ביחד 💉"

    vaccine_default_duration_min: int = 20  # fallback when no keywords match

    # Availability
    days_ahead: int = 7
    max_slots_shown: int = 3
    new_client_double_slot: bool = True

    # Working hours
    working_days: dict = Field(default_factory=lambda: {
        "sunday":    {"enabled": True,  "windows": [{"start": "10:10", "end": "15:00"}, {"start": "16:00", "end": "19:30"}]},
        "monday":    {"enabled": True,  "windows": [{"start": "10:10", "end": "15:00"}, {"start": "16:00", "end": "19:30"}]},
        "tuesday":   {"enabled": True,  "windows": [{"start": "10:10", "end": "15:00"}, {"start": "16:00", "end": "19:30"}]},
        "wednesday": {"enabled": True,  "windows": [{"start": "10:10", "end": "15:00"}, {"start": "16:00", "end": "19:30"}]},
        "thursday":  {"enabled": True,  "windows": [{"start": "10:10", "end": "15:00"}, {"start": "16:00", "end": "19:30"}]},
        "friday":    {"enabled": True,  "windows": [{"start": "09:00", "end": "13:00"}]},
        "saturday":  {"enabled": False, "windows": []},
    })
    erev_chag_hours: dict = Field(default_factory=lambda: {"start": "09:00", "end": "13:00"})
    holidays_closed_only_yom_tov: bool = True

    # Identification
    identify_max_phone_attempts: int = 2
    identify_fallback_to_name_search: bool = True
    identify_update_profile_on_mismatch: bool = False

    # Limits
    session_ttl_min: int = 30
    rate_limit_enabled: bool = True
    max_bookings_per_week: int = 3
    alert_threshold: int = 2
    block_threshold: int = 3

    # Safety
    advisory_lock: bool = True
    double_check_after_lock: bool = True
    require_team_approval_for_new_clients: bool = True
    team_approval_timeout_min: int = 30

    # Test mode
    test_mode_use_staff_clients: bool = True
    test_mode_outside_work_hours: bool = True
    allowed_test_phones: List[str] = ["0543123419", "0549127030"]

    # Messages
    advisor_greeting: str = "היי! 🐾 מי מדבר ואיזו חיה?"
    advisor_multi_clients: str = "מצאתי כמה רשומות. בחר/י:\n{clients}"
    advisor_ask_alt_phone: str = "לא מצאתי אותך 🔍 איזה מספר רשום אצלנו?"
    advisor_ask_name: str = "גם זה לא נמצא 🔍 מה השם המלא שלך?"
    show_slots_template: str = "אלה הזמנים הפנויים:\n{slots}"
    # Slot UX
    ask_time_preference_text: str = "מצוין! 🐾\nמתי נוח לך לבוא? (לדוגמה: 'מחר בבוקר', 'יום שלישי בערב', או 'מתי שאפשר')"
    no_slots_at_pref_msg: str = "סליחה 😓 בזמן שביקשת היומן מלא. יש לי את הזמנים הקרובים האלה:"
    confirm_template: str = "לאשר: {pet_names} — {date} {time}?"
    success_template: str = "✅ נקבע תור {event_id}!\n{details}"
    slot_taken_msg: str = "רגע! הסלוט הזה כבר נתפס 😓 הנה חדשים: {slots}"
    rate_limit_hit: str = "יש לך כבר 3 תורים השבוע. צור קשר: 035513649"
    handoff_text: str = "תודה! פנייה נרשמה במרפאה ומישהו מהצוות יחזור אליך כשיתפנה 🙏"
    snooze_offer: str = "רוצה שאזכיר לך בעוד שבועיים?"

    # Decline followup — vaccine-reminders integration
    max_snoozes_per_client: int = 2
    decline_followup_text: str = "בסדר 🙏 רוצה שאזכיר שוב בעוד שבוע, או שמישהו מהצוות יחזור אליך?\n(תזכיר / צוות)"
    snoozed_confirmation: str = 'מצוין, אזכיר לך בעוד שבוע 🐾'
    callback_confirmation: str = 'סבבה, מישהו מהצוות יחזור אליך בקרוב 👋'

    # Cron (disabled in this round)
    outbound_enabled: bool = False
    outbound_cron: str = "30 8 * * *"
    outbound_days_before: int = 7

    # Alerts (WhatsApp, NOT Telegram)
    team_alert_phone: str = "035513649"
    alert_on_error: bool = True
    alert_on_handoff: bool = True
    alert_on_rate_limit: bool = True
    alert_on_new_client: bool = True

    # Green API
    green_api_routing: str = "first"


def load_config() -> AppointmentBookerConfig:
    rows = query("SELECT config FROM agent_configs WHERE agent_name = %s", (AGENT_NAME,))
    if rows and rows[0].get("config"):
        raw = rows[0]["config"]
        if isinstance(raw, str):
            raw = json.loads(raw)
        try:
            return AppointmentBookerConfig(**raw)
        except Exception:
            pass
    cfg = AppointmentBookerConfig()
    save_config(cfg, updated_by="system_default")
    return cfg


def save_config(cfg: AppointmentBookerConfig, updated_by: str = "api"):
    data = cfg.model_dump()
    execute("""
        INSERT INTO agent_configs (agent_name, config, updated_at, updated_by)
        VALUES (%s, %s::jsonb, NOW(), %s)
        ON CONFLICT (agent_name) DO UPDATE
        SET config = EXCLUDED.config,
            updated_at = NOW(),
            updated_by = EXCLUDED.updated_by
    """, (AGENT_NAME, json.dumps(data), updated_by))
