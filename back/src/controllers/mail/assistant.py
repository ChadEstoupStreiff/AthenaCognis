"""AI helpers of the mail client: summary, digest and reply draft."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from tools.prompts import get_prompt, render

SETTING_PREFIX = "mail"
MAX_BODY_CHARS = 8_000
MAX_DIGEST_MAILS = 30
MAX_DIGEST_BODY_CHARS = 600
MAX_SUMMARY_CHARS = 1_200
MAX_ACTION_CHARS = 300
PREVIEW_MAX_WORDS = 40
PREVIEW_TITLE_MAX_WORDS = 8
PREVIEW_TITLE_MAX_CHARS = 255
PREVIEW_BODY_CHARS = 4_000
JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)

LlmCall = Callable[[str], str]


class AssistantError(Exception):
    """The LLM gave no usable answer."""


@dataclass(frozen=True)
class MailBrief:
    """Message content handed to the LLM."""

    sender: str
    subject: str
    date: datetime
    body: str


@dataclass(frozen=True)
class MailInsight:
    """AI triage of one message."""

    summary: str
    needs_reply: bool
    action: str


def build_summary_prompt(mail: MailBrief) -> str:
    """
    Build the triage prompt of one message

    Args:
        mail (MailBrief): message
    Returns:
        str: prompt
    """
    return render(
        "mail.summary",
        sender=mail.sender,
        date=mail.date.isoformat(timespec="minutes"),
        subject=mail.subject,
        body=mail.body.strip()[:MAX_BODY_CHARS],
    )


def json_object(answer: str) -> dict[str, object]:
    """
    Read the first JSON object of an LLM answer

    Args:
        answer (str): raw LLM answer
    Returns:
        dict[str, object]: object
    Raises:
        AssistantError: when the answer holds no JSON object
    """
    match = JSON_OBJECT.search(answer)
    if match is None:
        raise AssistantError("The AI answer holds no JSON object.")
    try:
        values = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise AssistantError("The AI answer is not valid JSON.") from error
    if not isinstance(values, dict):
        raise AssistantError("The AI answer is not a JSON object.")
    return values


def parse_insight(answer: str) -> MailInsight:
    """
    Read the JSON triage of an LLM answer

    Args:
        answer (str): raw LLM answer
    Returns:
        MailInsight: summary, reply flag, action
    Raises:
        AssistantError: when the answer holds no usable JSON object
    """
    values = json_object(answer)
    summary = values.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise AssistantError("The AI wrote no summary.")
    action = values.get("action")
    return MailInsight(
        summary=summary.strip()[:MAX_SUMMARY_CHARS],
        needs_reply=values.get("needs_reply") is True,
        action=action.strip()[:MAX_ACTION_CHARS] if isinstance(action, str) else "",
    )


def summarize(mail: MailBrief, llm: LlmCall) -> MailInsight:
    """
    Ask the LLM to triage one message

    Args:
        mail (MailBrief): message
        llm (LlmCall): prompt → answer
    Returns:
        MailInsight: triage
    Raises:
        AssistantError: when the message is empty or the answer unusable
    """
    if not mail.body.strip() and not mail.subject.strip():
        raise AssistantError("Nothing to summarize.")
    return parse_insight(llm(build_summary_prompt(mail)))


def build_digest_prompt(mails: list[MailBrief]) -> str:
    """
    Build the briefing prompt of several messages

    Args:
        mails (list[MailBrief]): messages, most important first
    Returns:
        str: prompt
    """
    entries = [
        render(
            "mail.digest_entry",
            sender=mail.sender,
            subject=mail.subject,
            body=" ".join(mail.body.split())[:MAX_DIGEST_BODY_CHARS],
        )
        for mail in mails[:MAX_DIGEST_MAILS]
    ]
    return render("mail.digest", emails="\n".join(entries))


def write_digest(mails: list[MailBrief], llm: LlmCall) -> str:
    """
    Ask the LLM for a briefing of unread messages

    Args:
        mails (list[MailBrief]): messages
        llm (LlmCall): prompt → answer
    Returns:
        str: markdown briefing
    Raises:
        AssistantError: when there is nothing to brief or the answer is empty
    """
    if not mails:
        raise AssistantError("No unread email to brief.")
    answer = llm(build_digest_prompt(mails)).strip()
    if not answer:
        raise AssistantError("The AI wrote an empty briefing.")
    return answer


def build_reply_prompt(
    mail: MailBrief, instruction: str, sender_note: str | None
) -> str:
    """
    Build the reply-draft prompt

    Args:
        mail (MailBrief): message to answer
        instruction (str): what the recipient wants to say
        sender_note (str | None): what the recipient noted about the sender
    Returns:
        str: prompt
    """
    note = (
        render("mail.reply_sender_note", note=sender_note.strip())
        if sender_note and sender_note.strip()
        else ""
    )
    return render(
        "mail.reply",
        note=note,
        instruction=instruction.strip() or get_prompt("mail.reply_default_instruction"),
        sender=mail.sender,
        subject=mail.subject,
        body=mail.body.strip()[:MAX_BODY_CHARS],
    )


def draft_reply(
    mail: MailBrief, instruction: str, sender_note: str | None, llm: LlmCall
) -> str:
    """
    Ask the LLM for a reply body

    Args:
        mail (MailBrief): message to answer
        instruction (str): what the recipient wants to say
        sender_note (str | None): what the recipient noted about the sender
        llm (LlmCall): prompt → answer
    Returns:
        str: reply body
    Raises:
        AssistantError: when the answer is empty
    """
    answer = llm(build_reply_prompt(mail, instruction, sender_note)).strip()
    if not answer:
        raise AssistantError("The AI wrote an empty reply.")
    return answer


@dataclass(frozen=True)
class MailPreview:
    """Mail Preview: short AI title and summary shown in lists."""

    title: str
    summary: str


def limit_words(text: str, max_words: int) -> str:
    """
    Keep the first words of a text, whitespace collapsed

    Args:
        text (str): text
        max_words (int): word limit
    Returns:
        str: at most max_words words ("…" when cut)
    """
    words = text.split()
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]) + "…"


def build_preview_prompt(mail: MailBrief) -> str:
    """
    Build the Mail Preview prompt

    Args:
        mail (MailBrief): message
    Returns:
        str: prompt
    """
    return render(
        "mail.preview",
        sender=mail.sender,
        subject=mail.subject,
        body=mail.body.strip()[:PREVIEW_BODY_CHARS],
        title_words=PREVIEW_TITLE_MAX_WORDS,
        summary_words=PREVIEW_MAX_WORDS,
    )


def parse_preview(answer: str) -> MailPreview:
    """
    Read a Mail Preview answer, enforcing the word limits

    Args:
        answer (str): raw LLM answer
    Returns:
        MailPreview: title and summary
    Raises:
        AssistantError: when the title or summary is missing
    """
    values = json_object(answer)
    title, summary = values.get("title"), values.get("summary")
    if not isinstance(title, str) or not title.strip():
        raise AssistantError("The AI wrote no preview title.")
    if not isinstance(summary, str) or not summary.strip():
        raise AssistantError("The AI wrote no preview summary.")
    short_title = limit_words(title, PREVIEW_TITLE_MAX_WORDS)[:PREVIEW_TITLE_MAX_CHARS]
    return MailPreview(short_title, limit_words(summary, PREVIEW_MAX_WORDS))


def write_preview(mail: MailBrief, llm: LlmCall) -> MailPreview:
    """
    Ask the LLM for the Mail Preview of a message

    Args:
        mail (MailBrief): message
        llm (LlmCall): prompt → answer
    Returns:
        MailPreview: title and summary
    Raises:
        AssistantError: when the message is empty or the answer unusable
    """
    if not mail.body.strip() and not mail.subject.strip():
        raise AssistantError("Nothing to preview.")
    return parse_preview(llm(build_preview_prompt(mail)))
