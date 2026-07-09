import json
import logging
import traceback

from db import StockPile, get_db
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/stockpile", tags=["Stock Pile"])

@router.get("/get/{key}")
async def get_stockpile(key: str):
    """
    Get a value from the stockpile by key.
    """
    db = get_db()
    try:
        stockpile_item = db.query(StockPile).filter(StockPile.key == key).first()
        if not stockpile_item:
            raise HTTPException(status_code=404, detail="Key not found in stockpile")
        return stockpile_item.value
    except Exception as e:
        logging.error(f"Error retrieving stockpile item {key}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving stockpile item: {str(e)}"
        )
    finally:
        db.close()


@router.post("/set/{key}")
async def create_stockpile_item(key: str, value: str):
    """
    Create or update a stockpile item.
    """
    db = get_db()
    try:
        stockpile_item = db.query(StockPile).filter(StockPile.key == key).first()
        if stockpile_item:
            stockpile_item.value = value
        else:
            stockpile_item = StockPile(key=key, value=value)
            db.add(stockpile_item)
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Error creating/updating stockpile item {key}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error creating/updating stockpile item: {str(e)}"
        )
    finally:
        db.close()


@router.delete("/delete/{key}")
async def delete_stockpile_item(key: str):
    """
    Delete a stockpile item by key.
    """
    db = get_db()
    try:
        stockpile_item = db.query(StockPile).filter(StockPile.key == key).first()
        if not stockpile_item:
            raise HTTPException(status_code=404, detail="Key not found in stockpile")
        db.delete(stockpile_item)
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Error deleting stockpile item {key}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error deleting stockpile item: {str(e)}"
        )
    finally:
        db.close()


def get_recent_opened():
    """
    Get the most recent stockpile items.
    """
    db = get_db()
    try:
        stockpile_item = (
            db.query(StockPile).filter(StockPile.key == "recentopened").first()
        )
        return json.loads(stockpile_item.value) if stockpile_item else []
    except Exception as e:
        logging.error(f"Error retrieving recent stockpile items: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error retrieving recent stockpile items: {str(e)}"
        )
    finally:
        db.close()


@router.get("/recentopened")
async def get_recent():
    return get_recent_opened()


@router.post("/recentopened")
async def add_recent(file: str):
    """
    Add a file to the recent stockpile.
    """
    try:
        recent_files = get_recent_opened()
    except HTTPException:
        recent_files = []

    if file in recent_files:
        recent_files.remove(file)
    if len(recent_files) >= 10:
        recent_files.pop()
    recent_files.insert(0, file)

    db = get_db()
    try:
        stockpile_item = (
            db.query(StockPile).filter(StockPile.key == "recentopened").first()
        )
        if stockpile_item:
            stockpile_item.value = json.dumps(recent_files)
        else:
            stockpile_item = StockPile(
                key="recentopened", value=json.dumps(recent_files)
            )
            db.add(stockpile_item)
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Error adding recent file {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error adding recent file: {str(e)}"
        )
    finally:
        db.close()


@router.delete("/recentopened")
async def clear_recent(file: str):
    """
    Clear a file from the recent stockpile.
    """
    try:
        recent_files = get_recent_opened()
    except HTTPException:
        recent_files = []

    if file in recent_files:
        recent_files.remove(file)

    db = get_db()
    try:
        stockpile_item = (
            db.query(StockPile).filter(StockPile.key == "recentopened").first()
        )
        if stockpile_item:
            stockpile_item.value = json.dumps(recent_files)
            db.commit()
        else:
            raise HTTPException(status_code=404, detail="Recent files not found")
    except Exception as e:
        db.rollback()
        logging.error(f"Error clearing recent file {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error clearing recent file: {str(e)}"
        )
    finally:
        db.close()


def get_recent_added():
    """
    Get the most recent added stockpile items.
    """
    db = get_db()
    try:
        stockpile_item = (
            db.query(StockPile).filter(StockPile.key == "recentadded").first()
        )
        return json.loads(stockpile_item.value) if stockpile_item else []
    except Exception as e:
        logging.error(f"Error retrieving recent added stockpile items: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving recent added stockpile items: {str(e)}",
        )
    finally:
        db.close()


@router.post("/recentadded")
async def add_recent_added(file: str):
    """
    Add a file to the recent added stockpile.
    """
    try:
        recent_files = get_recent_added()
    except HTTPException:
        recent_files = []

    if file in recent_files:
        recent_files.remove(file)
    if len(recent_files) >= 10:
        recent_files.pop()
    recent_files.insert(0, file)

    db = get_db()
    try:
        stockpile_item = (
            db.query(StockPile).filter(StockPile.key == "recentadded").first()
        )
        if stockpile_item:
            stockpile_item.value = json.dumps(recent_files)
        else:
            stockpile_item = StockPile(
                key="recentadded", value=json.dumps(recent_files)
            )
            db.add(stockpile_item)
        db.commit()
    except Exception as e:
        db.rollback()
        logging.error(f"Error adding recent added file {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error adding recent added file: {str(e)}"
        )
    finally:
        db.close()


@router.delete("/recentadded")
async def clear_recent_added(file: str):
    """
    Clear a file from the recent added stockpile.
    """
    try:
        recent_files = get_recent_added()
    except HTTPException:
        recent_files = []

    if file in recent_files:
        recent_files.remove(file)

    db = get_db()
    try:
        stockpile_item = (
            db.query(StockPile).filter(StockPile.key == "recentadded").first()
        )
        if stockpile_item:
            stockpile_item.value = json.dumps(recent_files)
            db.commit()
        else:
            raise HTTPException(status_code=404, detail="Recent added files not found")
    except Exception as e:
        db.rollback()
        logging.error(f"Error clearing recent added file {file}: {str(e)}")
        logging.error(traceback.format_exc())
        raise HTTPException(
            status_code=500, detail=f"Error clearing recent added file: {str(e)}"
        )
    finally:
        db.close()


@router.get("/recentadded")
async def get_recent_added_items():
    return get_recent_added()
