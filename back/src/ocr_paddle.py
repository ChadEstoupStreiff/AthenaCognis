import json
import sys

from paddleocr import PaddleOCR


def main(image_path):
    ocr = PaddleOCR(use_angle_cls=True, lang="latin", show_log=False)
    result = ocr.ocr(image_path, cls=True)
    print(json.dumps(result[0]))


if __name__ == "__main__":
    image_path = sys.argv[1]
    main(image_path)
