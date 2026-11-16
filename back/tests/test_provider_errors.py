import pytest

from tools.provider_errors import ProviderError, provider_error

ANTHROPIC_BODY = (
    '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance'
    ' is too low to access the Anthropic API."},"request_id":"req_1"}'
)


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (ANTHROPIC_BODY, "Your credit balance is too low to access the Anthropic API."),
        (
            '{"error": {"message": "Incorrect API key", "code": 401}}',
            "Incorrect API key",
        ),
        (
            '[{"error": {"code": 400, "message": "API key not valid"}}]',
            "API key not valid",
        ),
        ('{"detail": "Unauthorized"}', "Unauthorized"),
        ('{"message": "Rate limit"}', "Rate limit"),
        ("<html>Bad gateway</html>", "<html>Bad gateway</html>"),
    ],
)
def test_provider_error_extracts_the_message(body: str, message: str) -> None:
    """
    Keep only the human message of the provider bodies

    Args:
        body (str): raw body
        message (str): expected message
    Returns:
        None
    """
    error = provider_error("Claude", 400, body)
    assert isinstance(error, ProviderError)
    assert str(error) == f"Claude error 400: {message}"
    assert error.status_code == 400


def test_provider_error_truncates_unknown_bodies() -> None:
    """
    Cut long non-JSON bodies

    Returns:
        None
    """
    assert len(str(provider_error("Gemini", 500, "x" * 1000))) < 400
