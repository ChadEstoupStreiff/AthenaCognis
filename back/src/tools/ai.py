import base64
import json
import logging
import mimetypes
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Set

import requests
from bs4 import BeautifulSoup
from controllers.ModelCatalog import list_custom
from tools.custom_providers import (
    SETTING_KEY as CUSTOM_PROVIDERS_KEY,
    CustomProvider,
    is_custom_provider,
    parse_custom_providers,
)
from tools.provider_errors import provider_error
from tools.prompts import get_prompt
from tools.style_instruction import (
    DEFAULT_PROMPT_KEY,
    SETTING_KEY,
    apply_to_messages,
    apply_to_prompt,
)
from views.settings import get_setting


def parse_token_count(size_str: str) -> int:
    size_str = size_str.strip().upper()
    if size_str.endswith("K"):
        return int(float(size_str[:-1]) * 1024)
    elif size_str.endswith("M"):
        return int(float(size_str[:-1]) * 1024 * 1024)
    else:
        return int(size_str)


_context_size_cache: Dict[str, str] = {}


def get_context_size(model_name: str, default: int = 4096) -> str:
    if model_name in _context_size_cache:
        return _context_size_cache[model_name]

    base_url = "https://ollama.com/library/"
    model_slug = model_name.split(":")[0]
    url = f"{base_url}{model_slug}"

    try:
        response = requests.get(url, timeout=10)
        if response.status_code != 200:
            return default

        soup = BeautifulSoup(response.text, "html.parser")

        # Search all mobile cards (sm:hidden blocks) for matching model name
        model_cards = soup.find_all("a", class_="sm:hidden")
        for card in model_cards:
            name_tag = card.find("p", class_="block")
            if name_tag and model_name in name_tag.text:
                info_text = card.get_text()
                match = re.search(r"(\d+K)\s+context window", info_text)
                if match:
                    _context_size_cache[model_name] = match.group(1)
                    return match.group(1)
    except Exception as e:
        logging.warning(f"AI >> Failed to fetch context size for {model_name}: {e}")

    return default


# OpenAI-compatible chat completions: provider -> (URL, API key setting)
OPENAI_COMPATIBLE = {
    "ChatGPT": ("https://api.openai.com/v1/chat/completions", "openai_api_key"),
    "DeepSeek": ("https://api.deepseek.com/chat/completions", "deepseek_api_key"),
    "Groq": ("https://api.groq.com/openai/v1/chat/completions", "groq_api_key"),
}
# Providers whose chat API only accepts plain-text message content
TEXT_ONLY_PROVIDERS = ("DeepSeek",)

DEFAULT_CONTEXT_WINDOWS = {
    "DeepSeek": 128000,
    "Groq": 128000,
    "Mistral": 128000,
    "ChatGPT": 128000,
    "Gemini": 1000000,
    "Claude": 200000,
}
# Context window assumed when neither the user nor the provider gives one
FALLBACK_CONTEXT_TOKENS = 8192

# Context windows announced by each custom provider's model list (fetched once)
_custom_context_cache: dict[CustomProvider, dict[str, int]] = {}


class ProviderNotFoundError(ValueError):
    """Routing points to a custom provider that was deleted or is invalid."""


class ModelNotSelectedError(ValueError):
    """Routing points to a custom provider without a model."""


def find_custom_provider(ai_type: str) -> CustomProvider | None:
    """
    Find a stored custom provider by its id

    Args:
        ai_type (str): provider value
    Returns:
        CustomProvider | None: provider, or None when missing or invalid
    """
    providers = parse_custom_providers(get_setting(CUSTOM_PROVIDERS_KEY, []))
    return next((p for p in providers if p.id == ai_type), None)


def read_routing(setting_prefix: str) -> tuple[str, str]:
    """
    Read the provider and model routed for a task

    Args:
        setting_prefix (str): task prefix of the `<task>_type` / `<task>_model` settings
    Returns:
        tuple[str, str]: provider value, model
    Raises:
        ModelNotSelectedError: when a custom provider has no model selected
    """
    ai_type = get_setting(f"{setting_prefix}_type")
    model = get_setting(f"{setting_prefix}_model")
    if is_custom_provider(ai_type) and not str(model or "").strip():
        raise ModelNotSelectedError(
            "No model selected for this task. Pick one in AI routing."
        )
    return ai_type, model


