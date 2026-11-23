from datetime import date

from controllers.activity.off_days import (
    DEFAULT_KEYWORDS,
    DayRange,
    OffDayRules,
    agenda_reason,
    days_between,
    off_reason,
    parse_range,
    read_rules,
    supported_countries,
)


def test_parse_range_reads_days_and_spans() -> None:
    assert parse_range("2026-08-03") == DayRange(date(2026, 8, 3), date(2026, 8, 3))
    assert parse_range(" 2026-08-14 / 2026-08-01 ") == DayRange(date(2026, 8, 1), date(2026, 8, 14))
    assert parse_range("2026-13-01") is None
    assert parse_range("2026-08-01/2026-08-02/2026-08-03") is None


def test_read_rules_defaults_and_values() -> None:
    assert read_rules({}.get) == OffDayRules()
    settings: dict[str, object] = {
        "activity_generation_daily_weekdays": ["mon", "sun", "bogus"],
        "activity_generation_daily_holidays_country": " fr ",
        "activity_generation_daily_holidays_subdivision": "57",
        "activity_generation_daily_off_days": ["2026-08-01/2026-08-02", "nope", 4],
        "activity_generation_daily_agenda_off": True,
        "activity_generation_daily_agenda_off_keywords": " Vacances, , RTT ",
    }
    rules = read_rules(settings.get)
    assert rules == OffDayRules(
        weekdays=("mon", "sun"),
        country="FR",
        subdivision="57",
        ranges=(DayRange(date(2026, 8, 1), date(2026, 8, 2)),),
        agenda=True,
        keywords=("Vacances", "RTT"),
    )
    blank = read_rules({"activity_generation_daily_agenda_off_keywords": " , "}.get)
    assert blank.keywords == DEFAULT_KEYWORDS


def test_off_reason_by_weekday_holiday_and_off_day() -> None:
    rules = OffDayRules(
        weekdays=("mon", "tue", "wed", "thu", "fri"),
        country="FR",
        subdivision="57",
        ranges=(DayRange(date(2026, 8, 3), date(2026, 8, 7)),),
    )
    assert off_reason(date(2026, 11, 22), rules) == "Sunday not picked"
    assert off_reason(date(2026, 12, 25), rules) == "Holiday: Noël"
    # Saint Étienne: holiday in Moselle only.
    assert off_reason(date(2026, 12, 25 + 1), OffDayRules(country="FR", subdivision="57"))
    assert off_reason(date(2026, 12, 26), OffDayRules(country="FR")) is None
    assert off_reason(date(2026, 8, 5), rules) == "Off day"
    assert off_reason(date(2026, 11, 23), rules) is None
    assert off_reason(date(2026, 12, 25), OffDayRules(country="ZZ")) is None


def test_agenda_reason_matches_whole_words_any_case() -> None:
    assert agenda_reason(["Standup", "OOO - dentist"], DEFAULT_KEYWORDS) == (
        "Agenda: OOO - dentist"
    )
    assert agenda_reason(["Congé"], DEFAULT_KEYWORDS) == "Agenda: Congé"
    assert agenda_reason(["Crypto talk", "Kooo"], DEFAULT_KEYWORDS) is None
    assert agenda_reason([], DEFAULT_KEYWORDS) is None


def test_days_between_bounds() -> None:
    assert days_between(date(2026, 2, 27), date(2026, 3, 1)) == [
        date(2026, 2, 27),
        date(2026, 2, 28),
        date(2026, 3, 1),
    ]
    for first, last in ((date(2026, 3, 2), date(2026, 3, 1)), (date(2020, 1, 1), date(2026, 1, 1))):
        try:
            days_between(first, last)
        except ValueError:
            continue
        raise AssertionError("span accepted")


def test_supported_countries_keeps_two_letter_codes() -> None:
    countries = supported_countries()
    assert "57" in countries["FR"]
    assert all(len(code) == 2 for code in countries)
