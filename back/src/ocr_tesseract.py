import sys

import pytesseract


def main(audio_path):
    print(pytesseract.image_to_string(audio_path, lang="eng+fra"))


if __name__ == "__main__":
    audio_path = sys.argv[1]

    main(audio_path)