@dataclass(frozen=True)
class Endpoint:
    """Where and how to call an OpenAI-compatible provider."""

    label: str
    url: str
    api_key: str


def is_openai_compatible(ai_type: str) -> bool:
    """
    Tell whether a provider speaks the OpenAI chat completions protocol

    Args:
        ai_type (str): provider value
    Returns:
        bool: True for built-in compatible and custom providers
    """
    return ai_type in OPENAI_COMPATIBLE or is_custom_provider(ai_type)


def openai_endpoint(ai_type: str) -> Endpoint:
    """
    Find the URL and key of an OpenAI-compatible provider

    Args:
        ai_type (str): provider value
    Returns:
        Endpoint: endpoint
    Raises:
        ProviderNotFoundError: when the custom provider was removed or is invalid
    """
    if ai_type in OPENAI_COMPATIBLE:
        url, key_setting = OPENAI_COMPATIBLE[ai_type]
        return Endpoint(ai_type, url, get_setting(key_setting))
    provider = find_custom_provider(ai_type)
    if provider is None:
        raise ProviderNotFoundError(
            "This AI provider no longer exists. Pick another one in AI routing."
        )
    return Endpoint(provider.name, provider.chat_url, provider.api_key)


def provider_label(ai_type: str) -> str:
    """
    Name a provider for display

    Args:
        ai_type (str): provider value
    Returns:
        str: custom provider name, else the value itself
    """
    if not is_custom_provider(ai_type):
        return ai_type
    provider = find_custom_provider(ai_type)
    return ai_type if provider is None else provider.name


def delta_text(data: dict[str, Any]) -> str:
    """
    Read the text of an OpenAI-compatible stream chunk

    Args:
        data (dict[str, Any]): decoded chunk
    Returns:
        str: text, empty for usage or reasoning-only chunks
    """
    choices = data.get("choices")
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    return delta.get("content") or ""


def announced_context_windows(provider: CustomProvider) -> dict[str, int]:
    """
    Context windows announced by a custom provider's model list (cached once fetched)

    Args:
        provider (CustomProvider): provider
    Returns:
        dict[str, int]: tokens per model id, empty when the list failed
    """
    if provider in _custom_context_cache:
        return _custom_context_cache[provider]
    catalog = list_custom([provider])[provider.id]
    if catalog.error is None:
        _custom_context_cache[provider] = catalog.context_tokens
    return catalog.context_tokens


def custom_context_tokens(ai_type: str, model: str) -> int:
    """
    Context window of a custom provider model

    Args:
        ai_type (str): custom provider id
        model (str): model
    Returns:
        int: typed size, else size announced by `/models`, else the fallback
    """
    provider = find_custom_provider(ai_type)
    if provider is None:
        return FALLBACK_CONTEXT_TOKENS
    if provider.context_tokens is not None:
        return provider.context_tokens
    return announced_context_windows(provider).get(model, FALLBACK_CONTEXT_TOKENS)


def get_model_context_tokens(ai_type: str, model: str) -> int:
    """Approximate context window size in tokens, used for chat history budgeting."""
    if ai_type == "llama":
        try:
            return parse_token_count(str(get_context_size(model)))
        except Exception:
            return 4096
    if is_custom_provider(ai_type):
        return custom_context_tokens(ai_type, model)
    return DEFAULT_CONTEXT_WINDOWS.get(ai_type, FALLBACK_CONTEXT_TOKENS)


def encode_image_b64(image_path: str):
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")
    mime_type = mimetypes.guess_type(image_path)[0] or "image/jpeg"
    return mime_type, image_data


_VISION_MODEL_PATTERNS = {
    "Gemini": None,  # every current Gemini model is multimodal
    "Claude": ("instant",),  # supported unless it's the legacy text-only "instant" line
    "ChatGPT": ("gpt-4o", "gpt-4-turbo", "gpt-4.1", "gpt-5", "o3", "o4"),
    "Mistral": ("pixtral", "medium", "large"),
    "Groq": ("llama-4", "vision"),
    "llama": ("llava", "vision", "bakllava", "moondream", "minicpm-v", "gemma3", "llama3.2-vision", "llama4"),
}


