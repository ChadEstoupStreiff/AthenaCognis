from collections.abc import Callable, Iterator
from datetime import datetime, timedelta
from email.message import EmailMessage

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import views.mail
from controllers.mail import activity_flags, outbox, service, store, transport, trash
from controllers.mail.imap_client import FetchedMail, MailServerError
from controllers.mail.parser import ParsedMail
from controllers.mail.smtp_client import OutgoingMail
from db import Contact, MailAccount, MailActivityFlag, MailDraft, MailMessage
from db.migrate import migrate_activity_flags
from db.models import Base

ACCOUNT_ID = "acc-1"
BASE_DATE = datetime(2026, 11, 17, 9, 0)

SessionFactory = Callable[[], Session]


@pytest.fixture
def factory(monkeypatch: pytest.MonkeyPatch) -> Iterator[SessionFactory]:
    """
    Point the mail store to an in-memory SQLite database holding one account

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        Iterator[SessionFactory]: session factory
    """
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session_factory: SessionFactory = sessionmaker(bind=engine)
    monkeypatch.setattr(store, "get_db", session_factory)
    monkeypatch.setattr(trash, "get_setting", lambda key: None)
    with store.session_scope() as session:
        session.add(
            MailAccount(
                id=ACCOUNT_ID,
                label="Me",
                email="me@x.org",
                username="me@x.org",
                password="secret",
                imap_host="imap.x.org",
                imap_port=993,
                smtp_host="smtp.x.org",
                smtp_port=465,
            )
        )
    yield session_factory
    engine.dispose()


@pytest.fixture
def client(factory: SessionFactory) -> TestClient:
    """
    Test client of the mail router

    Args:
        factory (SessionFactory): database fixture
    Returns:
        TestClient: client
    """
    app = FastAPI()
    app.include_router(views.mail.router)
    return TestClient(app)


def parsed(
    uid: int, sender: str, category: str = "person", is_read: bool = False
) -> ParsedMail:
    """
    Build a parsed message

    Args:
        uid (int): UID (also orders dates)
        sender (str): address
        category (str): category
        is_read (bool): server read state
    Returns:
        ParsedMail: message
    """
    return ParsedMail(
        uid=uid,
        folder="INBOX",
        message_id=f"<{uid}@x>",
        thread_refs=None,
        sender_email=sender,
        sender_name=sender.split("@")[0],
        recipients="me@x.org",
        cc="",
        subject=f"Mail {uid}",
        date=BASE_DATE + timedelta(minutes=uid),
        snippet="body",
        body_text="body",
        body_html=None,
        category=category,
        is_read=is_read,
    )


def seed(mails: list[ParsedMail]) -> None:
    """
    Store messages in the test account

    Args:
        mails (list[ParsedMail]): messages
    """
    with store.session_scope() as session:
        store.save_messages(session, ACCOUNT_ID, mails)


def subjects(client: TestClient, view: str, sender: str | None = None) -> list[str]:
    """
    Subjects listed in a view

    Args:
        client (TestClient): client
        view (str): view
        sender (str | None): sender filter
    Returns:
        list[str]: subjects, newest first
    """
    params = {"view": view, **({"sender": sender} if sender else {})}
    response = client.get("/mail/messages", params=params)
    assert response.status_code == 200, response.text
    return [row["subject"] for row in response.json()]


def test_views_follow_sender_flags_and_contacts(client: TestClient) -> None:
    """
    Rank messages: VIP and contacts high, unknown people normal, automated low, blocked hidden

    Returns:
        None
    """
    seed(
        [
            parsed(1, "boss@x.org"),
            parsed(2, "stranger@x.org"),
            parsed(3, "news@x.org", category="newsletter"),
            parsed(4, "spam@x.org"),
            parsed(5, "friend@x.org"),
        ]
    )
    with store.session_scope() as session:
        session.add(Contact(name="Friend", email="Friend@x.org"))
    client.put("/mail/senders/boss@x.org", json={"flag": "vip"})
    client.put("/mail/senders/spam@x.org", json={"flag": "blocked"})

    assert subjects(client, "priority") == ["Mail 5", "Mail 1"]
    assert subjects(client, "inbox") == ["Mail 5", "Mail 2", "Mail 1"]
    assert subjects(client, "others") == ["Mail 3"]
    assert subjects(client, "blocked") == ["Mail 4"]
    assert "Mail 4" not in subjects(client, "all")
    assert client.get("/mail/counts").json()["priority"] == 2


