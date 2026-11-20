"""Turn Overleaf history updates, labels and comment threads into activities."""

from dataclasses import dataclass
from datetime import UTC, datetime

from controllers.activity.base import Activity, to_naive_utc
from controllers.activity.common import excerpt
from controllers.activity.overleaf_client import (
    MILLISECONDS_PER_SECOND,
    JsonObject,
    objects,
)

OVERLEAF_SOURCE = "overleaf"
EDIT_KIND = "edit"
VERSION_KIND = "version"
COMMENT_KIND = "comment"
KIND_LABELS = (
    (EDIT_KIND, "Edits"),
    (VERSION_KIND, "Labelled versions"),
    (COMMENT_KIND, "Comments"),
)
MAX_TITLE_FILES = 3
MAX_LISTED_FILES = 10
# Text changes kept per file and per activity: the AI context must stay bounded.
MAX_FILE_DIFF_CHARS = 3000
MAX_CHANGES_CHARS = 12000
MAX_DIFF_FILES = 5
TRUNCATED = "… (truncated)"
INSERTED = "i"
DELETED = "d"


@dataclass(frozen=True)
class Project:
    """Watched project: id, display name and web link."""

    id: str
    name: str
    link: str


def obj(parent: JsonObject, key: str) -> JsonObject:
    """
    Child object of a JSON object

    Args:
        parent (JsonObject): object
        key (str): key
    Returns:
        JsonObject: child, empty when missing or not an object
    """
    value = parent.get(key)
    return value if isinstance(value, dict) else {}


def text(parent: JsonObject, key: str) -> str:
    """
    Text value of a JSON object

    Args:
        parent (JsonObject): object
        key (str): key
    Returns:
        str: value as text, "" when missing
    """
    value = parent.get(key)
    return "" if value is None else str(value)


def strings(parent: JsonObject, key: str) -> list[str]:
    """
    String items of a JSON list

    Args:
        parent (JsonObject): object
        key (str): key
    Returns:
        list[str]: strings, empty when missing
    """
    value = parent.get(key)
    items = value if isinstance(value, list) else []
    return [item for item in items if isinstance(item, str)]


def version_of(update: JsonObject, key: str) -> int:
    """
    History version number of an update

    Args:
        update (JsonObject): history update
        key (str): "fromV" or "toV"
    Returns:
        int: version, 0 when missing or not a number
    """
    value = update.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def moment_of(value: object) -> datetime | None:
    """
    Read an Overleaf timestamp: Unix milliseconds or ISO text

    Args:
        value (object): raw timestamp
    Returns:
        datetime | None: naive UTC moment, None when missing or invalid
    """
    if isinstance(value, int | float) and not isinstance(value, bool):
        seconds = value / MILLISECONDS_PER_SECOND
        return datetime.fromtimestamp(seconds, UTC).replace(tzinfo=None)
    if not isinstance(value, str):
        return None
    try:
        return to_naive_utc(datetime.fromisoformat(value))
    except ValueError:
        return None


def user_name(user: JsonObject) -> str:
    """
    Display name of an Overleaf user

    Args:
        user (JsonObject): user (first_name, last_name, email)
    Returns:
        str: "First Last", else the email, "" when unknown
    """
    name = f"{text(user, 'first_name')} {text(user, 'last_name')}".strip()
    return name or text(user, "email")


def update_users(update: JsonObject) -> list[JsonObject]:
    """
    Authors of a history update

    Args:
        update (JsonObject): history update
    Returns:
        list[JsonObject]: users
    """
    return objects(obj(update, "meta").get("users"))


def is_by(update: JsonObject, user_id: str) -> bool:
    """
    Tell whether a user took part in a history update

    Args:
        update (JsonObject): history update
        user_id (str): Overleaf user id
    Returns:
        bool: True when among the authors
    """
    return any(text(user, "id") == user_id for user in update_users(update))


