import uuid
from datetime import date, datetime

import uvicorn
from db import get_db, init_db
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import DailyAggregate, TelemetryEntry
from scheduler import compute_for_date, start_scheduler
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

app = FastAPI(title="GodAssistant Telemetry")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()
    start_scheduler()


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.get("/uuid")
def generate_uuid():
    return {"uuid": str(uuid.uuid4())}


@app.post("/data/{client_uuid}", status_code=201)
def receive_data(client_uuid: str, data: dict, db: Session = Depends(get_db)):
    today = date.today()
    entry = TelemetryEntry(uuid=client_uuid, date=today, data=data)
    db.add(entry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Already received data for this UUID today")

    # Recompute today's aggregate immediately so /stats is always fresh
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
