#!/usr/bin/env python3
"""Clinic business hours classifier.

Business hours:
  Sunday–Thursday: 10:00–20:00 open
  Friday:          09:00–14:00 open
  Saturday:        closed all day

Python weekday(): 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
"""
from __future__ import annotations

from datetime import datetime, timedelta


# (open_hour, open_minute, close_hour, close_minute) or None if closed
_HOURS: dict[int, tuple[int, int, int, int] | None] = {
    0: (10, 0, 20, 0),   # Monday
    1: (10, 0, 20, 0),   # Tuesday
    2: (10, 0, 20, 0),   # Wednesday
    3: (10, 0, 20, 0),   # Thursday
    4: (9, 0, 14, 0),    # Friday
    5: None,              # Saturday — closed
    6: (10, 0, 20, 0),   # Sunday
}


def classify(dt: datetime) -> str:
    """Return 'open' or 'closed' for the given datetime."""
    hours = _HOURS.get(dt.weekday())
    if hours is None:
        return "closed"
    oh, om, ch, cm = hours
    open_time = dt.replace(hour=oh, minute=om, second=0, microsecond=0)
    close_time = dt.replace(hour=ch, minute=cm, second=0, microsecond=0)
    if open_time <= dt < close_time:
        return "open"
    return "closed"


def next_open_time(dt: datetime) -> datetime:
    """Return the next datetime when the clinic opens after dt.

    Searches up to 7 days forward.
    """
    # start from one minute after dt
    candidate = dt.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(7 * 24 * 60):  # up to 7 days by minutes
        hours = _HOURS.get(candidate.weekday())
        if hours is not None:
            oh, om, ch, cm = hours
            open_dt = candidate.replace(hour=oh, minute=om, second=0, microsecond=0)
            close_dt = candidate.replace(hour=ch, minute=cm, second=0, microsecond=0)
            if open_dt <= candidate < close_dt:
                return candidate
            # If we're before open today, return open time today
            if candidate < open_dt and candidate.date() == open_dt.date():
                return open_dt
        # advance to next day open
        next_day = (candidate + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        candidate = next_day
        # find next day with hours
        for _ in range(7):
            hours = _HOURS.get(candidate.weekday())
            if hours is not None:
                oh, om = hours[0], hours[1]
                return candidate.replace(hour=oh, minute=om, second=0, microsecond=0)
            candidate += timedelta(days=1)
    raise RuntimeError("Could not find next open time within 7 days")


def _better_next_open(dt: datetime) -> datetime:
    """Efficient implementation: jump day by day."""
    # Check if still open today (later today)
    candidate = dt + timedelta(minutes=1)
    for _ in range(10):  # max 10 days
        wd = candidate.weekday()
        hours = _HOURS.get(wd)
        if hours is not None:
            oh, om, ch, cm = hours
            open_dt = candidate.replace(hour=oh, minute=om, second=0, microsecond=0)
            close_dt = candidate.replace(hour=ch, minute=cm, second=0, microsecond=0)
            if candidate < open_dt:
                # clinic hasn't opened yet today
                return open_dt
            if open_dt <= candidate < close_dt:
                return candidate
        # move to next day start
        candidate = (candidate + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    raise RuntimeError("no open time found")


# Use the efficient version
next_open_time = _better_next_open


if __name__ == "__main__":
    import sys
    from datetime import datetime

    tests = [
        "2026-04-19 08:00:00",  # Sunday before open -> open
        "2026-04-19 14:00:00",  # Sunday during open -> closed? no, open
        "2026-04-17 22:00:00",  # Friday after close -> Saturday? closed -> Sunday
        "2026-04-18 12:00:00",  # Saturday -> Sunday
        "2026-04-20 21:00:00",  # Monday night -> Tuesday morning
    ]
    for t in tests:
        dt = datetime.strptime(t, "%Y-%m-%d %H:%M:%S")
        status = classify(dt)
        nxt = next_open_time(dt)
        print(f"{t}  status={status:6s}  next_open={nxt}")