def provider_supports_vision(ai_type: str, model: str) -> bool:
    """Heuristic, model-name based capability check (no live capability API exists)."""
    if not ai_type or not model:
        return False
    model_lower = model.lower()

    if ai_type == "Gemini":
        return True
    if ai_type == "Claude":
        return "instant" not in model_lower
    return any(pattern in model_lower for pattern in _VISION_MODEL_PATTERNS.get(ai_type, ()))


def style_instruction() -> str:
    """
    Answer-style instruction of the settings (empty = disabled)

    Returns:
        str: instruction
    """
    return str(get_setting(SETTING_KEY, get_prompt(DEFAULT_PROMPT_KEY)) or "")


def request_llm(
    setting_prefix: str,
    prompt: str,
    input_text: str = None,
    stream_callback=None,
) -> Set[str]:
    """
    Request a language model (LLM) to process the prompt and return the response.
    Returns a tuple of (AI type, model, response).
    """
    ai_type, model = read_routing(setting_prefix)

    if input_text is not None:
        prompt = prompt.replace("{input}", input_text)
    prompt = apply_to_prompt(style_instruction(), prompt)

    # LLAMA
    if ai_type == "llama":
        ollama_server = get_setting("ollama_server", "http://ollama:11434")
        with requests.post(
            f"{ollama_server}/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": True,
                "options": {
                    "num_ctx": parse_token_count(get_context_size(model)),
                    "num_keep": 2048,
                },
            },
            stream=True,
            timeout=3600,
        ) as response:
            if response.status_code != 200:
                raise provider_error("Ollama", response.status_code, response.text)

            output = ""
            for line in response.iter_lines():
                if line:
                    part = line.decode("utf-8")
                    if part.startswith("data: "):
                        part = part[6:]
                    try:
                        data = json.loads(part)
                        chunk = data.get("response", "")
                        output += chunk
                        if stream_callback:
                            stream_callback(chunk)
                    except Exception as e:
                        logging.warning(f"AI >> Malformed llama chunk skipped: {e!r} raw={part!r}")
            return ai_type, model, output

    # Mistral
    elif ai_type == "Mistral":
        api_key = get_setting("mistral_api_key")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
        }
        url = "https://api.mistral.ai/v1/chat/completions"
        with requests.post(url, headers=headers, json=payload, stream=True, timeout=3600) as response:
            if response.status_code != 200:
                raise provider_error("Mistral", response.status_code, response.text)

            output = ""
            for line in response.iter_lines():
                if line:
                    line = line.decode("utf-8")
                    if line.startswith("data: "):
                        line = line[6:]
                    if line == "[DONE]":
                        break
                    try:
                        data = json.loads(line)
                        chunk = data["choices"][0]["delta"].get("content", "")
                        output += chunk
                        if stream_callback:
                            stream_callback(chunk)
                    except Exception as e:
                        logging.warning(f"AI >> Malformed Mistral chunk skipped: {e!r} raw={line!r}")
            return ai_type, model, output

    # ChatGPT / DeepSeek (OpenAI-compatible)
    elif is_openai_compatible(ai_type):
        endpoint = openai_endpoint(ai_type)
        headers = {
            "Authorization": f"Bearer {endpoint.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
        }

        with requests.post(endpoint.url, headers=headers, json=payload, stream=True, timeout=3600) as response:
            if response.status_code != 200:
                raise provider_error(endpoint.label, response.status_code, response.text)

            output = ""
            for line in response.iter_lines():
                if line:
                    line = line.decode("utf-8").replace("data: ", "")
                    if line == "[DONE]":
                        break
                    try:
                        data = json.loads(line)
                        chunk = delta_text(data)
                        output += chunk
                        if stream_callback:
                            stream_callback(chunk)
                    except Exception as e:
                        logging.warning(f"AI >> Malformed {ai_type} chunk skipped: {e!r} raw={line!r}")
            return ai_type, model, output

    # Gemini
    elif ai_type == "Gemini":
        api_key = get_setting("gemini_api_key")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={api_key}"
        payload = {"contents": [{"parts": [{"text": prompt}]}]}

        output = ""
        with requests.post(url, json=payload, stream=True, timeout=3600) as response:
            if response.status_code != 200:
                raise provider_error("Gemini", response.status_code, response.text)

            for line in response.iter_lines():
                if line:
                    line = line.decode("utf-8")
                    if line.startswith("data: "):
                        line = line[6:]
                    try:
                        data = json.loads(line)
                        chunk = data["candidates"][0]["content"]["parts"][0]["text"]
                        output += chunk
                        if stream_callback:
                            stream_callback(chunk)
                    except Exception as e:
                        logging.warning(f"AI >> Malformed Gemini chunk skipped: {e!r} raw={line!r}")
        return ai_type, model, output

    # Claude (Anthropic)
    elif ai_type == "Claude":
        api_key = get_setting("anthropic_api_key")
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "max_tokens": 16000,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
        }
        url = "https://api.anthropic.com/v1/messages"
        with requests.post(url, headers=headers, json=payload, stream=True, timeout=3600) as response:
            if response.status_code != 200:
                raise provider_error("Claude", response.status_code, response.text)

            output = ""
            for line in response.iter_lines():
                if line:
                    line = line.decode("utf-8")
                    if line.startswith("data: "):
                        data_str = line[6:]
                        try:
                            data = json.loads(data_str)
                            if data.get("type") == "content_block_delta":
                                delta = data.get("delta", {})
                                if delta.get("type") == "text_delta":
                                    chunk = delta.get("text", "")
                                    output += chunk
                                    if stream_callback:
                                        stream_callback(chunk)
                        except Exception as e:
                            logging.warning(f"AI >> Malformed Claude chunk skipped: {e!r} raw={line!r}")
            return ai_type, model, output

    else:
        raise ValueError(f"Unsupported AI type: {ai_type}")