def operation_text(operation: JsonObject) -> str:
    """
    Describe one file operation (add, rename, remove)

    Args:
        operation (JsonObject): project_ops item
    Returns:
        str: "added x", "renamed x → y", "deleted x", "" when unknown
    """
    if "add" in operation:
        return f"added {text(obj(operation, 'add'), 'pathname')}"
    if "rename" in operation:
        rename = obj(operation, "rename")
        return f"renamed {text(rename, 'pathname')} → {text(rename, 'newPathname')}"
    if "remove" in operation:
        return f"deleted {text(obj(operation, 'remove'), 'pathname')}"
    return ""


def operations_text(update: JsonObject) -> str:
    """
    Describe the file operations of a history update

    Args:
        update (JsonObject): history update
    Returns:
        str: operations joined by "; ", "" when none
    """
    described = map(operation_text, objects(update.get("project_ops")))
    return "; ".join(item for item in described if item)


def edit_title(files: list[str], project: Project) -> str:
    """
    Title of an edit: first files and the project

    Args:
        files (list[str]): edited files
        project (Project): project
    Returns:
        str: "Edited a.tex, b.tex in Thesis" (or "Changed files in Thesis")
    """
    if not files:
        return f"Changed files in {project.name}"
    shown = ", ".join(files[:MAX_TITLE_FILES])
    more = len(files) - MAX_TITLE_FILES
    suffix = f" (+{more} more)" if more > 0 else ""
    return f"Edited {shown}{suffix} in {project.name}"


def edit_activity(update: JsonObject, project: Project) -> Activity | None:
    """
    Convert one history update into an edit

    Args:
        update (JsonObject): history update
        project (Project): project
    Returns:
        Activity | None: edit, None without moment or change
    """
    moment = moment_of(obj(update, "meta").get("end_ts"))
    files = strings(update, "pathnames")
    operations = operations_text(update)
    if moment is None or not (files or operations):
        return None
    details = {"project": project.name}
    if files:
        details["files"] = ", ".join(files[:MAX_LISTED_FILES])
    return Activity(
        id=f"{OVERLEAF_SOURCE}:{project.id}:v{text(update, 'toV')}",
        source=OVERLEAF_SOURCE,
        kind=EDIT_KIND,
        occurred_at=moment,
        title=edit_title(files, project),
        summary=operations,
        actors=tuple(filter(None, map(user_name, update_users(update)))),
        link=project.link,
        details=details,
    )


def label_activity(
    label: JsonObject, project: Project, names: dict[str, str]
) -> Activity | None:
    """
    Convert one labelled version

    Args:
        label (JsonObject): label (id, comment, user_id, created_at)
        project (Project): project
        names (dict[str, str]): user id -> display name
    Returns:
        Activity | None: version, None without moment
    """
    moment = moment_of(label.get("created_at"))
    if moment is None:
        return None
    author = names.get(text(label, "user_id"), "")
    return Activity(
        id=f"{OVERLEAF_SOURCE}:{project.id}:label:{text(label, 'id')}",
        source=OVERLEAF_SOURCE,
        kind=VERSION_KIND,
        occurred_at=moment,
        title=f'Labelled version "{text(label, "comment")}" in {project.name}',
        actors=(author,) if author else (),
        link=project.link,
        details={"project": project.name},
    )


def user_names(updates: list[JsonObject]) -> dict[str, str]:
    """
    Display names of every author met in the history

    Args:
        updates (list[JsonObject]): history updates
    Returns:
        dict[str, str]: user id -> display name
    """
    return {
        text(user, "id"): user_name(user)
        for update in updates
        for user in update_users(update)
    }


def history_labels(updates: list[JsonObject], user_id: str) -> list[JsonObject]:
    """
    Labels of the history, each once, optionally only those of one user

    Args:
        updates (list[JsonObject]): history updates
        user_id (str): keep only this user's labels, "" for everyone
    Returns:
        list[JsonObject]: labels
    """
    labels = {
        text(label, "id"): label
        for update in updates
        for label in objects(update.get("labels"))
    }
    return [
        label
        for label in labels.values()
        if not user_id or text(label, "user_id") == user_id
    ]


def message_author(message: JsonObject) -> str:
    """
    Id of the author of a comment message

    Args:
        message (JsonObject): message (user_id, user)
    Returns:
        str: user id
    """
    return text(message, "user_id") or text(obj(message, "user"), "id")


