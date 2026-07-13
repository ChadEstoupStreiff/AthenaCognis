import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Dict

import tiktoken
from db import ChatMessage, ChatSession, get_db
from fastapi import HTTPException
from tools.ai import (
    get_model_context_tokens,
    provider_supports_vision,
    request_chat_llm,
)
from utils import guess_mime, read_content
from views.settings import get_setting

SYSTEM_INSTRUCTIONS = (
    "You are given a conversation and some files and calendar events provided by the user.\n"
    "You are an AI Chat BOT that can answer questions based on the conversation, files and calendar events.\n"
    "Use the file contents if relevant to ANSWER the user's LATEST prompt.\n"
    "Some files may be labeled as auto-retrieved background context rather than explicitly attached by the "
    "user — use them only if relevant, and don't assume the user has seen them.\n"
)


def read_calendar(event: Dict[str, str]):
    return f"""Title: {event['title']}
Project: {event['project']}
Date: {event['date']}
Time Spent: {event['time_spent']}
Description: {event['description']}
Location: {event['location']}
Attendees: {event['attendees']}
"""


def _extract_file_paths(raw_files):
    """files is either a list of plain paths (legacy) or {"path", "source"} dicts (with provenance)."""
    return [f["path"] if isinstance(f, dict) else f for f in (raw_files or [])]


class SessionRun:
    def __init__(self, rag_enabled: bool = True):
        self.buffer = ""
        self.cancel_event = threading.Event()
        self.lock = threading.Lock()
        self.rag_enabled = rag_enabled