def test_muted_sender_mail_arrives_read(client: TestClient) -> None:
    """
    New messages of a muted sender are stored read and land in "others"

    Returns:
        None
    """
    client.put("/mail/senders/chatty@x.org", json={"flag": "muted"})
    seed([parsed(1, "chatty@x.org")])
    rows = client.get("/mail/messages", params={"view": "others"}).json()
    assert [(row["subject"], row["is_read"]) for row in rows] == [("Mail 1", True)]
    assert subjects(client, "unread") == []


def test_set_state_updates_locally_and_pushes_to_server(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Mark read locally and push \\Seen to IMAP

    Returns:
        None
    """
    pushed: list[tuple[int, str, bool]] = []

    def fake_store_flag(
        login: object, folder: str, uid: int, flag: str, on: bool
    ) -> None:
        pushed.append((uid, flag, on))

    monkeypatch.setattr(transport, "store_flag", fake_store_flag)
    seed([parsed(9, "a@x.org")])
    message_id = client.get("/mail/messages").json()[0]["id"]
    response = client.patch(f"/mail/messages/{message_id}", json={"is_read": True})
    assert response.json() == {"server_error": None}
    assert pushed == [(9, "\\Seen", True)]
    assert client.get(f"/mail/messages/{message_id}").json()["is_read"] is True


def test_summarize_stores_ai_triage(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Store the AI summary and expose the message in "needs_reply"

    Returns:
        None
    """
    answer = '{"summary": "Asks a question.", "needs_reply": true, "action": "Answer"}'
    monkeypatch.setattr(views.mail, "LLM", lambda prompt: answer)
    seed([parsed(1, "a@x.org")])
    message_id = client.get("/mail/messages").json()[0]["id"]
    body = client.post(f"/mail/messages/{message_id}/summarize").json()
    assert (body["summary"], body["needs_reply"]) == ("Asks a question.", True)
    assert subjects(client, "needs_reply") == ["Mail 1"]


def test_link_contact_creates_contact_once(client: TestClient) -> None:
    """
    Create the People contact of a sender once and raise its priority

    Returns:
        None
    """
    seed([parsed(1, "new@x.org")])
    first = client.post("/mail/senders/new@x.org/contact").json()["contact_id"]
    second = client.post("/mail/senders/new@x.org/contact").json()["contact_id"]
    assert first == second
    assert subjects(client, "priority") == ["Mail 1"]


def test_rejects_unknown_view_and_flag(client: TestClient) -> None:
    """
    Validate view names and sender flags

    Returns:
        None
    """
    assert client.get("/mail/messages", params={"view": "nope"}).status_code == 400
    assert client.put("/mail/senders/a@x.org", json={"flag": "nope"}).status_code == 422


def test_accounts_hide_password(client: TestClient) -> None:
    """
    Never return the stored password

    Returns:
        None
    """
    accounts = client.get("/mail/accounts").json()
    assert accounts[0]["email"] == "me@x.org"
    assert "password" not in accounts[0]


def test_last_uid_and_mark_all_read(factory: SessionFactory) -> None:
    """
    Track the highest UID and mark a whole view read

    Returns:
        None
    """
    seed([parsed(3, "a@x.org"), parsed(8, "b@x.org", is_read=True)])
    with store.session_scope() as session:
        assert store.last_uid(session, ACCOUNT_ID, "inbox") == 8
    assert service.mark_all_read(None, "inbox") == 1


def test_create_account_rejects_email_with_spaces(client: TestClient) -> None:
    """
    Refuse an email that is not a single bare address

    Returns:
        None
    """
    body = {
        "email": "Chad me@x.org",
        "password": "pw",
        "imap_host": "imap.x.org",
        "imap_port": 993,
        "smtp_host": "smtp.x.org",
        "smtp_port": 465,
    }
    response = client.post("/mail/accounts", json=body)
    assert response.status_code == 422
    assert "single address" in response.text


class FakeTransport:
    """Transport returning canned EWS-like messages per mailbox."""

    def __init__(
        self, fetched: list[FetchedMail], sent: list[FetchedMail] | None = None
    ) -> None:
        """
        Store the messages to return

        Args:
            fetched (list[FetchedMail]): inbox messages
            sent (list[FetchedMail] | None): Sent messages
        """
        self.boxes = {"inbox": fetched, "sent": sent or []}
        self.cursors: list[transport.FetchCursor] = []

    def fetch(
        self, mailbox: transport.MailboxKind, cursor: transport.FetchCursor, limit: int
    ) -> transport.FetchBatch:
        """
        Return the canned messages of a mailbox not known yet

        Args:
            mailbox (transport.MailboxKind): inbox or sent
            cursor (transport.FetchCursor): stored state
            limit (int): unused
        Returns:
            transport.FetchBatch: folder and messages
        """
        if mailbox == "inbox":
            self.cursors.append(cursor)
        mails = [m for m in self.boxes[mailbox] if m.remote_id not in cursor.known_ids]
        return transport.FetchBatch(mailbox.upper(), mails)


def test_sync_stores_remote_ids_and_skips_known(
    factory: SessionFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Store the Exchange item id and pass it back as known on the next sync

    Returns:
        None
    """
    raw = make_raw("Sub", "body")
    fake = FakeTransport([FetchedMail(1, raw, False, False, remote_id="AAMk=1")])
    monkeypatch.setattr(service, "transport_for", lambda link: fake)
    assert service.sync_account(ACCOUNT_ID).fetched == 1
    assert service.sync_account(ACCOUNT_ID).fetched == 0
    assert fake.cursors[1].known_ids == {"AAMk=1"}
    assert fake.cursors[1].last_uid == 1


def make_raw(subject: str, body: str) -> bytes:
    """
    Build raw message bytes

    Args:
        subject (str): subject
        body (str): text body
    Returns:
        bytes: RFC 822 message
    """
    message = EmailMessage()
    message["From"] = "Ann <ann@x.org>"
    message["Subject"] = subject
    message["Date"] = "Tue, 17 Nov 2026 09:30:00 +0000"
    message.set_content(body)
    return message.as_bytes()


def test_ews_account_sends_through_ews_endpoint(client: TestClient) -> None:
    """
    Accept an Exchange account without SMTP server; reject IMAP without one

    Returns:
        None
    """
    form = {"email": "me@corp.org", "password": "pw", "imap_host": "mail.corp.org"}
    imap = client.post("/mail/accounts", json={**form, "imap_port": 993})
    assert imap.status_code == 422
    assert "SMTP server required" in imap.text
    account = MailAccount()
    body = views.mail.AccountBody.parse_obj(
        {**form, "protocol": "ews", "imap_port": 443}
    )
    store.apply_account(account, body.to_input())
    assert (account.smtp_host, account.smtp_port) == ("mail.corp.org", 443)
    assert store.link_of(account).protocol == "ews"


def test_account_color_is_validated_and_stored() -> None:
    """
    Store a lowercase hex color; reject anything else

    Returns:
        None
    """
    form = {"email": "me@x.org", "imap_host": "imap.x.org", "imap_port": 993}
    form |= {"smtp_host": "smtp.x.org"}
    account = MailAccount()
    body = views.mail.AccountBody.parse_obj({**form, "color": "#AABBCC"})
    store.apply_account(account, body.to_input())
    assert account.color == "#aabbcc"
    assert store.account_view(account)["color"] == "#aabbcc"
    with pytest.raises(ValueError, match="Color"):
        views.mail.AccountBody.parse_obj({**form, "color": "red"})


def test_messages_of_contact_match_email_and_linked_senders(client: TestClient) -> None:
    """
    List mail from a contact's own address and from senders linked to it

    Returns:
        None
    """
    seed([parsed(1, "ann@x.org"), parsed(2, "ann@home.org"), parsed(3, "bob@x.org")])
    with store.session_scope() as session:
        session.add(Contact(id="c-ann", name="Ann", email="Ann@x.org"))
        session.flush()
        store.get_sender(session, "ann@home.org").contact_id = "c-ann"
    rows = client.get("/mail/messages", params={"view": "all", "contact_id": "c-ann"})
    assert [row["subject"] for row in rows.json()] == ["Mail 2", "Mail 1"]


def test_account_signature_is_stored_and_returned() -> None:
    """
    Keep the signature (trailing newlines trimmed) and expose it

    Returns:
        None
    """
    form = {"email": "me@x.org", "imap_host": "imap.x.org", "imap_port": 993}
    form |= {"smtp_host": "smtp.x.org", "signature": "Chad\nPhD student\n\n"}
    account = MailAccount()
    store.apply_account(account, views.mail.AccountBody.parse_obj(form).to_input())
    assert store.account_view(account)["signature"] == "Chad\nPhD student"


def test_sent_mail_has_own_view_and_stays_out_of_inbox(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Store Sent folder mail as read in the "sent" view only, without a sender row

    Returns:
        None
    """
    inbox = [FetchedMail(1, make_raw("Question", "x"), False, False, remote_id="i1")]
    sent = [FetchedMail(1, make_raw("My answer", "y"), False, False, remote_id="s1")]
    fake = FakeTransport(inbox, sent)
    monkeypatch.setattr(service, "transport_for", lambda link: fake)
    assert service.sync_account(ACCOUNT_ID).fetched == 2
    sent_rows = client.get("/mail/messages", params={"view": "sent"}).json()
    assert [(row["subject"], row["is_read"]) for row in sent_rows] == [
        ("My answer", True)
    ]
    assert subjects(client, "all") == ["Question"]


def test_pinned_mail_lists_first_and_has_a_view(client: TestClient) -> None:
    """
    Pin a message: it heads the list and appears in "pinned"

    Returns:
        None
    """
    seed([parsed(1, "a@x.org"), parsed(2, "b@x.org")])
    oldest = client.get("/mail/messages").json()[-1]["id"]
    client.patch(f"/mail/messages/{oldest}", json={"is_pinned": True})
    assert subjects(client, "inbox") == ["Mail 1", "Mail 2"]
    assert subjects(client, "pinned") == ["Mail 1"]
    assert client.get("/mail/counts").json()["pinned"] == 1


def test_activity_flag_is_stored_locally(client: TestClient) -> None:
    """
    Flag a message for the Activity feed and read the flag back

    Returns:
        None
    """
    seed([parsed(1, "a@x.org")])
    row = client.get("/mail/messages").json()[0]
    assert row["activity_flagged_at"] is None
    client.patch(f"/mail/messages/{row['id']}", json={"is_activity": True})
    detail = client.get(f"/mail/messages/{row['id']}").json()
    assert detail["activity_flagged_at"] is not None
    client.patch(f"/mail/messages/{row['id']}", json={"is_activity": False})
    assert (
        client.get(f"/mail/messages/{row['id']}").json()["activity_flagged_at"] is None
    )


def test_unflag_keeps_activity_flags_of_earlier_days(client: TestClient) -> None:
    """
    Unflag only the current activity flag, earlier days stay in history

    Returns:
        None
    """
    seed([parsed(1, "a@x.org")])
    yesterday = datetime(2026, 11, 18, 10)
    with store.session_scope() as session:
        message = session.scalars(select(MailMessage)).one()
        activity_flags.flag(session, message, yesterday)
        activity_flags.flag(session, message, yesterday + timedelta(days=1))
        activity_flags.unflag(session, message)
        assert message.activity_flagged_at is None
    with store.session_scope() as session:
        kept = session.scalars(select(MailActivityFlag.flagged_at)).all()
    assert kept == [yesterday]


def test_legacy_activity_column_becomes_flag_history(factory: SessionFactory) -> None:
    """
    Convert legacy is_activity flags to one flag at the message date, then drop the column

    Args:
        factory (SessionFactory): session factory of the test database
    Returns:
        None
    """
    seed([parsed(1, "a@x.org"), parsed(2, "b@x.org")])
    with factory() as session:
        engine = session.get_bind()
        assert isinstance(engine, Engine)
    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE mail_message ADD COLUMN is_activity BOOLEAN DEFAULT 0")
        )
        connection.execute(
            text(
                "UPDATE mail_message SET is_activity = 1 WHERE sender_email = 'a@x.org'"
            )
        )
    assert migrate_activity_flags(engine) == 1
    assert migrate_activity_flags(engine) == 0
    with store.session_scope() as session:
        flagged = session.execute(
            select(MailMessage.date, MailActivityFlag.flagged_at).join(
                MailActivityFlag, MailActivityFlag.message_id == MailMessage.id
            )
        ).all()
    assert [date for date, _ in flagged] == [moment for _, moment in flagged]
    assert len(flagged) == 1


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("04:00", timedelta(hours=4)),
        ("23:30", timedelta(hours=23, minutes=30)),
        ("24:00", timedelta(hours=4)),
        (None, timedelta(hours=4)),
    ],
)
def test_parse_reset_time(value: object, expected: timedelta) -> None:
    """
    Read "HH:MM" reset times, falling back to 04:00 when invalid

    Args:
        value (object): stored setting
        expected (timedelta): offset from midnight
    Returns:
        None
    """
    assert activity_flags.parse_reset(value) == expected


