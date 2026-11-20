"""Turn data URI images of a written HTML body into inline (cid:) MIME parts."""

import base64
import binascii
import re
import uuid
from dataclasses import dataclass

DATA_IMAGE_SRC = re.compile(
    r"""src=(["'])data:image/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)\1""",
    re.IGNORECASE,
)
SUBTYPE_ALIASES = {"jpg": "jpeg"}


@dataclass(frozen=True)
class InlineImage:
    """Image embedded in the message, referenced from the HTML by its Content-ID."""

    content_id: str
    subtype: str
    data: bytes


def _decode(payload: str) -> bytes | None:
    """
    Decode a base64 image payload

    Args:
        payload (str): base64 text, whitespace allowed
    Returns:
        bytes | None: image bytes, None when not valid base64
    """
    try:
        return base64.b64decode("".join(payload.split()), validate=True)
    except (binascii.Error, ValueError):
        return None


def extract_inline_images(html: str, domain: str) -> tuple[str, list[InlineImage]]:
    """
    Replace data URI image sources by cid: references to separate parts

    Args:
        html (str): HTML body
        domain (str): domain used in the generated Content-IDs
    Returns:
        tuple[str, list[InlineImage]]: rewritten HTML and the images to attach
    """
    images: list[InlineImage] = []

    def replace(match: re.Match[str]) -> str:
        """
        Swap one data URI for a cid: reference (kept as-is when undecodable)

        Args:
            match (re.Match[str]): src attribute match
        Returns:
            str: new src attribute
        """
        data = _decode(match.group(3))
        if data is None:
            return match.group(0)
        subtype = match.group(2).lower()
        content_id = f"{uuid.uuid4().hex}@{domain}"
        images.append(InlineImage(content_id, SUBTYPE_ALIASES.get(subtype, subtype), data))
        return f'src="cid:{content_id}"'

    return DATA_IMAGE_SRC.sub(replace, html), images
