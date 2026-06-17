import uuid
from datetime import date, datetime

from sqlalchemy import Column, Date, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import declarative_base

try:
    from sqlalchemy import JSON
except ImportError:
    from sqlalchemy import Text as JSON

Base = declarative_base()


class TelemetryEntry(Base):
    __tablename__ = "telemetry_entries"
    __table_args__ = (UniqueConstraint("uuid", "date", name="uq_uuid_date"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(36), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    data = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class DailyAggregate(Base):
    __tablename__ = "daily_aggregates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False, unique=True)
    unique_users = Column(Integer, nullable=False, default=0)
    total_users = Column(Integer, nullable=False, default=0)
    retention_d1 = Column(Float, nullable=True)
    retention_d7 = Column(Float, nullable=True)
    retention_d30 = Column(Float, nullable=True)
    retention_d90 = Column(Float, nullable=True)
    retention_d365 = Column(Float, nullable=True)
    field_stats = Column(JSON, nullable=True)
    computed_at = Column(DateTime, default=datetime.utcnow)