def test_rows_carry_the_sender_contact_for_its_photo(client: TestClient) -> None:
    """
    Expose the People contact of a sender (same email or linked) in list rows

    Returns:
        None
    """
    seed([parsed(1, "ann@x.org"), parsed(2, "bob@x.org")])
    with store.session_scope() as session:
        session.add(Contact(id="c-ann", name="Ann", email="ANN@x.org"))
    rows = client.get("/mail/messages", params={"view": "all"}).json()
    assert {row["sender_email"]: row["contact_id"] for row in rows} == {
        "ann@x.org": "c-ann",
        "bob@x.org": None,
    }


def test_search_filters_combine(client: TestClient) -> None:
    """
    Filter by sender text, recipients, dates, category, unread and attachments

    Returns:
        None
    """
    news = parsed(3, "news@shop.org", category="newsletter")
    seed([parsed(1, "ann@x.org"), parsed(2, "bob@y.org", is_read=True), news])
    with store.session_scope() as session:
        message = session.scalars(select(MailMessage).where(MailMessage.uid == 1)).one()
        message.attachments = '["a.pdf"]'
        message.recipients = "team@x.org"

    def filtered(**params: str) -> list[str]:
        """
        Subjects of the "all" view with filters

        Args:
            params (str): query parameters
        Returns:
            list[str]: subjects
        """
        rows = client.get("/mail/messages", params={"view": "all", **params}).json()
        return [row["subject"] for row in rows]

    assert filtered(from_text="BOB") == ["Mail 2"]
    assert filtered(to_text="team@") == ["Mail 1"]
    assert filtered(attachments="true") == ["Mail 1"]
    assert filtered(unread="true", category="person") == ["Mail 1"]
    assert filtered(category="newsletter") == ["Mail 3"]
    assert filtered(since="2026-11-17", until="2026-11-17") == [
        "Mail 3",
        "Mail 2",
        "Mail 1",
    ]
    assert filtered(since="2026-11-18") == []
    bad = client.get(
        "/mail/messages", params={"since": "2026-11-18", "until": "2026-11-17"}
    )
    assert bad.status_code == 400
    assert client.get("/mail/messages", params={"category": "x"}).status_code == 400


