"""Transcribe one audio or video file locally with Qwen3-ASR; prints the transcript."""

import sys

import torch
from faster_whisper import decode_audio
from qwen_asr import Qwen3ASRModel

SAMPLE_RATE = 16000
# Qwen3-ASR cuts audio into chunks of up to 20 minutes; room for a full chunk of speech.
MAX_NEW_TOKENS = 4096
MAX_BATCH_SIZE = 4
EXPECTED_ARGS = 3


def load_model(model_name: str) -> Qwen3ASRModel:
    """
    Load a Qwen3-ASR model on the GPU when present (bfloat16), else on the CPU

    Args:
        model_name (str): Hugging Face id, e.g. "Qwen/Qwen3-ASR-1.7B"
    Returns:
        Qwen3ASRModel: loaded model
    """
    has_gpu = torch.cuda.is_available()
    return Qwen3ASRModel.from_pretrained(
        model_name,
        dtype=torch.bfloat16 if has_gpu else torch.float32,
        device_map="cuda:0" if has_gpu else "cpu",
        max_inference_batch_size=MAX_BATCH_SIZE,
        max_new_tokens=MAX_NEW_TOKENS,
    )


def transcribe(model_name: str, media_path: str) -> str:
    """
    Transcribe a media file, language detected automatically

    Args:
        model_name (str): Hugging Face model id
        media_path (str): audio or video file (decoded with ffmpeg via PyAV)
    Returns:
        str: transcript
    """
    waveform = decode_audio(media_path, sampling_rate=SAMPLE_RATE)
    results = load_model(model_name).transcribe(audio=(waveform, SAMPLE_RATE))
    return " ".join(result.text.strip() for result in results)


def main() -> None:
    """
    Read model and file from the command line and print the transcript

    Returns:
        None
    Raises:
        SystemExit: wrong number of arguments
    """
    if len(sys.argv) != EXPECTED_ARGS:
        raise SystemExit("Usage: qwen_asr_transcribe.py <model> <media_path>")
    sys.stdout.write(transcribe(sys.argv[1], sys.argv[2]) + "\n")


if __name__ == "__main__":
    main()
