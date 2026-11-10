import hashlib
import hmac
import os
import uuid as uuid_lib
from datetime import date, datetime
from typing import Optional

import uvicorn
from db import get_db, init_db
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from models import DailyAggregate, TelemetryEntry
from pydantic import BaseModel, ConfigDict, Field
from scheduler import compute_for_date, start_scheduler
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

_secret = os.getenv("TELEMETRY_SECRET", "")
if not _secret:
    raise RuntimeError("TELEMETRY_SECRET environment variable must be set")
_SECRET = _secret.encode()

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="GodAssistant Telemetry")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class TelemetryData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nbr_files: int = Field(ge=0, le=1_000_000)
    nbr_projects: int = Field(ge=0, le=100_000)
    nbr_tags: int = Field(ge=0, le=100_000)
    nbr_calendars: int = Field(ge=0, le=10_000)
    nbr_hours: float = Field(ge=0, le=1_000_000)
    nbr_summaries: int = Field(ge=0, le=1_000_000)
    nbr_links: int = Field(ge=0, le=1_000_000)
    nbr_contacts: int = Field(ge=0, le=100_000)
    nbr_tasks: int = Field(ge=0, le=1_000_000)
    nbr_kanban_boards: int = Field(ge=0, le=10_000)
    nbr_validated_tasks: int = Field(ge=0, le=1_000_000)
    files_without_tag: int = Field(ge=0, le=1_000_000)
    files_without_project: int = Field(ge=0, le=1_000_000)
    disk_files_bytes: int = Field(ge=0, le=1_000_000_000_000)

    # Added later: optional so older clients keep being accepted.
    nbr_notes: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    nbr_pinned_files: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    nbr_ocr: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    nbr_transcriptions: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    nbr_embeddings: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    nbr_chat_sessions: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    nbr_chat_messages: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    nbr_kanban_columns: Optional[int] = Field(default=None, ge=0, le=100_000)
    nbr_task_dependencies: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    nbr_sota_papers: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    nbr_sota_with_metadata: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    nbr_sota_with_references: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    research_subject_set: Optional[int] = Field(default=None, ge=0, le=1)
    research_searches: Optional[int] = Field(default=None, ge=0, le=100_000)
    research_discoveries: Optional[int] = Field(default=None, ge=0, le=100_000)
    research_imports: Optional[int] = Field(default=None, ge=0, le=100_000)


def _sign_uuid(raw: str) -> str:
    sig = hmac.new(_SECRET, raw.encode(), hashlib.sha256).hexdigest()[:16]
    return f"{raw}.{sig}"


def _verify_uuid(token: str) -> bool:
    parts = token.rsplit(".", 1)
    if len(parts) != 2:
        return False
    raw, sig = parts
    expected = hmac.new(_SECRET, raw.encode(), hashlib.sha256).hexdigest()[:16]
    return hmac.compare_digest(sig, expected)


@app.on_event("startup")
def startup():
    init_db()
    start_scheduler()


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.get("/uuid")
@limiter.limit("10/day")
def generate_uuid(request: Request):
    raw = str(uuid_lib.uuid4())
    return {"uuid": _sign_uuid(raw)}


@app.post("/data/{client_uuid}", status_code=201)
@limiter.limit("10/day")
def receive_data(
    client_uuid: str,
    data: TelemetryData,
    request: Request,
    db: Session = Depends(get_db),
):
    if not _verify_uuid(client_uuid):
        raise HTTPException(status_code=401, detail="Invalid UUID")
    today = date.today()
    entry = TelemetryEntry(uuid=client_uuid, date=today, data=data.model_dump(exclude_none=True))
    db.add(entry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Already received data for this UUID today")

    compute_for_date(today)
    return {"status": "ok"}


@app.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    aggregates = (
        db.query(DailyAggregate).order_by(DailyAggregate.date.asc()).all()
    )
    daily = [
        {
            "date": agg.date.isoformat(),
            "unique_users": agg.unique_users,
            "total_users": agg.total_users,
            "retention": {
                "d1": agg.retention_d1,
                "d7": agg.retention_d7,
                "d30": agg.retention_d30,
                "d90": agg.retention_d90,
                "d365": agg.retention_d365,
            },
            "fields": agg.field_stats or {},
            "computed_at": agg.computed_at.isoformat() if agg.computed_at else None,
        }
        for agg in aggregates
    ]
    all_time_users = daily[-1]["total_users"] if daily else 0
    avg_dau = sum(d["unique_users"] for d in daily) / len(daily) if daily else 0
    return {
        "daily": daily,
        "summary": {
            "all_time_users": all_time_users,
            "avg_dau": round(avg_dau, 2),
            "days_tracked": len(daily),
        },
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=80, reload=False)