class ChatManager:
    _executor = None
    _executor_lock = threading.Lock()
    _sessions: Dict[str, SessionRun] = {}
    _sessions_lock = threading.Lock()

    @classmethod
    def _get_executor(cls):
        if cls._executor is None:
            with cls._executor_lock:
                if cls._executor is None:
                    size = get_setting("chat_max_concurrent_generations", 3) or 3
                    cls._executor = ThreadPoolExecutor(max_workers=size, thread_name_prefix="chat-gen")
        return cls._executor

    @staticmethod
    def _file_content_part(file, vision_ok):
        mime = guess_mime(file)
        if vision_ok and mime.startswith("image/"):
            return {"type": "image", "path": file}
        text = read_content(
            file, include_projects=True, include_note=True, include_summary=True, include_tags=True
        )
        return {"type": "text", "text": f"--- File: {file} ---\n{text or '[File could not be read]'}\n"}

    # MARK: Prompt building

    @classmethod
    def build_messages(cls, chat_id):
        """
        Build a structured, multi-turn, multimodal message list for the whole conversation,
        windowed to fit the configured model's context budget. Returns
        (messages, latest_files, latest_calendars, latest_query_text).
        """
        history = cls.get_chat_messages(chat_id)
        if not history:
            return [], [], [], ""

        ai_type = get_setting("chat_type")
        model = get_setting("chat_model")
        vision_ok = provider_supports_vision(ai_type, model)

        system_text = SYSTEM_INSTRUCTIONS

        turns = []
        for msg in history:
            files = _extract_file_paths(json.loads(msg["files"]) if msg["files"] else [])
            calendars = json.loads(msg["calendar"]) if msg["calendar"] else []
            role = "user" if msg["user"] == "user" else "assistant"

            parts = [cls._file_content_part(file, vision_ok) for file in files]
            parts += [
                {"type": "text", "text": f"--- Calendar Event ---\n{read_calendar(event)}\n"}
                for event in calendars
            ]
            parts.append({"type": "text", "text": msg["content"]})

            turns.append({"role": role, "content": parts})

        latest_files = _extract_file_paths(json.loads(history[-1]["files"]) if history[-1]["files"] else [])
        latest_calendars = json.loads(history[-1]["calendar"]) if history[-1]["calendar"] else []
        latest_query_text = history[-1]["content"]

        encoder = tiktoken.encoding_for_model("gpt-4")

        def turn_tokens(turn):
            return sum(
                len(encoder.encode(part["text"])) if part["type"] == "text" else 300
                for part in turn["content"]
            )

        budget = int(get_model_context_tokens(ai_type, model) * 0.7)
        remaining = budget - len(encoder.encode(system_text))

        kept = []
        for i, turn in enumerate(reversed(turns)):
            tokens = turn_tokens(turn)
            if i == 0 or tokens <= remaining:
                kept.insert(0, turn)
                remaining -= tokens
            else:
                break  # everything older than this is dropped too

        messages = [{"role": "system", "content": [{"type": "text", "text": system_text}]}] + kept
        return messages, latest_files, latest_calendars, latest_query_text

    @classmethod
    def _retrieve_context(cls, query_text, exclude_files):
        if not query_text or not query_text.strip():
            return []
        try:
            from controllers.EmbeddingManager import EmbeddingManager

            top_k = get_setting("chat_rag_top_k", 5)
            threshold = get_setting("chat_rag_similarity_threshold", 0.4)
            query_vec = EmbeddingManager.encode_query(query_text)
            results = EmbeddingManager.search(
                query_vec, top_k=top_k, min_similarity=threshold, exclude_files=exclude_files
            )
            return [file for file, _score in results]
        except Exception as e:
            logging.warning(f"CHAT >> RAG retrieval failed, continuing without it: {e}")
            return []

    @staticmethod
    def _sanitize_error(e: Exception) -> str:
        text = str(e).lower()
        if "timeout" in text or isinstance(e, TimeoutError):
            return "The request to the language model timed out. Please try again."
        if "connection" in text or isinstance(e, ConnectionError):
            return "Could not connect to the configured AI provider. Check your network and provider settings."
        if text.startswith("unsupported"):
            return "The configured AI provider or model is not supported or is misconfigured."
        return "The AI provider returned an error while generating a response. Check the server logs for details."

    # MARK: Generation worker

    @classmethod
    def _run_generation(cls, chat_id):
        session_run = cls._sessions.get(chat_id)
        if session_run is None:
            return

        try:
            if session_run.cancel_event.is_set():
                cls._finalize(chat_id, "system-cancelled", "Generation cancelled by user.", None, None)
                return

            messages, files, calendars, query_text = cls.build_messages(chat_id)
            if not messages:
                cls._finalize(chat_id, "system-error", "No conversation context available.", None, None)
                return

            ai_type_setting = get_setting("chat_type")
            model_setting = get_setting("chat_model")
            vision_ok = provider_supports_vision(ai_type_setting, model_setting)

            retrieved_files = []
            if session_run.rag_enabled:
                retrieved_files = cls._retrieve_context(query_text, exclude_files=files)
                if retrieved_files:
                    context_parts = [{
                        "type": "text",
                        "text": "--- Auto-retrieved background context (not explicitly attached by the user) ---",
                    }]
                    context_parts += [cls._file_content_part(f, vision_ok) for f in retrieved_files]
                    messages[-1] = {
                        "role": messages[-1]["role"],
                        "content": messages[-1]["content"] + context_parts,
                    }

            def on_chunk(text):
                with session_run.lock:
                    session_run.buffer += text

            ai_type, model, answer = request_chat_llm(
                "chat", messages, stream_callback=on_chunk, cancel_event=session_run.cancel_event
            )

            persisted_files = (
                [{"path": f, "source": "manual"} for f in files]
                + [{"path": f, "source": "retrieved"} for f in retrieved_files]
            )

            if session_run.cancel_event.is_set():
                cls._finalize(chat_id, "system-cancelled", "Generation cancelled by user.", persisted_files, calendars)
                return

            cls._finalize(chat_id, f"{ai_type} - {model}", answer, persisted_files, calendars)
        except Exception as e:
            logging.error(f"CHAT >> Error generating response for session {chat_id}: {e}", exc_info=True)
            cls._finalize(chat_id, "system-error", cls._sanitize_error(e), None, None)

    @classmethod
    def _finalize(cls, chat_id, user, content, files, calendars):
        db = get_db()
        try:
            db.add(
                ChatMessage(
                    session_id=chat_id,
                    user=user,
                    content=content,
                    files=json.dumps(files) if files else None,
                    calendar=json.dumps(calendars) if calendars else None,
                    date=datetime.now(),
                )
            )
            db.commit()
        except Exception as e:
            logging.error(f"CHAT >> Error persisting result for session {chat_id}: {str(e)}")
        finally:
            db.close()

        with cls._sessions_lock:
            cls._sessions.pop(chat_id, None)

    # MARK: Public API

    @classmethod
    def is_running(cls, chat_id):
        with cls._sessions_lock:
            session_run = cls._sessions.get(chat_id)
        if session_run is None:
            return {"state": "not_running"}
        with session_run.lock:
            return {"state": "running", "answer": session_run.buffer}

    @classmethod
    def cancel(cls, chat_id):
        with cls._sessions_lock:
            session_run = cls._sessions.get(chat_id)
        if session_run is None:
            raise HTTPException(status_code=404, detail="No generation is currently running for this chat session")
        session_run.cancel_event.set()
        return {"message": "Cancellation requested"}

    @classmethod
    def list_chats(cls):
        db = get_db()
        try:
            sessions = [s.__dict__ for s in db.query(ChatSession).all()]
            sessions.sort(key=lambda x: x["date"], reverse=True)
            return sessions
        except Exception as e:
            logging.error(f"Error listing chat sessions: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal Server Error")
        finally:
            db.close()

    @classmethod
    def create_chat(cls, title: str):
        db = get_db()
        try:
            new_session = ChatSession(title=title, date=datetime.now())
            db.add(new_session)
            db.commit()
            return {"id": new_session.id, "title": new_session.title}
        except Exception as e:
            logging.error(f"Error creating chat session: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal Server Error")
        finally:
            db.close()

    @classmethod
    def edit_chat(cls, session_id: str, title: str, description: str):
        db = get_db()
        try:
            session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
            if not session:
                raise HTTPException(status_code=404, detail="Chat session not found")
            session.title = title
            session.description = description
            db.commit()
            return {"id": session.id, "title": session.title}
        except Exception as e:
            logging.error(f"Error editing chat session: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal Server Error")
        finally:
            db.close()

    @classmethod
    def get_chat_info(cls, session_id: str):
        db = get_db()
        try:
            session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
            if not session:
                raise HTTPException(status_code=404, detail="Chat session not found")
            return session.__dict__
        except Exception as e:
            logging.error(f"Error retrieving chat info: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal Server Error")
        finally:
            db.close()

    @classmethod
    def get_chat_messages(cls, session_id: str):
        db = get_db()
        try:
            messages = [
                m.__dict__
                for m in (
                    db.query(ChatMessage)
                    .filter(ChatMessage.session_id == session_id)
                    .all()
                )
            ]
            messages.sort(key=lambda x: x["date"])
            return messages
        except Exception as e:
            logging.error(f"Error retrieving chat messages: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal Server Error")
        finally:
            db.close()

    @classmethod
    def add_message(
        cls,
        session_id: str,
        content: str,
        files=None,
        calendar=None,
        rag_enabled: bool = True,
    ):
        with cls._sessions_lock:
            if session_id in cls._sessions:
                raise HTTPException(status_code=400, detail="Chat session is currently running")
            cls._sessions[session_id] = SessionRun(rag_enabled=rag_enabled)

        db = get_db()
        try:
            new_message = ChatMessage(
                session_id=session_id,
                user="user",
                content=content,
                files=json.dumps(files) if files else None,
                calendar=json.dumps(calendar) if calendar else None,
                date=datetime.now(),
            )
            db.add(new_message)
            db.commit()
            db.refresh(new_message)
            result = new_message.__dict__
        except Exception as e:
            with cls._sessions_lock:
                cls._sessions.pop(session_id, None)
            logging.error(f"Error adding chat message: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal Server Error")
        finally:
            db.close()

        cls._get_executor().submit(cls._run_generation, session_id)
        return result

    @classmethod
    def delete(cls, session_id: str):
        db = get_db()
        try:
            db.query(ChatSession).filter(ChatSession.id == session_id).delete()
            db.commit()
        except Exception as e:
            logging.error(f"Error deleting chat session: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal Server Error")
        finally:
            db.close()
