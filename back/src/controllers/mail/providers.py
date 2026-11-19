"""Connection presets of common mail providers."""

from dataclasses import asdict, dataclass

IMAP_SSL_PORT = 993
SMTP_SSL_PORT = 465
SMTP_STARTTLS_PORT = 587
HTTPS_PORT = 443


@dataclass(frozen=True)
class MailProvider:
    """Connection preset of one provider (empty host = the user types it)."""

    key: str
    label: str
    protocol: str
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int
    help: str
    help_url: str | None = None


PROVIDERS: list[MailProvider] = [
    MailProvider(
        "gmail",
        "Gmail",
        "imap",
        "imap.gmail.com",
        IMAP_SSL_PORT,
        "smtp.gmail.com",
        SMTP_SSL_PORT,
        "Gmail refuses your normal password: turn on 2-Step Verification, "
        "then create an app password and paste it below.",
        "https://myaccount.google.com/apppasswords",
    ),
    MailProvider(
        "icloud",
        "iCloud",
        "imap",
        "imap.mail.me.com",
        IMAP_SSL_PORT,
        "smtp.mail.me.com",
        SMTP_STARTTLS_PORT,
        "Use an app-specific password (Sign-In and Security → App-Specific Passwords).",
        "https://account.apple.com",
    ),
    MailProvider(
        "yahoo",
        "Yahoo",
        "imap",
        "imap.mail.yahoo.com",
        IMAP_SSL_PORT,
        "smtp.mail.yahoo.com",
        SMTP_SSL_PORT,
        "Use an app password (Account security → Generate app password).",
        "https://login.yahoo.com/account/security",
    ),
    MailProvider(
        "fastmail",
        "Fastmail",
        "imap",
        "imap.fastmail.com",
        IMAP_SSL_PORT,
        "smtp.fastmail.com",
        SMTP_SSL_PORT,
        "Use an app password (Settings → Privacy & Security → Manage app passwords).",
    ),
    MailProvider(
        "exchange",
        "Exchange (on-premises, EWS)",
        "ews",
        "",
        HTTPS_PORT,
        "",
        HTTPS_PORT,
        "Server name (mail.company.com) or full EWS URL "
        "(https://mail.company.com/EWS/Exchange.asmx). Login is often DOMAIN\\user. "
        "Microsoft 365 / Outlook.com accept only OAuth logins: not supported yet.",
    ),
]


def provider_presets() -> list[dict[str, object]]:
    """
    List the provider presets as JSON-ready dicts

    Returns:
        list[dict[str, object]]: presets
    """
    return [asdict(provider) for provider in PROVIDERS]
