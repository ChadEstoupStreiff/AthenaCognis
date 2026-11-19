"""Include / exclude regex filters shared by every data source."""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING

from controllers.activity.config import ConfigField, SourceConfig, options_of

if TYPE_CHECKING:
    from controllers.activity.base import Activity

INCLUDE_FIELD = "include_regex"
EXCLUDE_FIELD = "exclude_regex"
TARGETS_FIELD = "regex_fields"
TITLE_TARGET = "title"
SUMMARY_TARGET = "summary"
PEOPLE_TARGET = "people"
DETAILS_TARGET = "details"
TARGET_OPTIONS = options_of(
    [
        (TITLE_TARGET, "Title"),
        (SUMMARY_TARGET, "Summary"),
        (PEOPLE_TARGET, "People"),
        (DETAILS_TARGET, "Details"),
    ]
)
FILTER_FIELDS: tuple[ConfigField, ...] = (
    ConfigField(
        INCLUDE_FIELD,
        "Only items matching",
        "Regex, case-insensitive. Empty: every item.",
        "text",
        "",
    ),
    ConfigField(
        EXCLUDE_FIELD,
        "Skip items matching",
        "Regex, case-insensitive. Empty: skip nothing.",
        "text",
        "",
    ),
    ConfigField(
        TARGETS_FIELD,
        "Regex applies to",
        "None picked: every field.",
        "multiselect",
        (),
        TARGET_OPTIONS,
        "All fields",
    ),
)


class InvalidFilterError(ValueError):
    """A regex filter setting does not compile."""


def compile_filter(pattern: str, label: str) -> re.Pattern[str] | None:
    """
    Compile a filter regex, case-insensitive

    Args:
        pattern (str): regex, empty for no filter
        label (str): filter name for the error message
    Returns:
        re.Pattern[str] | None: compiled regex, None when empty
    Raises:
        InvalidFilterError: regex does not compile
    """
    if not pattern:
        return None
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error as error:
        raise InvalidFilterError(
            f"Invalid {label} regex '{pattern}': {error}"
        ) from error


def field_texts(activity: "Activity", targets: Sequence[str]) -> list[str]:
    """
    Texts of the chosen activity fields

    Args:
        activity (Activity): activity
        targets (Sequence[str]): TARGET_OPTIONS values, empty for every field
    Returns:
        list[str]: one text per chosen field
    """
    texts = {
        TITLE_TARGET: activity.title,
        SUMMARY_TARGET: activity.summary,
        PEOPLE_TARGET: "\n".join(activity.actors),
        DETAILS_TARGET: "\n".join(
            f"{key}={value}" for key, value in activity.details.items()
        ),
    }
    return [texts[target] for target in targets or texts]


@dataclass(frozen=True)
class ActivityFilter:
    """Keep activities matching the include regex and not the exclude regex."""

    include: re.Pattern[str] | None
    exclude: re.Pattern[str] | None
    targets: tuple[str, ...]

    @classmethod
    def from_config(cls, config: SourceConfig) -> "ActivityFilter":
        """
        Read the filter settings of a source

        Args:
            config (SourceConfig): source settings (with FILTER_FIELDS)
        Returns:
            ActivityFilter: filter
        Raises:
            InvalidFilterError: a regex does not compile
        """
        return cls(
            compile_filter(config.text(INCLUDE_FIELD), "include"),
            compile_filter(config.text(EXCLUDE_FIELD), "exclude"),
            config.choices(TARGETS_FIELD),
        )

    def _matches(self, pattern: re.Pattern[str], activity: "Activity") -> bool:
        """
        Tell whether a regex matches any chosen field

        Args:
            pattern (re.Pattern[str]): regex
            activity (Activity): activity
        Returns:
            bool: True on a match
        """
        return any(pattern.search(text) for text in field_texts(activity, self.targets))

    def keeps(self, activity: "Activity") -> bool:
        """
        Tell whether an activity passes the filter

        Args:
            activity (Activity): activity
        Returns:
            bool: True when included and not excluded
        """
        if self.include is not None and not self._matches(self.include, activity):
            return False
        return self.exclude is None or not self._matches(self.exclude, activity)
