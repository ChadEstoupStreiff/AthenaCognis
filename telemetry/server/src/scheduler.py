import logging
import statistics
import threading
import time
from datetime import date, datetime, timedelta

from db import SessionLocal
from models import DailyAggregate, TelemetryEntry
from sqlalchemy import func

logger = logging.getLogger(__name__)


def _retention(session, active_today: set, n_days: int, target_date: date) -> float | None:
    past_date = target_date - timedelta(days=n_days)
    rows = session.query(TelemetryEntry.uuid).filter(TelemetryEntry.date == past_date).all()
    active_past = {r[0] for r in rows}
    if not active_past:
        return None
    return len(active_today & active_past) / len(active_past)


def _compute_field_stats(entries: list) -> dict:
    fields: dict[str, list] = {}
    for entry in entries:
        if not isinstance(entry.data, dict):
            continue
        for k, v in entry.data.items():
            if isinstance(v, (int, float)):
                fields.setdefault(k, []).append(v)
    result = {}
    for field, values in fields.items():
        result[field] = {
            "sum": sum(values),
            "avg": statistics.mean(values),
            "median": statistics.median(values),
        }
    return result


def compute_for_date(target_date: date):
    session = SessionLocal()
    try:
        entries = session.query(TelemetryEntry).filter(TelemetryEntry.date == target_date).all()
        if not entries:
            return

        active_today = {e.uuid for e in entries}
        total_users = session.query(func.count(func.distinct(TelemetryEntry.uuid))).scalar()

        agg = session.query(DailyAggregate).filter(DailyAggregate.date == target_date).first()
        if agg is None:
            agg = DailyAggregate(date=target_date)
            session.add(agg)

        agg.unique_users = len(active_today)
        agg.total_users = total_users
        agg.retention_d1 = _retention(session, active_today, 1, target_date)
        agg.retention_d7 = _retention(session, active_today, 7, target_date)
        agg.retention_d30 = _retention(session, active_today, 30, target_date)
        agg.retention_d90 = _retention(session, active_today, 90, target_date)
        agg.retention_d365 = _retention(session, active_today, 365, target_date)
        agg.field_stats = _compute_field_stats(entries)
        agg.computed_at = datetime.utcnow()

        session.commit()
        logger.info(f"Aggregated stats for {target_date}: {len(active_today)} users")
    except Exception:
        logger.exception(f"Failed to compute aggregate for {target_date}")
        session.rollback()
    finally:
        session.close()


def _scheduler_loop():
    while True:
        try:
            yesterday = date.today() - timedelta(days=1)
            session = SessionLocal()
            existing = session.query(DailyAggregate).filter(DailyAggregate.date == yesterday).first()
            session.close()
            if existing is None:
                compute_for_date(yesterday)
        except Exception:
            logger.exception("Scheduler error")
        time.sleep(3600)


def start_scheduler():
    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()
    logger.info("Telemetry scheduler started")