def message_activity(
    message: JsonObject, project: Project, is_first: bool
) -> Activity | None:
    """
    Convert one comment message

    Args:
        message (JsonObject): message (id, content, timestamp, user)
        project (Project): project
        is_first (bool): message opens its thread
    Returns:
        Activity | None: comment, None without moment
    """
    moment = moment_of(message.get("timestamp"))
    if moment is None:
        return None
    author = user_name(obj(message, "user"))
    verb = "Commented" if is_first else "Replied to a comment"
    return Activity(
        id=f"{OVERLEAF_SOURCE}:{project.id}:comment:{text(message, 'id')}",
        source=OVERLEAF_SOURCE,
        kind=COMMENT_KIND,
        occurred_at=moment,
        title=f"{verb} in {project.name}",
        summary=excerpt(text(message, "content")),
        actors=(author,) if author else (),
        link=project.link,
        details={"project": project.name},
    )


def resolved_activity(
    thread_id: str, thread: JsonObject, project: Project
) -> Activity | None:
    """
    Convert the resolution of a comment thread

    Args:
        thread_id (str): thread id
        thread (JsonObject): thread (messages, resolved, resolved_at, resolved_by_user)
        project (Project): project
    Returns:
        Activity | None: comment, None when not resolved or without moment
    """
    moment = moment_of(thread.get("resolved_at"))
    if thread.get("resolved") is not True or moment is None:
        return None
    author = user_name(obj(thread, "resolved_by_user"))
    messages = objects(thread.get("messages"))
    opening = text(messages[0], "content") if messages else ""
    return Activity(
        id=f"{OVERLEAF_SOURCE}:{project.id}:resolved:{thread_id}",
        source=OVERLEAF_SOURCE,
        kind=COMMENT_KIND,
        occurred_at=moment,
        title=f"Resolved a comment in {project.name}",
        summary=excerpt(opening),
        actors=(author,) if author else (),
        link=project.link,
        details={"project": project.name},
    )


def thread_activities(
    thread_id: str, thread: JsonObject, project: Project, user_id: str
) -> list[Activity]:
    """
    Convert the messages and resolution of one comment thread

    Args:
        thread_id (str): thread id
        thread (JsonObject): thread
        project (Project): project
        user_id (str): keep only this user's actions, "" for everyone
    Returns:
        list[Activity]: comments
    """
    found = [
        message_activity(message, project, index == 0)
        for index, message in enumerate(objects(thread.get("messages")))
        if not user_id or message_author(message) == user_id
    ]
    resolver = text(obj(thread, "resolved_by_user"), "id")
    if not user_id or resolver == user_id:
        found.append(resolved_activity(thread_id, thread, project))
    return [item for item in found if item is not None]


def clip(value: str, limit: int) -> str:
    """
    Cut text to a maximum length, marking the cut

    Args:
        value (str): text
        limit (int): maximum length
    Returns:
        str: text, ending with TRUNCATED when cut
    """
    return value if len(value) <= limit else value[:limit] + TRUNCATED


def marked_lines(part: str, mark: str) -> list[str]:
    """
    Prefix every non-blank line of an inserted or deleted part

    Args:
        part (str): inserted or deleted text
        mark (str): "+" or "-"
    Returns:
        list[str]: marked lines
    """
    return [f"{mark} {line}" for line in part.splitlines() if line.strip()]


def diff_text(payload: object) -> str:
    """
    Inserted and deleted text of one /diff answer (unchanged text left out)

    Args:
        payload (object): decoded JSON ({"diff": [{"u"|"i"|"d": text}, …]})
    Returns:
        str: "+ inserted" / "- deleted" lines, clipped; "" for binary or no change
    """
    body = payload if isinstance(payload, dict) else {}
    lines: list[str] = []
    for part in objects(body.get("diff")):
        lines += marked_lines(text(part, INSERTED), "+")
        lines += marked_lines(text(part, DELETED), "-")
    return clip("\n".join(lines), MAX_FILE_DIFF_CHARS)