def addressed(uid: int, sender: str, recipients: str, cc: str = "") -> ParsedMail:
    """
    Build a parsed message with explicit recipients

    Args:
        uid (int): UID (also orders dates)
        sender (str): sender address
        recipients (str): To header
        cc (str): Cc header
    Returns:
        ParsedMail: message
    """
    mail = parsed(uid, sender)
    mail.recipients = recipients
    mail.cc = cc
    return mail


def suggested(client: TestClient, search: str) -> list[str]:
    """
    Addresses suggested for a search

    Args:
        client (TestClient): client
        search (str): text typed
    Returns:
        list[str]: addresses, best first
    """
    response = client.get("/mail/addresses", params={"search": search})
    assert response.status_code == 200, response.text
    return [row["email"] for row in response.json()]


def test_address_suggestions_cover_senders_recipients_and_cc(
    client: TestClient,
) -> None:
    """
    Suggest senders, To and Cc addresses, frequent first, without own or automated ones

    Returns:
        None
    """
    seed(
        [
            addressed(1, "Alice@x.org", "me@x.org, Bob Martin <bob@y.org>"),
            addressed(2, "alice@x.org", "me@x.org", cc="Carol <carol@z.org>"),
            addressed(3, "noreply@x.org", "me@x.org"),
        ]
    )
    assert suggested(client, "") == ["alice@x.org", "carol@z.org", "bob@y.org"]
    assert suggested(client, "martin") == ["bob@y.org"]
    rows = client.get("/mail/addresses", params={"search": "bob"}).json()
    assert rows[0]["name"] == "Bob Martin"


