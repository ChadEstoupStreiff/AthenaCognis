"""Turn GitHub events (Events API) into activities."""

from collections.abc import Callable
from datetime import datetime

from controllers.activity.base import Activity, to_naive_utc
from controllers.activity.common import excerpt
from controllers.activity.github_client import objects

GITHUB_SOURCE = "github"
GITHUB_WEB = "https://github.com"
BRANCH_PREFIX = "refs/heads/"
MAX_COMMIT_MESSAGES = 5
MAX_LISTED_FILES = 10
# Diff kept per file and per activity: the AI context must stay bounded.
MAX_FILE_PATCH_CHARS = 5000
MAX_CODE_CHARS = 20000
TRUNCATED = "… (truncated)"
SHORT_SHA = 7
COMMENT_EVENTS = (
    "IssueCommentEvent",
    "PullRequestReviewCommentEvent",
    "CommitCommentEvent",
)
# Event type -> activity kind (also the values of the "kinds" setting).
EVENT_KINDS: dict[str, str] = {
    "PushEvent": "push",
    # Commit read from the Commits API, not yet published as a push event.
    "CommitEvent": "push",
    "PullRequestEvent": "pull_request",
    "PullRequestReviewEvent": "review",
    "IssuesEvent": "issue",
    "CreateEvent": "branch",
    "DeleteEvent": "branch",
    "ReleaseEvent": "release",
    **dict.fromkeys(COMMENT_EVENTS, "comment"),
}
# Actions worth a day summary; others (labeled, assigned, edited…) are noise.
KEPT_ACTIONS: dict[str, frozenset[str]] = {
    "PullRequestEvent": frozenset(
        {"opened", "closed", "merged", "reopened", "ready_for_review"}
    ),
    "IssuesEvent": frozenset({"opened", "closed", "reopened"}),
}
KIND_LABELS = (
    ("push", "Pushes"),
    ("pull_request", "Pull requests"),
    ("review", "Reviews"),
    ("issue", "Issues"),
    ("comment", "Comments"),
    ("branch", "Branches and tags"),
    ("release", "Releases"),
)

JsonObject = dict[str, object]


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


def event_moment(event: JsonObject) -> datetime | None:
    """
    Creation moment of an event

    Args:
        event (JsonObject): event
    Returns:
        datetime | None: naive UTC moment, None when missing or invalid
    """
    try:
        return to_naive_utc(datetime.fromisoformat(text(event, "created_at")))
    except ValueError:
        return None


def push_parts(repo: str, payload: JsonObject) -> tuple[str, str, str]:
    """
    Title, summary and link of a push

    Args:
        repo (str): "owner/repo"
        payload (JsonObject): event payload
    Returns:
        tuple[str, str, str]: title, commit messages, compare (or branch) link
    """
    branch = text(payload, "ref").removeprefix(BRANCH_PREFIX)
    raw_commits = payload.get("commits")
    commits = [
        item
        for item in (raw_commits if isinstance(raw_commits, list) else [])
        if isinstance(item, dict)
    ]
    messages = [
        text(item, "message").splitlines()[0]
        for item in commits
        if text(item, "message")
    ]
    count = len(commits)
    title = (
        f"Pushed {count} commit{'s' if count != 1 else ''} to {branch}"
        if count
        else f"Pushed to {branch}"
    )
    before, head = text(payload, "before"), text(payload, "head")
    link = (
        f"{GITHUB_WEB}/{repo}/compare/{before[:12]}...{head[:12]}"
        if before and head
        else f"{GITHUB_WEB}/{repo}/tree/{branch}"
    )
    return title, "; ".join(messages[:MAX_COMMIT_MESSAGES]), link


def commit_parts(repo: str, payload: JsonObject) -> tuple[str, str, str]:
    """
    Title, summary and link of a commit not yet published as a push

    Args:
        repo (str): "owner/repo"
        payload (JsonObject): CommitEvent payload
    Returns:
        tuple[str, str, str]: first message line, short SHA, commit link
    """
    sha = text(payload, "sha")
    lines = text(payload, "message").splitlines()
    title = lines[0] if lines else f"Commit {sha[:SHORT_SHA]}"
    link = text(payload, "html_url") or f"{GITHUB_WEB}/{repo}/commit/{sha}"
    return title, f"Commit {sha[:SHORT_SHA]}", link


def numbered(prefix: str, number: str, title: str) -> str:
    """
    Name a pull request or issue

    Args:
        prefix (str): e.g. "PR" or "issue"
        number (str): number
        title (str): title, may be empty (slim event payloads)
    Returns:
        str: "prefix #N: title" or "prefix #N"
    """
    return f"{prefix} #{number}: {title}" if title else f"{prefix} #{number}"


