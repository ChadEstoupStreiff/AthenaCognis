import sys
import torch
from PIL import Image
from transformers import BlipProcessor, BlipForConditionalGeneration

def main(image_path):
    device = "cuda" if torch.cuda.is_available() else "cpu"

    processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
    model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
    model.to(device)

    image = Image.open(image_path).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    output = model.generate(**inputs, max_new_tokens=50)
    description = processor.tokenizer.decode(output[0], skip_special_tokens=True)
    print(description)

if __name__ == "__main__":
    image_path = sys.argv[1]
    main(image_path)