def test_address_suggestions_skip_blocked_and_automated_senders(
    client: TestClient,
) -> None:
    """
    Hide blocked senders and senders of newsletters

    Returns:
        None
    """
    seed([parsed(1, "spam@x.org"), parsed(2, "promo@x.org", category="newsletter")])
    client.put("/mail/senders/spam@x.org", json={"flag": "blocked"})
    assert suggested(client, "") == []


class FakeSender:
    """Transport recording sent bodies, failing while `error` is set."""

    def __init__(self) -> None:
        """
        Start with nothing sent and no error

        Returns:
            None
        """
        self.sent: list[str] = []
        self.error: str | None = None

    def send(self, mail: OutgoingMail, reply_to: object) -> None:
        """
        Record the body or fail like a refusing server

        Args:
            mail (OutgoingMail): outgoing message
            reply_to (object): replied message
        Returns:
            None
        Raises:
            MailServerError: while `error` is set
        """
        if self.error is not None:
            raise MailServerError(self.error)
        self.sent.append(mail.body)


@pytest.fixture
def sender(monkeypatch: pytest.MonkeyPatch) -> FakeSender:
    """
    Replace the mail transport and the post-send sync

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        FakeSender: transport recording sent bodies
    """
    fake = FakeSender()
    synced: list[str] = []
    monkeypatch.setattr(service, "transport_for", lambda link: fake)
    monkeypatch.setattr(service, "sync_account", synced.append)
    return fake