def pull_number(payload: JsonObject) -> str:
    """
    Number of the pull request of an event

    Args:
        payload (JsonObject): event payload
    Returns:
        str: number, "" when missing
    """
    return text(obj(payload, "pull_request"), "number") or text(payload, "number")


def pull_request_parts(repo: str, payload: JsonObject) -> tuple[str, str, str]:
    """
    Title, summary and link of a pull request event

    Args:
        repo (str): "owner/repo"
        payload (JsonObject): event payload
    Returns:
        tuple[str, str, str]: title, body excerpt, PR link
    """
    pull = obj(payload, "pull_request")
    number = pull_number(payload)
    action = text(payload, "action")
    if action == "closed" and pull.get("merged"):
        action = "merged"
    verb = action.replace("_", " ").capitalize()
    link = text(pull, "html_url") or f"{GITHUB_WEB}/{repo}/pull/{number}"
    title = f"{verb} {numbered('PR', number, text(pull, 'title'))}"
    return title, excerpt(text(pull, "body")), link


def review_parts(repo: str, payload: JsonObject) -> tuple[str, str, str]:
    """
    Title, summary and link of a review

    Args:
        repo (str): "owner/repo"
        payload (JsonObject): event payload
    Returns:
        tuple[str, str, str]: title, review excerpt, review link
    """
    pull, review = obj(payload, "pull_request"), obj(payload, "review")
    number = pull_number(payload)
    state = text(review, "state").replace("_", " ").lower() or "reviewed"
    title = f"Review ({state}) on {numbered('PR', number, text(pull, 'title'))}"
    link = text(review, "html_url") or f"{GITHUB_WEB}/{repo}/pull/{number}"
    return title, excerpt(text(review, "body")), link


def issue_parts(repo: str, payload: JsonObject) -> tuple[str, str, str]:
    """
    Title, summary and link of an issue event

    Args:
        repo (str): "owner/repo"
        payload (JsonObject): event payload
    Returns:
        tuple[str, str, str]: title, body excerpt, issue link
    """
    issue = obj(payload, "issue")
    number = text(issue, "number")
    verb = text(payload, "action").capitalize()
    title = f"{verb} {numbered('issue', number, text(issue, 'title'))}"
    link = text(issue, "html_url") or f"{GITHUB_WEB}/{repo}/issues/{number}"
    return title, excerpt(text(issue, "body")), link


def comment_parts(repo: str, payload: JsonObject) -> tuple[str, str, str]:
    """
    Title, summary and link of a comment (issue, PR review or commit)

    Args:
        repo (str): "owner/repo"
        payload (JsonObject): event payload
    Returns:
        tuple[str, str, str]: title, comment excerpt, comment link
    """
    comment = obj(payload, "comment")
    target = obj(payload, "issue") or obj(payload, "pull_request")
    about = (
        f"#{text(target, 'number')}: {text(target, 'title')}" if target else "a commit"
    )
    link = text(comment, "html_url") or f"{GITHUB_WEB}/{repo}"
    return f"Commented on {about}", excerpt(text(comment, "body")), link


def ref_parts(repo: str, payload: JsonObject, is_delete: bool) -> tuple[str, str, str]:
    """
    Title, summary and link of a branch / tag creation or deletion

    Args:
        repo (str): "owner/repo"
        payload (JsonObject): event payload
        is_delete (bool): DeleteEvent
    Returns:
        tuple[str, str, str]: title, description, repository link
    """
    ref_type, ref = text(payload, "ref_type"), text(payload, "ref")
    verb = "Deleted" if is_delete else "Created"
    title = f"{verb} {ref_type} {ref}".strip()
    return title, excerpt(text(payload, "description")), f"{GITHUB_WEB}/{repo}"


def release_parts(repo: str, payload: JsonObject) -> tuple[str, str, str]:
    """
    Title, summary and link of a release

    Args:
        repo (str): "owner/repo"
        payload (JsonObject): event payload
    Returns:
        tuple[str, str, str]: title, notes excerpt, release link
    """
    release = obj(payload, "release")
    name = text(release, "name") or text(release, "tag_name")
    title = f"{text(payload, 'action').capitalize()} release {name}"
    return (
        title,
        excerpt(text(release, "body")),
        text(release, "html_url") or f"{GITHUB_WEB}/{repo}/releases",
    )


PartsBuilder = Callable[[str, JsonObject], tuple[str, str, str]]
BUILDERS: dict[str, PartsBuilder] = {
    "PushEvent": push_parts,
    "CommitEvent": commit_parts,
    "PullRequestEvent": pull_request_parts,
    "PullRequestReviewEvent": review_parts,
    "IssuesEvent": issue_parts,
    "CreateEvent": lambda repo, payload: ref_parts(repo, payload, is_delete=False),
    "DeleteEvent": lambda repo, payload: ref_parts(repo, payload, is_delete=True),
    "ReleaseEvent": release_parts,
    **dict.fromkeys(COMMENT_EVENTS, comment_parts),
}