def request_chat_llm(
    setting_prefix: str,
    messages: List[Dict],
    stream_callback=None,
    cancel_event=None,
) -> Set[str]:
    """
    Request a chat-capable LLM using a structured, multi-turn, multimodal message list:
    messages = [{"role": "system"|"user"|"assistant", "content": [
        {"type": "text", "text": ...} | {"type": "image", "path": ...}
    ]}]
    Returns a tuple of (AI type, model, response).
    """
    ai_type, model = read_routing(setting_prefix)
    timeout = get_setting("chat_llm_timeout_seconds", 300)
    messages = apply_to_messages(style_instruction(), messages)

    def cancelled():
        return cancel_event is not None and cancel_event.is_set()

    # LLAMA (Ollama /api/chat — native multi-turn + multimodal)
    if ai_type == "llama":
        ollama_server = get_setting("ollama_server", "http://ollama:11434")
        ollama_messages = []
        for msg in messages:
            text_parts, images = [], []
            for part in msg["content"]:
                if part["type"] == "text":
                    text_parts.append(part["text"])
                elif part["type"] == "image":
                    _, b64data = encode_image_b64(part["path"])
                    images.append(b64data)
            entry = {"role": msg["role"], "content": "\n".join(text_parts)}
            if images:
                entry["images"] = images
            ollama_messages.append(entry)

        with requests.post(
            f"{ollama_server}/api/chat",
            json={
                "model": model,
                "messages": ollama_messages,
                "stream": True,
                "options": {
                    "num_ctx": parse_token_count(str(get_context_size(model))),
                    "num_keep": 2048,
                },
            },
            stream=True,
            timeout=timeout,
        ) as response:
            if response.status_code != 200:
                raise provider_error("Ollama", response.status_code, response.text)

            output = ""
            for line in response.iter_lines():
                if cancelled():
                    break
                if not line:
                    continue
                try:
                    data = json.loads(line.decode("utf-8"))
                    chunk = data.get("message", {}).get("content", "")
                    if chunk:
                        output += chunk
                        if stream_callback:
                            stream_callback(chunk)
                    if data.get("done"):
                        break
                except Exception as e:
                    logging.warning(f"AI >> Malformed Ollama chat chunk skipped: {e!r} raw={line!r}")
            return ai_type, model, output

    # Mistral / ChatGPT / DeepSeek (OpenAI-compatible chat completions)
    elif ai_type == "Mistral" or is_openai_compatible(ai_type):
        endpoint = (
            Endpoint("Mistral", "https://api.mistral.ai/v1/chat/completions", get_setting("mistral_api_key"))
            if ai_type == "Mistral"
            else openai_endpoint(ai_type)
        )
        headers = {"Authorization": f"Bearer {endpoint.api_key}", "Content-Type": "application/json"}
        is_text_only = ai_type in TEXT_ONLY_PROVIDERS or is_custom_provider(ai_type)

        api_messages = []
        for msg in messages:
            content_parts = []
            for part in msg["content"]:
                if part["type"] == "text":
                    content_parts.append({"type": "text", "text": part["text"]})
                elif part["type"] == "image":
                    mime_type, b64data = encode_image_b64(part["path"])
                    data_url = f"data:{mime_type};base64,{b64data}"
                    if ai_type == "Mistral":
                        content_parts.append({"type": "image_url", "image_url": data_url})
                    else:
                        content_parts.append({"type": "image_url", "image_url": {"url": data_url}})
            if is_text_only:
                text = "\n".join(part["text"] for part in content_parts if part["type"] == "text")
                api_messages.append({"role": msg["role"], "content": text})
            else:
                api_messages.append({"role": msg["role"], "content": content_parts})

        payload = {"model": model, "messages": api_messages, "stream": True}
        with requests.post(endpoint.url, headers=headers, json=payload, stream=True, timeout=timeout) as response:
            if response.status_code != 200:
                raise provider_error(endpoint.label, response.status_code, response.text)

            output = ""
            for line in response.iter_lines():
                if cancelled():
                    break
                if not line:
                    continue
                line = line.decode("utf-8")
                if line.startswith("data: "):
                    line = line[6:]
                if line == "[DONE]":
                    break
                try:
                    data = json.loads(line)
                    chunk = delta_text(data)
                    if chunk:
                        output += chunk
                        if stream_callback:
                            stream_callback(chunk)
                except Exception as e:
                    logging.warning(f"AI >> Malformed {ai_type} chunk skipped: {e!r} raw={line!r}")
            return ai_type, model, output

    # Gemini
    elif ai_type == "Gemini":
        api_key = get_setting("gemini_api_key")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={api_key}"

        system_parts = []
        contents = []
        for msg in messages:
            if msg["role"] == "system":
                system_parts.extend(part["text"] for part in msg["content"] if part["type"] == "text")
                continue
            parts = []
            for part in msg["content"]:
                if part["type"] == "text":
                    parts.append({"text": part["text"]})
                elif part["type"] == "image":
                    mime_type, b64data = encode_image_b64(part["path"])
                    parts.append({"inlineData": {"mimeType": mime_type, "data": b64data}})
            contents.append({"role": "model" if msg["role"] == "assistant" else "user", "parts": parts})

        payload = {"contents": contents}
        if system_parts:
            payload["systemInstruction"] = {"parts": [{"text": "\n".join(system_parts)}]}

        output = ""
        with requests.post(url, json=payload, stream=True, timeout=timeout) as response:
            if response.status_code != 200:
                raise provider_error("Gemini", response.status_code, response.text)

            for line in response.iter_lines():
                if cancelled():
                    break
                if not line:
                    continue
                line = line.decode("utf-8")
                if line.startswith("data: "):
                    line = line[6:]
                try:
                    data = json.loads(line)
                    chunk = data["candidates"][0]["content"]["parts"][0]["text"]
                    if chunk:
                        output += chunk
                        if stream_callback:
                            stream_callback(chunk)
                except Exception as e:
                    logging.warning(f"AI >> Malformed Gemini chunk skipped: {e!r} raw={line!r}")
        return ai_type, model, output

    # Claude (Anthropic)
    elif ai_type == "Claude":
        api_key = get_setting("anthropic_api_key")
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

        system_parts = []
        api_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system_parts.extend(part["text"] for part in msg["content"] if part["type"] == "text")
                continue
            content_parts = []
            for part in msg["content"]:
                if part["type"] == "text":
                    content_parts.append({"type": "text", "text": part["text"]})
                elif part["type"] == "image":
                    mime_type, b64data = encode_image_b64(part["path"])
                    content_parts.append({
                        "type": "image",
                        "source": {"type": "base64", "media_type": mime_type, "data": b64data},
                    })
            api_messages.append({"role": msg["role"], "content": content_parts})

        payload = {
            "model": model,
            "max_tokens": 16000,
            "messages": api_messages,
            "stream": True,
        }
        if system_parts:
            payload["system"] = "\n".join(system_parts)

        url = "https://api.anthropic.com/v1/messages"
        with requests.post(url, headers=headers, json=payload, stream=True, timeout=timeout) as response:
            if response.status_code != 200:
                raise provider_error("Claude", response.status_code, response.text)

            output = ""
            for line in response.iter_lines():
                if cancelled():
                    break
                if not line:
                    continue
                line = line.decode("utf-8")
                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        data = json.loads(data_str)
                        if data.get("type") == "content_block_delta":
                            delta = data.get("delta", {})
                            if delta.get("type") == "text_delta":
                                chunk = delta.get("text", "")
                                if chunk:
                                    output += chunk
                                    if stream_callback:
                                        stream_callback(chunk)
                    except Exception as e:
                        logging.warning(f"AI >> Malformed Claude chunk skipped: {e!r} raw={line!r}")
            return ai_type, model, output

    else:
        raise ValueError(f"Unsupported AI type: {ai_type}")


