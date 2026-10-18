from typing import Optional

import pytest

from controllers.FileManager import build_query_terms


@pytest.mark.parametrize("text", [None, "", "   "])
def test_blank_text_has_no_terms(text: Optional[str]) -> None:
    """
    Return no terms for a missing or blank text

    Args:
        text (Optional[str]): blank search text
    Returns:
        None: nothing
    """
    assert build_query_terms(text, exact=False) == ([], False)
    assert build_query_terms(text, exact=True) == ([], False)


def test_plain_text_is_split_and_normalized() -> None:
    """
    Split a plain text into normalized words

    Returns:
        None: nothing
    """
    assert build_query_terms("UNet Paper", exact=False) == (["unet", "paper"], True)


def test_special_characters_disable_normalization() -> None:
    """
    Keep words as typed (lowercased) when the text holds special characters

    Returns:
        None: nothing
    """
    assert build_query_terms("U-Net paper", exact=False) == (["u-net", "paper"], False)


def test_exact_keeps_whole_phrase() -> None:
    """
    Keep the whole text as one lowercase phrase in exact mode

    Returns:
        None: nothing
    """
    assert build_query_terms("  U-Net Paper ", exact=True) == (["u-net paper"], False)