def event_kind(event: JsonObject) -> str | None:
    """
    Activity kind of an event

    Args:
        event (JsonObject): Events API item
    Returns:
        str | None: kind, None for unsupported types and noisy actions
    """
    event_type = text(event, "type")
    kept = KEPT_ACTIONS.get(event_type)
    if kept is not None and text(obj(event, "payload"), "action") not in kept:
        return None
    return EVENT_KINDS.get(event_type)


def event_actor(event: JsonObject) -> str:
    """
    Login of the user who made an event

    Args:
        event (JsonObject): Events API item
    Returns:
        str: login, "" when missing
    """
    return text(obj(event, "actor"), "login")


def branch_of(event_type: str, payload: JsonObject) -> str:
    """
    Branch an event is about

    Args:
        event_type (str): event type
        payload (JsonObject): event payload
    Returns:
        str: pushed branch, or the pull request source branch; "" when none
    """
    if event_type == "PushEvent":
        return text(payload, "ref").removeprefix(BRANCH_PREFIX)
    return text(obj(obj(payload, "pull_request"), "head"), "ref")


def files_text(payload: JsonObject) -> str:
    """
    Files changed by a push (listed by the completion step)

    Args:
        payload (JsonObject): event payload
    Returns:
        str: "a, b, … (+N more)", "" when unknown
    """
    raw = payload.get("files")
    files = [str(name) for name in raw if name] if isinstance(raw, list) else []
    if not files:
        return ""
    listed = ", ".join(files[:MAX_LISTED_FILES])
    extra = len(files) - MAX_LISTED_FILES
    return f"{listed} (+{extra} more)" if extra > 0 else listed


def pull_size(payload: JsonObject) -> str:
    """
    Size of the pull request of an event

    Args:
        payload (JsonObject): event payload
    Returns:
        str: "+added −removed in N files", "" when unknown
    """
    pull = obj(payload, "pull_request")
    if "changed_files" not in pull:
        return ""
    return (
        f"+{text(pull, 'additions')} −{text(pull, 'deletions')} "
        f"in {text(pull, 'changed_files')} files"
    )


def clip(value: str, limit: int) -> str:
    """
    Cut a text to a length, marking the cut

    Args:
        value (str): text
        limit (int): maximum characters
    Returns:
        str: text, cut and marked when longer
    """
    return value if len(value) <= limit else value[:limit] + TRUNCATED


def code_text(payload: JsonObject) -> str:
    """
    Diff of an event, file by file, bounded

    Args:
        payload (JsonObject): event payload (with "patches" once fetched)
    Returns:
        str: "--- file\\n<diff>" blocks, "" when unknown
    """
    blocks = [
        f"--- {text(item, 'filename')}\n"
        + (clip(text(item, "patch"), MAX_FILE_PATCH_CHARS) or "(binary or too large)")
        for item in objects(payload.get("patches"))
    ]
    return clip("\n".join(blocks), MAX_CODE_CHARS)


def event_details(event_type: str, repo: str, payload: JsonObject) -> dict[str, str]:
    """
    Details of an event: repository, branch, changed files, pull request size, diff

    Args:
        event_type (str): event type
        repo (str): "owner/repo"
        payload (JsonObject): event payload
    Returns:
        dict[str, str]: non-empty details
    """
    details = {
        "repo": repo,
        "branch": branch_of(event_type, payload),
        "files": files_text(payload),
        "changes": pull_size(payload),
        "code": code_text(payload),
    }
    return {key: value for key, value in details.items() if value}


def event_activity(event: JsonObject) -> Activity | None:
    """
    Convert one GitHub event

    Args:
        event (JsonObject): Events API item
    Returns:
        Activity | None: activity, None for unsupported, noisy or malformed events
    """
    kind = event_kind(event)
    moment = event_moment(event)
    if kind is None or moment is None:
        return None
    event_type = text(event, "type")
    builder = BUILDERS[event_type]
    repo = text(obj(event, "repo"), "name")
    payload = obj(event, "payload")
    title, summary, link = builder(repo, payload)
    actor = event_actor(event)
    return Activity(
        id=f"github:{text(event, 'id')}",
        source=GITHUB_SOURCE,
        kind=kind,
        occurred_at=moment,
        title=title,
        summary=summary,
        actors=(actor,) if actor else (),
        link=link,
        details=event_details(event_type, repo, payload),
    )
