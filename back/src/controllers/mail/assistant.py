"""AI helpers of the mail client: summary, digest and reply draft."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

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

SUMMARY_PROMPT = """Read this email and help its recipient triage it.

<email>
From: {sender}
Date: {date}
Subject: {subject}

{body}
</email>

Answer ONLY with a JSON object, no explanation:
{{"summary": "2-3 sentence summary of what the email says and asks",
  "needs_reply": true or false (does the sender expect an answer from the recipient?),
  "action": "the one concrete next step for the recipient, or empty string"}}"""

DIGEST_PROMPT = """Write a short briefing of these unread emails for their recipient.
Group them by what to do: "Reply", "Read", "Ignore". One bullet per email:
**sender** – subject: one-line gist. Markdown only, no preamble.

<emails>
{emails}
</emails>"""

REPLY_PROMPT = """Write a reply to this email on behalf of its recipient.
{note}
Instructions from the recipient: {instruction}
Reply in the language of the email. Write ONLY the reply body (greeting to sign-off),
no subject line, no quoted original, no placeholder in brackets unless information is missing.

<email>
From: {sender}
Subject: {subject}

{body}
</email>"""

DEFAULT_REPLY_INSTRUCTION = "Answer briefly and politely."

PREVIEW_PROMPT = """Write a Mail Preview of this email for its recipient's inbox list.

<email>
From: {sender}
Subject: {subject}

{body}
</email>

Answer ONLY with a JSON object, no explanation, in the language of the email:
{{"title": "what the email is about, at most {title_words} words",
  "summary": "the gist and what is expected, at most {summary_words} words"}}"""


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
    return SUMMARY_PROMPT.format(
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
        f"- From: {mail.sender} | Subject: {mail.subject}\n"
        f"  {' '.join(mail.body.split())[:MAX_DIGEST_BODY_CHARS]}"
        for mail in mails[:MAX_DIGEST_MAILS]
    ]
    return DIGEST_PROMPT.format(emails="\n".join(entries))


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
        f"About the sender: {sender_note.strip()}\n"
        if sender_note and sender_note.strip()
        else ""
    )
    return REPLY_PROMPT.format(
        note=note,
        instruction=instruction.strip() or DEFAULT_REPLY_INSTRUCTION,
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
    return PREVIEW_PROMPT.format(
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
