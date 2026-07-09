import base64
import json
import mimetypes
import re
from typing import Set

import requests
from bs4 import BeautifulSoup
from views.settings import get_setting


def parse_token_count(size_str: str) -> int:
    size_str = size_str.strip().upper()
    if size_str.endswith("K"):
        return int(float(size_str[:-1]) * 1024)
    elif size_str.endswith("M"):
        return int(float(size_str[:-1]) * 1024 * 1024)
    else:
        return int(size_str)


def get_context_size(model_name: str, default: int = 4096) -> str:
    base_url = "https://ollama.com/library/"
    model_slug = model_name.split(":")[0]
    url = f"{base_url}{model_slug}"

    response = requests.get(url)
    if response.status_code != 200:
        raise Exception(f"Failed to fetch page: {url}")

    soup = BeautifulSoup(response.text, "html.parser")

    # Search all mobile cards (sm:hidden blocks) for matching model name
    model_cards = soup.find_all("a", class_="sm:hidden")
    for card in model_cards:
        name_tag = card.find("p", class_="block")
        if name_tag and model_name in name_tag.text:
            info_text = card.get_text()
            match = re.search(r"(\d+K)\s+context window", info_text)
            if match:
                return match.group(1)

    return default


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
    ai_type = get_setting(f"{setting_prefix}_type")
    model = get_setting(f"{setting_prefix}_model")

    if input_text is not None:
        prompt = prompt.replace("{input}", input_text)

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
                raise Exception(f"LLM error {response.status_code}: {response.text}")

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
                    except Exception:
                        pass
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
        with requests.post(url, headers=headers, json=payload, stream=True) as response:
            if response.status_code != 200:
                raise Exception(
                    f"Mistral error {response.status_code}: {response.text}"
                )

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
                    except Exception:
                        pass
            return ai_type, model, output

    # ChatGPT
    elif ai_type == "ChatGPT":
        api_key = get_setting("openai_api_key")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
        }
        url = "https://api.openai.com/v1/chat/completions"

        with requests.post(url, headers=headers, json=payload, stream=True) as response:
            if response.status_code != 200:
                raise Exception(f"OpenAI error {response.status_code}: {response.text}")

            output = ""
            for line in response.iter_lines():
                if line:
                    line = line.decode("utf-8").replace("data: ", "")
                    if line == "[DONE]":
                        break
                    try:
                        data = json.loads(line)
                        chunk = data["choices"][0]["delta"].get("content", "")
                        output += chunk
                        if stream_callback:
                            stream_callback(chunk)
                    except Exception:
                        pass
            return ai_type, model, output

    # Gemini
    elif ai_type == "Gemini":
        api_key = get_setting("gemini_api_key")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        payload = {"contents": [{"parts": [{"text": prompt}]}]}

        response = requests.post(url, json=payload)
        if response.status_code != 200:
            raise Exception(f"Gemini error {response.status_code}: {response.text}")

        try:
            data = response.json()
            output = data["candidates"][0]["content"]["parts"][0]["text"]
            if stream_callback:
                stream_callback(output)
            return ai_type, model, output
        except Exception as e:
            raise Exception(f"Gemini response error: {e}")

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
                raise Exception(f"Claude error {response.status_code}: {response.text}")

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
                        except Exception:
                            pass
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
    ai_type = get_setting(f"{setting_prefix}_type")
    model = get_setting(f"{setting_prefix}_model")

    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")
    mime_type = mimetypes.guess_type(image_path)[0] or "image/jpeg"

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
            raise Exception(f"Ollama vision error {response.status_code}: {response.text}")
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
            raise Exception(f"Mistral vision error {response.status_code}: {response.text}")
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
            raise Exception(f"OpenAI vision error {response.status_code}: {response.text}")
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
            raise Exception(f"Gemini vision error {response.status_code}: {response.text}")
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
            raise Exception(f"Claude vision error {response.status_code}: {response.text}")
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
            raise Exception(f"OpenAI transcription error {response.status_code}: {response.text}")
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
            raise Exception(f"Groq transcription error {response.status_code}: {response.text}")
        return transcription_type, model, response.json()["text"]

    else:
        raise ValueError(f"Unsupported transcription type: {transcription_type}")
