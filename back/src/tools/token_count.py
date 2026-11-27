"""Token counting for history budgets, estimated when the tokenizer cannot be loaded."""

import logging
import threading
from functools import lru_cache

import tiktoken

TOKENIZER_MODEL = "gpt-4"
# tiktoken downloads its encoding without a timeout on first use
LOAD_TIMEOUT_SECONDS = 5.0
CHARS_PER_TOKEN = 4

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def load_encoder() -> tiktoken.Encoding | None:
    """
    Load the tokenizer once, giving up when its download fails or stalls

    Args:
        None
    Returns:
        tiktoken.Encoding | None: tokenizer, or None when unavailable
    """
    loaded: list[tiktoken.Encoding] = []

    def load() -> None:
        """
        Store the tokenizer once downloaded

        Args:
            None
        Returns:
            None
        """
        try:
            loaded.append(tiktoken.encoding_for_model(TOKENIZER_MODEL))
        except (OSError, ValueError) as error:  # network errors are OSError
            logger.warning("Tokenizer download failed: %r", error)

    # daemon: a stalled download must not block the process from exiting
    worker = threading.Thread(target=load, daemon=True)
    worker.start()
    worker.join(LOAD_TIMEOUT_SECONDS)
    if loaded:
        return loaded[0]
    logger.warning("Tokenizer unavailable, estimating token counts.")
    return None


def count_tokens(text: str) -> int:
    """
    Count the tokens of a text, exactly or by its length

    Args:
        text (str): text
    Returns:
        int: token count
    """
    encoder = load_encoder()
    if encoder is None:
        return len(text) // CHARS_PER_TOKEN + 1
    return len(encoder.encode(text))
