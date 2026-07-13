from typing import List, Optional

from controllers.ChatManager import ChatManager
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/chat", tags=["Chat"])


@router.get("/list")
def list_chat_sessions():
    return ChatManager.list_chats()


@router.get("/{session_id}/is_running")
def is_chat_running(session_id: str):
    return ChatManager.is_running(session_id)


@router.post("/{session_id}/cancel")
def cancel_chat(session_id: str):
    return ChatManager.cancel(session_id)


@router.post("/create")
def create_chat_session(title: str):
    return ChatManager.create_chat(title)


@router.put("/{session_id}/edit")
def edit_chat_session(session_id: str, title: str, description: str):
    return ChatManager.edit_chat(session_id, title, description)


@router.get("/{session_id}/info")
def get_chat_info(session_id: str):
    return ChatManager.get_chat_info(session_id)


@router.get("/{session_id}/messages")
def get_chat_messages(session_id: str):
    return ChatManager.get_chat_messages(session_id)


@router.delete("/{session_id}")
def delete_chat_session(session_id: str):
    return ChatManager.delete(session_id)


class ChatMessageRequest(BaseModel):
    user_description: Optional[str] = None
    content: str
    files: Optional[List[str]] = None
    calendars: Optional[List[dict]] = None
    rag_enabled: bool = True


@router.post("/{session_id}/message")
def add_chat_message(session_id: str, request: ChatMessageRequest):
    content = (
        request.content.strip()
        if request.user_description is None or request.user_description == ""
        else f"""User description: {request.user_description}\n\nMessage: {request.content.strip()}"""
    )
    return ChatManager.add_message(
        session_id,
        content,
        request.files,
        request.calendars,
        rag_enabled=request.rag_enabled,
    )
