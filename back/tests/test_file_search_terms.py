from typing import Optional

import pytest

from controllers.FileManager import build_query_phrase, fold_text


@pytest.mark.parametrize("text", [None, "", "   "])
def test_blank_text_has_no_phrase(text: Optional[str]) -> None:
    """
    Return an empty phrase for a missing or blank text

    Args:
        text (Optional[str]): blank search text
    Returns:
        None: nothing
    """
    assert build_query_phrase(text, exact=False) == ("", False)
    assert build_query_phrase(text, exact=True) == ("", False)


def test_plain_text_is_one_normalized_phrase() -> None:
    """
    Keep a plain text as one normalized phrase, not split into words

    Returns:
        None: nothing
    """
    assert build_query_phrase("UNet  Paper", exact=False) == ("unet paper", True)


def test_special_characters_disable_normalization() -> None:
    """
    Keep the phrase as typed (lowercased) when the text holds special characters

    Returns:
        None: nothing
    """
    assert build_query_phrase("U-Net paper", exact=False) == ("u-net paper", False)


def test_exact_keeps_special_characters() -> None:
    """
    Never normalize the phrase in exact mode

    Returns:
        None: nothing
    """
    assert build_query_phrase("  UNet Paper ", exact=True) == ("unet paper", False)


def test_fold_text_collapses_whitespace() -> None:
    """
    Collapse line breaks and space runs so phrases match across them

    Returns:
        None: nothing
    """
    assert fold_text("U-Net\n  Paper", normalize=True) == "unet paper"
    assert fold_text("U-Net\n  Paper", normalize=False) == "u-net paper"
