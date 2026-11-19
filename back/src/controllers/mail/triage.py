"""Sender-aware triage: message category, sender flags and priorities."""

import re
from typing import Literal, get_args

Category = Literal["person", "newsletter", "notification"]
SenderFlag = Literal["vip", "normal", "muted", "blocked"]
Priority = Literal["high", "normal", "low", "hidden"]

SENDER_FLAGS: tuple[str, ...] = get_args(SenderFlag)
CATEGORIES: tuple[str, ...] = get_args(Category)

NEWSLETTER_HEADERS = ("list-unsubscribe", "list-id")
AUTOMATED_LOCAL_PART = re.compile(
    r"^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|postmaster|"
    r"bounces?|info|news|newsletter|marketing|support|updates?|billing|team)([+._-]|$)",
    re.IGNORECASE,
)
BULK_PRECEDENCE = ("bulk", "list", "junk")


def classify_category(sender_email: str, headers: dict[str, str]) -> Category:
    """
    Guess whether a message comes from a person, a newsletter or an automated system

    Args:
        sender_email (str): lowercase sender address
        headers (dict[str, str]): headers with lowercase names
    Returns:
        Category: message category
    """
    if any(name in headers for name in NEWSLETTER_HEADERS):
        return "newsletter"
    auto_submitted = headers.get("auto-submitted", "no").strip().lower()
    precedence = headers.get("precedence", "").strip().lower()
    local_part = sender_email.split("@", 1)[0]
    if auto_submitted != "no" or precedence in BULK_PRECEDENCE:
        return "notification"
    if AUTOMATED_LOCAL_PART.match(local_part):
        return "notification"
    return "person"
