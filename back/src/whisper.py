import os
import sys

from faster_whisper import WhisperModel


def main(model, audio_path):
    device = "cuda" if os.path.exists("/dev/nvidia0") else "cpu"
    model = WhisperModel(model, device=device)
    segments, _ = model.transcribe(audio_path)
    full_text = " ".join([segment.text for segment in segments])
    print(full_text)


if __name__ == "__main__":
    model = sys.argv[1]
    audio_path = sys.argv[2]

    main(model, audio_path)