def request_vision_llm(
    setting_prefix: str,
    prompt: str,
    image_path: str,
) -> Set[str]:
    """
    Request a vision-capable LLM to analyze an image.
    Returns a tuple of (AI type, model, response).
    """
    ai_type, model = read_routing(setting_prefix)

    mime_type, image_data = encode_image_b64(image_path)

    if ai_type == "llama":
        ollama_server = get_setting("ollama_server", "http://ollama:11434")
        response = requests.post(
            f"{ollama_server}/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "images": [image_data],
                "stream": False,
            },
            timeout=3600,
        )
        if response.status_code != 200:
            raise provider_error("Ollama vision", response.status_code, response.text)
        return ai_type, model, response.json()["response"]

    elif ai_type == "Mistral":
        api_key = get_setting("mistral_api_key")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": f"data:{mime_type};base64,{image_data}"},
                ],
            }],
        }
        response = requests.post(
            "https://api.mistral.ai/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=3600,
        )
        if response.status_code != 200:
            raise provider_error("Mistral vision", response.status_code, response.text)
        return ai_type, model, response.json()["choices"][0]["message"]["content"]

    elif ai_type == "ChatGPT":
        api_key = get_setting("openai_api_key")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_data}"}},
                ],
            }],
        }
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=3600,
        )
        if response.status_code != 200:
            raise provider_error("OpenAI vision", response.status_code, response.text)
        return ai_type, model, response.json()["choices"][0]["message"]["content"]

    elif ai_type == "Gemini":
        api_key = get_setting("gemini_api_key")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        payload = {
            "contents": [{
                "parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": mime_type, "data": image_data}},
                ]
            }]
        }
        response = requests.post(url, json=payload, timeout=3600)
        if response.status_code != 200:
            raise provider_error("Gemini vision", response.status_code, response.text)
        return ai_type, model, response.json()["candidates"][0]["content"]["parts"][0]["text"]

    # Claude (Anthropic)
    elif ai_type == "Claude":
        api_key = get_setting("anthropic_api_key")
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "max_tokens": 1024,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": image_data}},
                    {"type": "text", "text": prompt},
                ],
            }],
        }
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers=headers,
            json=payload,
            timeout=3600,
        )
        if response.status_code != 200:
            raise provider_error("Claude vision", response.status_code, response.text)
        return ai_type, model, response.json()["content"][0]["text"]

    else:
        raise ValueError(f"Unsupported vision AI type: {ai_type}")


def request_transcription(
    setting_prefix: str,
    audio_path: str,
) -> Set[str]:
    """
    Request transcription of an audio file via an external API.
    Returns a tuple of (type, model, transcription_text).
    """
    transcription_type = get_setting(f"{setting_prefix}_type", "local")
    model = get_setting(f"{setting_prefix}_model", "whisper-1")

    if transcription_type == "openai":
        api_key = get_setting("openai_api_key")
        with open(audio_path, "rb") as audio_file:
            response = requests.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (audio_path.split("/")[-1], audio_file)},
                data={"model": model},
                timeout=3600,
            )
        if response.status_code != 200:
            raise provider_error("OpenAI transcription", response.status_code, response.text)
        return transcription_type, model, response.json()["text"]

    elif transcription_type == "groq":
        api_key = get_setting("groq_api_key")
        with open(audio_path, "rb") as audio_file:
            response = requests.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (audio_path.split("/")[-1], audio_file)},
                data={"model": model},
                timeout=3600,
            )
        if response.status_code != 200:
            raise provider_error("Groq transcription", response.status_code, response.text)
        return transcription_type, model, response.json()["text"]

    else:
        raise ValueError(f"Unsupported transcription type: {transcription_type}")
