"""Write and clear the settings of an activity data source."""

from db import Setting, get_db
from views.settings import format_value


def write_setting(key: str, value: object) -> None:
    """
    Store one setting (insert or update)

    Args:
        key (str): setting key
        value (object): JSON-serializable value
    Returns:
        None
    """
    session = get_db()
    try:
        setting = session.query(Setting).filter(Setting.key == key).first()
        if setting is None:
            session.add(Setting(key=key, value=format_value(value)))
        else:
            setting.value = format_value(value)
        session.commit()
    finally:
        session.close()


def clear_settings(prefix: str) -> None:
    """
    Delete every stored setting whose key starts with a prefix (back to defaults)

    Args:
        prefix (str): key prefix
    Returns:
        None
    """
    session = get_db()
    try:
        session.query(Setting).filter(
            Setting.key.startswith(prefix, autoescape=True)
        ).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()
