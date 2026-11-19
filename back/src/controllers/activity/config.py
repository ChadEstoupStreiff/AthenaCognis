"""Declarative settings of a data source: fields the UI renders, typed reads with defaults."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

FieldKind = Literal["multiselect", "toggle", "text", "lines", "folders"]
SettingReader = Callable[[str], object]
JsonDict = dict[str, object]


@dataclass(frozen=True)
class ConfigOption:
    """One choice of a multiselect field."""

    value: str
    label: str


@dataclass(frozen=True)
class ConfigField:
    """One setting of a source, stored as `activity_<source>_<name>`."""

    name: str
    label: str
    hint: str
    kind: FieldKind
    default: bool | str | tuple[str, ...]
    options: tuple[ConfigOption, ...] = ()
    # Multiselect text shown when nothing is picked (e.g. "All projects").
    placeholder: str = ""
    # Value shown masked in the UI once set (e.g. secret calendar links).
    secret: bool = False

    def view(self, prefix: str) -> JsonDict:
        """
        Serialize for the API

        Args:
            prefix (str): setting prefix of the source
        Returns:
            JsonDict: field with its setting key
        """
        default = (
            list(self.default) if isinstance(self.default, tuple) else self.default
        )
        return {
            "key": f"{prefix}{self.name}",
            "label": self.label,
            "hint": self.hint,
            "kind": self.kind,
            "default": default,
            "options": [
                {"value": item.value, "label": item.label} for item in self.options
            ],
            "placeholder": self.placeholder,
            "secret": self.secret,
        }


def options_of(pairs: Sequence[tuple[str, str]]) -> tuple[ConfigOption, ...]:
    """
    Build options from (value, label) pairs

    Args:
        pairs (Sequence[tuple[str, str]]): values and labels
    Returns:
        tuple[ConfigOption, ...]: options
    """
    return tuple(ConfigOption(value, label) for value, label in pairs)


class SourceConfig:
    """Typed reads of a source's settings, falling back to field defaults."""

    def __init__(
        self, fields: Sequence[ConfigField], read: SettingReader, prefix: str
    ) -> None:
        """
        Bind fields to a setting reader

        Args:
            fields (Sequence[ConfigField]): declared fields
            read (SettingReader): setting getter
            prefix (str): setting prefix of the source
        Returns:
            None
        """
        self.fields = {item.name: item for item in fields}
        self.read = read
        self.prefix = prefix

    def _raw(self, name: str) -> object:
        """
        Stored value of a field, or its default when unset

        Args:
            name (str): field name
        Returns:
            object: value
        Raises:
            KeyError: unknown field
        """
        value = self.read(f"{self.prefix}{name}")
        return self.fields[name].default if value is None else value

    def flag(self, name: str) -> bool:
        """
        Value of a toggle field

        Args:
            name (str): field name
        Returns:
            bool: True when on
        """
        return self._raw(name) is True

    def text(self, name: str) -> str:
        """
        Value of a text field, trimmed; the default when unset or blank

        Args:
            name (str): field name
        Returns:
            str: text
        """
        raw = self._raw(name)
        value = raw.strip() if isinstance(raw, str) else ""
        default = self.fields[name].default
        return value or (default if isinstance(default, str) else "")

    def lines(self, name: str) -> tuple[str, ...]:
        """
        Entries of a lines field (one per line, blanks dropped)

        Args:
            name (str): field name
        Returns:
            tuple[str, ...]: trimmed entries
        """
        raw = self._raw(name)
        text = raw if isinstance(raw, str) else ""
        return tuple(line.strip() for line in text.splitlines() if line.strip())

    def strings(self, name: str) -> tuple[str, ...]:
        """
        Raw string items of a list field (no option check: the source validates them)

        Args:
            name (str): field name
        Returns:
            tuple[str, ...]: strings
        """
        raw = self._raw(name)
        items = raw if isinstance(raw, list | tuple) else ()
        return tuple(item for item in items if isinstance(item, str))

    def choices(self, name: str) -> tuple[str, ...]:
        """
        Picked values of a multiselect field, unknown values dropped

        Args:
            name (str): field name
        Returns:
            tuple[str, ...]: picked option values (empty = none picked)
        """
        raw = self._raw(name)
        items = raw if isinstance(raw, list | tuple) else ()
        allowed = {option.value for option in self.fields[name].options}
        return tuple(
            item for item in items if isinstance(item, str) and item in allowed
        )