def queue_mail(client: TestClient, body: str = "Hi", quote: str = "") -> str:
    """
    Queue a message through the API

    Args:
        client (TestClient): client
        body (str): written text
        quote (str): quoted original
    Returns:
        str: Outbox id
    """
    payload = {"account_id": ACCOUNT_ID, "to": ["a@x.org"], "body": body}
    response = client.post("/mail/send", json={**payload, "quote": quote})
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "queued"
    return str(response.json()["id"])


def test_send_appends_account_signature(client: TestClient, sender: FakeSender) -> None:
    """
    Add the sending account's signature between the written text and the quote

    Args:
        client (TestClient): client
        sender (FakeSender): fake transport
    Returns:
        None
    """
    with store.session_scope() as session:
        store.get_account(session, ACCOUNT_ID).signature = "Me\nACME"
    queue_mail(client, quote="> q")
    assert outbox.send_next() is True
    assert sender.sent == ["Hi\n\nMe\nACME\n\n> q"]


def test_outbox_holds_mail_until_sent(client: TestClient, sender: FakeSender) -> None:
    """
    List queued mail in the Outbox, oldest first, and drop it once sent

    Args:
        client (TestClient): client
        sender (FakeSender): fake transport
    Returns:
        None
    """
    queue_mail(client, body="first")
    queue_mail(client, body="second")
    assert [row["body"] for row in client.get("/mail/outbox").json()] == [
        "first",
        "second",
    ]
    assert outbox.send_next() is True
    assert [row["body"] for row in client.get("/mail/outbox").json()] == ["second"]
    assert outbox.send_next() is True
    assert outbox.send_next() is False
    assert client.get("/mail/outbox").json() == []
    assert sender.sent == ["first", "second"]


def test_failed_mail_stays_in_outbox_until_retried(
    client: TestClient, sender: FakeSender
) -> None:
    """
    Keep a refused message with its error; retry sends it, discard removes it

    Args:
        client (TestClient): client
        sender (FakeSender): fake transport
    Returns:
        None
    """
    outgoing_id = queue_mail(client)
    sender.error = "550 rejected"
    outbox.send_next()
    [row] = client.get("/mail/outbox").json()
    assert (row["state"], row["error"], row["attempts"]) == (
        "failed",
        "550 rejected",
        1,
    )
    assert outbox.send_next() is False
    sender.error = None
    assert client.post(f"/mail/outbox/{outgoing_id}/retry").json()["state"] == "queued"
    outbox.send_next()
    assert client.get("/mail/outbox").json() == []
    assert sender.sent == ["Hi"]
    assert client.delete(f"/mail/outbox/{outgoing_id}").status_code == 404


def test_interrupted_sending_is_queued_again(client: TestClient) -> None:
    """
    Queue again a message left "sending" (backend stopped mid-send); discard it

    Args:
        client (TestClient): client
    Returns:
        None
    """
    outgoing_id = queue_mail(client)
    assert outbox.claim_next() is not None
    assert client.delete(f"/mail/outbox/{outgoing_id}").status_code == 409
    assert outbox.requeue_interrupted() == 1
    assert client.delete(f"/mail/outbox/{outgoing_id}").status_code == 200
    assert client.get("/mail/outbox").json() == []


def save_draft(
    client: TestClient, draft_id: str | None = None, **fields: object
) -> dict[str, object]:
    """
    Save a draft through the API

    Args:
        client (TestClient): client
        draft_id (str | None): draft to overwrite, None creates one
        **fields (object): compose fields on top of the test account
    Returns:
        dict[str, object]: saved draft
    """
    payload = {"account_id": ACCOUNT_ID, **fields}
    response = (
        client.post("/mail/drafts", json=payload)
        if draft_id is None
        else client.put(f"/mail/drafts/{draft_id}", json=payload)
    )
    assert response.status_code == 200, response.text
    result: dict[str, object] = response.json()
    return result


def test_draft_keeps_incomplete_fields_and_updates_in_place(client: TestClient) -> None:
    """
    Save a draft with a half-typed address, overwrite it, list it once

    Args:
        client (TestClient): client
    Returns:
        None
    """
    draft = save_draft(client, to=["bob@"], subject="Plan", kind="reply", quote="> q")
    assert (draft["to"], draft["kind"], draft["quote"]) == (["bob@"], "reply", "> q")
    save_draft(
        client, str(draft["id"]), to=["bob@x.org"], subject="Plan v2", kind="reply"
    )
    [row] = client.get("/mail/drafts").json()
    assert (row["id"], row["to"], row["subject"]) == (
        draft["id"],
        ["bob@x.org"],
        "Plan v2",
    )


