"""Addresses already seen in stored mail, suggested while composing."""

from dataclasses import dataclass
from datetime import datetime
from email.utils import getaddresses

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from controllers.mail.triage import AUTOMATED_LOCAL_PART
from db import MailAccount, MailMessage, MailSender

DEFAULT_SUGGESTIONS = 8
MAX_SUGGESTIONS = 50
SCANNED_MESSAGES = 2_000
PERSON_CATEGORY = "person"
BLOCKED_FLAG = "blocked"

JsonDict = dict[str, object]


@dataclass(frozen=True)
class MessageRow:
    """Address columns of one stored message."""

    sender_email: str
    sender_name: str
    category: str
    recipients: str
    cc: str
    date: datetime


@dataclass
class SeenAddress:
    """Address met in stored mail, with how often and when last."""

    email: str
    name: str
    count: int
    last_date: datetime

    def view(self) -> JsonDict:
        """
        Serialize for the API

        Returns:
            JsonDict: email, name, count and ISO last date
        """
        return {
            "email": self.email,
            "name": self.name,
            "count": self.count,
            "last_date": self.last_date.isoformat(),
        }


def excluded_addresses(session: Session) -> set[str]:
    """
    Collect addresses never suggested: own accounts and blocked senders

    Args:
        session (Session): session
    Returns:
        set[str]: lowercase addresses
    """
    own = session.scalars(select(MailAccount.email))
    blocked = session.scalars(
        select(MailSender.email).where(MailSender.flag == BLOCKED_FLAG)
    )
    return {address.lower() for address in [*own, *blocked]}


def scan_messages(session: Session, search: str) -> list[MessageRow]:
    """
    Load the address columns of the newest messages mentioning the search text

    Args:
        session (Session): session
        search (str): lowercase text, empty = no filter
    Returns:
        list[MessageRow]: sender email, sender name, category, recipients, cc, date
    """
    query = select(
        MailMessage.sender_email,
        MailMessage.sender_name,
        MailMessage.category,
        MailMessage.recipients,
        MailMessage.cc,
        MailMessage.date,
    )
    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                func.lower(MailMessage.sender_email).like(pattern),
                func.lower(MailMessage.sender_name).like(pattern),
                func.lower(MailMessage.recipients).like(pattern),
                func.lower(MailMessage.cc).like(pattern),
            )
        )
    query = query.order_by(MailMessage.date.desc()).limit(SCANNED_MESSAGES)
    return [MessageRow(*row) for row in session.execute(query).all()]


def addresses_of(row: MessageRow) -> list[tuple[str, str]]:
    """
    List the people of one message: its sender (when a person) and its recipients

    Args:
        row (MessageRow): message columns
    Returns:
        list[tuple[str, str]]: (name, address) pairs
    """
    people = getaddresses([row.recipients, row.cc])
    if row.category == PERSON_CATEGORY:
        people.append((row.sender_name, row.sender_email))
    return people


def is_suggestable(address: str, excluded: set[str]) -> bool:
    """
    Tell whether an address may be suggested

    Args:
        address (str): lowercase address
        excluded (set[str]): own and blocked addresses
    Returns:
        bool: True for a real, non-automated, non-excluded address
    """
    if "@" not in address or address in excluded:
        return False
    return AUTOMATED_LOCAL_PART.match(address.split("@", 1)[0]) is None


def matches(seen: SeenAddress, search: str) -> bool:
    """
    Tell whether an address or its name contains the search text

    Args:
        seen (SeenAddress): address
        search (str): lowercase text, empty = everything matches
    Returns:
        bool: True on match
    """
    return search in seen.email or search in seen.name.lower()


def tally(rows: list[MessageRow], excluded: set[str]) -> dict[str, SeenAddress]:
    """
    Count each address over messages given newest first

    Args:
        rows (list[MessageRow]): messages, newest first
        excluded (set[str]): own and blocked addresses
    Returns:
        dict[str, SeenAddress]: addresses by lowercase email
    """
    book: dict[str, SeenAddress] = {}
    for row in rows:
        for name, raw_address in addresses_of(row):
            address = raw_address.strip().lower()
            if not is_suggestable(address, excluded):
                continue
            seen = book.setdefault(address, SeenAddress(address, "", 0, row.date))
            seen.count += 1
            seen.name = seen.name or name.strip()
    return book


def suggest_addresses(
    session: Session, search: str, limit: int = DEFAULT_SUGGESTIONS
) -> list[SeenAddress]:
    """
    Suggest seen addresses matching a text, most frequent then most recent first

    Args:
        session (Session): session
        search (str): text in address or name
        limit (int): maximum suggestions
    Returns:
        list[SeenAddress]: suggestions
    """
    needle = search.strip().lower()
    book = tally(scan_messages(session, needle), excluded_addresses(session))
    found = [seen for seen in book.values() if matches(seen, needle)]
    found.sort(key=lambda seen: (seen.count, seen.last_date), reverse=True)
    return found[: max(1, min(limit, MAX_SUGGESTIONS))]
