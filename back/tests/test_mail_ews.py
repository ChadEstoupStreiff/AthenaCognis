from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from controllers.mail import ews_client
from controllers.mail.imap_client import MailServerError, ServerLogin
from controllers.mail.smtp_client import OutgoingMail
from controllers.mail.transport import AccountLink, FetchCursor, MessageRef
from db.migrate import add_missing_columns
from db.models import Base

LINK = AccountLink(
    "ews",
    "me@corp.org",
    ServerLogin("mail.corp.org", 443, "CORP\\me", "pw"),
    ServerLogin("mail.corp.org", 443, "CORP\\me", "pw"),
)


class FakeQuery:
    """exchangelib QuerySet stand-in."""

    def __init__(self, items: list[SimpleNamespace]) -> None:
        """
        Hold items, newest first

        Args:
            items (list[SimpleNamespace]): items
        """
        self.items = items

    def order_by(self, field: str) -> list[SimpleNamespace]:
        """
        Return the items (already ordered)

        Args:
            field (str): ordering field
        Returns:
            list[SimpleNamespace]: items
        """
        return self.items


class FakeInbox:
    """Inbox folder stand-in."""

    def __init__(self, items: list[SimpleNamespace]) -> None:
        """
        Hold items

        Args:
            items (list[SimpleNamespace]): items, newest first
        """
        self.items = items
        self.filters: list[dict[str, object]] = []

    def all(self) -> FakeQuery:
        """
        Every item

        Returns:
            FakeQuery: query
        """
        return FakeQuery(self.items)

    def filter(self, **criteria: object) -> FakeQuery:
        """
        Record the filter

        Args:
            criteria (object): filter
        Returns:
            FakeQuery: query
        """
        self.filters.append(criteria)
        return FakeQuery(self.items)

    def get(self, id: str) -> SimpleNamespace:
        """
        One item by id

        Args:
            id (str): item id
        Returns:
            SimpleNamespace: item
        """
        return next(item for item in self.items if item.id == id)


def item(item_id: str, is_read: bool = False) -> SimpleNamespace:
    """
    Build an EWS item stand-in

    Args:
        item_id (str): id
        is_read (bool): read state
    Returns:
        SimpleNamespace: item
    """
    saved: list[list[str]] = []
    replies: list[dict[str, object]] = []
    return SimpleNamespace(
        id=item_id,
        mime_content=b"Subject: x\r\n\r\nbody",
        is_read=is_read,
        flag=SimpleNamespace(flag_status="Flagged"),
        saved=saved,
        replies=replies,
        save=lambda update_fields: saved.append(update_fields),
        reply=lambda **kwargs: replies.append(kwargs),
    )


def use_inbox(monkeypatch: pytest.MonkeyPatch, inbox: FakeInbox) -> None:
    """
    Make open_account return a fake mailbox

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
        inbox (FakeInbox): inbox
    """
    account = SimpleNamespace(inbox=inbox, sent=inbox)
    monkeypatch.setattr(ews_client, "open_account", lambda link: account)


def test_fetch_numbers_new_items_oldest_first(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Skip known items, number the rest after last_uid, oldest first, filter by date

    Returns:
        None
    """
    inbox = FakeInbox([item("c"), item("b", is_read=True), item("a")])
    use_inbox(monkeypatch, inbox)
    cursor = FetchCursor(10, datetime(2026, 11, 17, 9, 0), {"a"})
    batch = ews_client.EwsTransport(LINK).fetch("inbox", cursor, 50)
    mails = batch.mails
    assert batch.folder == "INBOX"
    assert [(m.remote_id, m.uid, m.is_read, m.is_flagged) for m in mails] == [
        ("b", 11, True, True),
        ("c", 12, False, True),
    ]
    assert "datetime_received__gte" in inbox.filters[0]


def test_set_read_saves_item_and_keeps_flags_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Save is_read on the item; report that flags stay local

    Returns:
        None
    """
    target = item("x")
    use_inbox(monkeypatch, FakeInbox([target]))
    transport = ews_client.EwsTransport(LINK)
    assert transport.set_flag(MessageRef("INBOX", 1, "x"), "read", True) is None
    assert target.is_read is True
    assert target.saved == [["is_read"]]
    assert transport.set_flag(MessageRef("INBOX", 1, "x"), "flagged", True)


def test_reply_uses_exchange_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Answer through the original item so Exchange keeps the thread

    Returns:
        None
    """
    original = item("x")
    use_inbox(monkeypatch, FakeInbox([original]))
    mail = OutgoingMail("me@corp.org", "Me", ["a@corp.org"], "Re: x", "hello")
    ews_client.EwsTransport(LINK).send(mail, MessageRef("INBOX", 1, "x"))
    assert original.replies[0]["body"] == "hello"


def test_network_errors_become_server_errors() -> None:
    """
    Wrap OS errors into MailServerError

    Returns:
        None
    """
    with (
        pytest.raises(MailServerError, match="mail.corp.org"),
        ews_client.ews_errors("mail.corp.org"),
    ):
        raise ConnectionRefusedError("refused")


def test_add_missing_columns_alters_existing_tables() -> None:
    """
    Add the new mail columns to tables created before them

    Returns:
        None
    """
    engine = create_engine("sqlite://", poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE mail_account DROP COLUMN protocol"))
        connection.execute(text("ALTER TABLE mail_message DROP COLUMN remote_id"))
    added = add_missing_columns(engine)
    assert added == ["mail_account.protocol", "mail_message.remote_id"]
    columns = {column["name"] for column in inspect(engine).get_columns("mail_account")}
    assert "protocol" in columns
    assert add_missing_columns(engine) == []
    assert Base.metadata.tables["mail_account"].c.protocol.server_default is not None


def test_new_message_is_sent_with_exchange_mailboxes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Build exchangelib Mailbox recipients and send from the account (not a reply)

    Returns:
        None
    """
    sent: list[dict[str, object]] = []

    class FakeMessage:
        """exchangelib Message stand-in."""

        def __init__(self, **fields: object) -> None:
            """
            Record the fields

            Args:
                fields (object): message fields
            """
            self.fields = fields

        def send_and_save(self) -> None:
            """Record the send."""
            sent.append(self.fields)

    use_inbox(monkeypatch, FakeInbox([]))
    monkeypatch.setattr(ews_client, "Message", FakeMessage)
    mail = OutgoingMail(
        "me@corp.org", "Me", ["a@corp.org"], "Hi", "hello", ["b@corp.org"]
    )
    ews_client.EwsTransport(LINK).send(mail, None)
    recipients = sent[0]["to_recipients"]
    assert isinstance(recipients, list)
    assert recipients[0].email_address == "a@corp.org"