def test_drafts_list_last_edited_first_and_delete(client: TestClient) -> None:
    """
    Order drafts by last edit; delete trashes one, a second delete is 404

    Args:
        client (TestClient): client
    Returns:
        None
    """
    first = save_draft(client, subject="first")
    save_draft(client, subject="second")
    save_draft(client, str(first["id"]), subject="first edited")
    assert [row["subject"] for row in client.get("/mail/drafts").json()] == [
        "first edited",
        "second",
    ]
    assert client.delete(f"/mail/drafts/{first['id']}").status_code == 200
    assert client.delete(f"/mail/drafts/{first['id']}").status_code == 404
    assert [row["subject"] for row in client.get("/mail/drafts").json()] == ["second"]


def test_draft_rejects_unknown_account_kind_and_id(client: TestClient) -> None:
    """
    Refuse drafts for a missing account, an unknown kind or a missing draft

    Args:
        client (TestClient): client
    Returns:
        None
    """
    assert client.post("/mail/drafts", json={"account_id": "nope"}).status_code == 404
    unknown_kind = {"account_id": ACCOUNT_ID, "kind": "memo"}
    assert client.post("/mail/drafts", json=unknown_kind).status_code == 422
    missing = client.put("/mail/drafts/nope", json={"account_id": ACCOUNT_ID})
    assert missing.status_code == 404


def test_sending_a_draft_moves_it_to_outbox(client: TestClient) -> None:
    """
    Queue a message written in a draft: it leaves Drafts and enters the Outbox

    Args:
        client (TestClient): client
    Returns:
        None
    """
    draft = save_draft(client, to=["a@x.org"], body="Hi")
    payload = {"account_id": ACCOUNT_ID, "to": ["a@x.org"], "body": "Hi"}
    response = client.post("/mail/send", json={**payload, "draft_id": draft["id"]})
    assert response.status_code == 200, response.text
    assert client.get("/mail/drafts").json() == []
    assert [row["body"] for row in client.get("/mail/outbox").json()] == ["Hi"]


class FakeMailbox:
    """Transport serving one raw message, like a server holding the original."""

    def __init__(self, raw: bytes) -> None:
        """
        Hold the raw message served

        Args:
            raw (bytes): RFC 822 message
        Returns:
            None
        """
        self.raw = raw

    def fetch_raw(self, ref: object) -> bytes:
        """
        Return the held message whatever the reference

        Args:
            ref (object): message reference
        Returns:
            bytes: RFC 822 message
        """
        return self.raw


def stored_message_id() -> str:
    """
    Id of the only stored message

    Returns:
        str: message id
    """
    with store.session_scope() as session:
        return str(session.scalars(select(MailMessage.id)).one())


def test_attachment_download_serves_file_with_safe_headers(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    Fetch the original from the server and serve one attachment as a sandboxed download

    Args:
        client (TestClient): client
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    mail = EmailMessage()
    mail["From"] = "a@x.org"
    mail.set_content("See attached")
    mail.add_attachment(
        b"\x89PNG data", maintype="image", subtype="png", filename="été.png"
    )
    seed([parsed(1, "a@x.org")])
    monkeypatch.setattr(
        service, "transport_for", lambda link: FakeMailbox(mail.as_bytes())
    )
    url = f"/mail/messages/{stored_message_id()}/attachments"
    response = client.get(f"{url}/0")
    assert response.status_code == 200, response.text
    assert response.content == b"\x89PNG data"
    assert response.headers["content-type"] == "image/png"
    assert (
        "filename*=UTF-8''%C3%A9t%C3%A9.png" in response.headers["content-disposition"]
    )
    assert response.headers["content-security-policy"] == "sandbox"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"{url}/1").status_code == 404
    assert client.get(f"{url}/-1").status_code == 422
    assert client.get("/mail/messages/nope/attachments/0").status_code == 404


def trash_contents(client: TestClient) -> tuple[list[str], list[str]]:
    """
    Subjects of the trashed messages and drafts

    Args:
        client (TestClient): client
    Returns:
        tuple[list[str], list[str]]: message subjects, draft subjects
    """
    response = client.get("/mail/trash")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["retention_days"] == trash.DEFAULT_RETENTION_DAYS
    return (
        [row["subject"] for row in body["messages"]],
        [row["subject"] for row in body["drafts"]],
    )


def test_deleted_mail_leaves_views_and_restores_in_one_call(client: TestClient) -> None:
    """
    Trash a message: gone from views and counts, listed in Trash, restored back

    Args:
        client (TestClient): client
    Returns:
        None
    """
    seed([parsed(1, "a@x.org"), parsed(2, "b@x.org")])
    message_id = stored_ids()["Mail 1"]
    assert client.delete(f"/mail/messages/{message_id}").status_code == 200
    assert subjects(client, "all") == ["Mail 2"]
    assert client.get("/mail/counts").json()["all"] == 1
    assert trash_contents(client) == (["Mail 1"], [])
    assert client.delete(f"/mail/messages/{message_id}").status_code == 404
    assert client.post(f"/mail/messages/{message_id}/restore").status_code == 200
    assert subjects(client, "all") == ["Mail 2", "Mail 1"]
    assert trash_contents(client) == ([], [])
    assert client.post(f"/mail/messages/{message_id}/restore").status_code == 404


def test_deleted_draft_goes_to_trash_and_restores(client: TestClient) -> None:
    """
    Trash a draft: out of Drafts, in Trash, back in Drafts after restore

    Args:
        client (TestClient): client
    Returns:
        None
    """
    draft = save_draft(client, subject="plan")
    assert client.delete(f"/mail/drafts/{draft['id']}").status_code == 200
    assert client.get("/mail/drafts").json() == []
    assert trash_contents(client) == ([], ["plan"])
    assert (
        client.put(
            f"/mail/drafts/{draft['id']}", json={"account_id": ACCOUNT_ID}
        ).status_code
        == 404
    )
    assert client.post(f"/mail/drafts/{draft['id']}/restore").status_code == 200
    assert [row["subject"] for row in client.get("/mail/drafts").json()] == ["plan"]


def age_trash(days: int) -> None:
    """
    Move every trash date back in time

    Args:
        days (int): days back
    """
    past = store.utc_now() - timedelta(days=days)
    with store.session_scope() as session:
        for message in session.scalars(select(MailMessage)):
            if message.trashed_at is not None:
                message.trashed_at = past
        for draft in session.scalars(select(MailDraft)):
            if draft.trashed_at is not None:
                draft.trashed_at = past


def test_trash_purges_after_retention_and_keeps_sync_cursor(
    client: TestClient,
) -> None:
    """
    Items older than the retention period are purged; the mail keeps a tombstone
    so its UID still counts and it is never fetched again

    Args:
        client (TestClient): client
    Returns:
        None
    """
    seed([parsed(1, "a@x.org"), parsed(2, "b@x.org")])
    old_id, recent_id = stored_ids()["Mail 2"], stored_ids()["Mail 1"]
    draft = save_draft(client, subject="old draft")
    client.delete(f"/mail/messages/{old_id}")
    client.delete(f"/mail/drafts/{draft['id']}")
    age_trash(trash.DEFAULT_RETENTION_DAYS + 1)
    client.delete(f"/mail/messages/{recent_id}")
    assert trash_contents(client) == (["Mail 1"], [])
    assert client.post(f"/mail/messages/{old_id}/restore").status_code == 404
    with store.session_scope() as session:
        assert store.last_uid(session, ACCOUNT_ID, "inbox") == 2
        purged = store.get_message(session, old_id)
        assert (purged.is_purged, purged.body_text, purged.subject) == (True, "", "")
    assert subjects(client, "all") == []


def test_empty_trash_purges_everything(client: TestClient) -> None:
    """
    Emptying the Trash removes every item at once

    Args:
        client (TestClient): client
    Returns:
        None
    """
    seed([parsed(1, "a@x.org")])
    client.delete(f"/mail/messages/{stored_ids()['Mail 1']}")
    draft = save_draft(client, subject="d")
    client.delete(f"/mail/drafts/{draft['id']}")
    assert client.delete("/mail/trash").json() == {"purged": 2}
    assert trash_contents(client) == ([], [])


def test_retention_setting_falls_back_on_bad_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Use the stored retention when valid, the default otherwise

    Args:
        monkeypatch (pytest.MonkeyPatch): pytest monkeypatch
    Returns:
        None
    """
    for stored, expected in ((7, 7), (0, 30), ("7", 30), (True, 30), (None, 30)):
        monkeypatch.setattr(trash, "get_setting", lambda key, value=stored: value)
        assert trash.retention_days() == expected


def stored_ids() -> dict[str, str]:
    """
    Ids of the stored messages by subject

    Returns:
        dict[str, str]: subject → id
    """
    with store.session_scope() as session:
        rows = session.execute(select(MailMessage.subject, MailMessage.id))
        return {subject: message_id for subject, message_id in rows}
