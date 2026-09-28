import os
from types import SimpleNamespace

from PIL import Image


class PaddleOCR:
    """Mock implementation of the PaddleOCR class for testing purposes."""
    def __init__(self, **options):
        if os.environ.get("OCR_TEST_FAIL_START"):
            raise RuntimeError("HPI dependencies unavailable")
        expected = {
            "text_detection_model_name": "PP-OCRv6_medium_det",
            "text_recognition_model_name": "PP-OCRv6_medium_rec",
            "ocr_version": "PP-OCRv6",
            "lang": "german",
            "device": "cpu",
            "enable_hpi": True,
            "enable_mkldnn": True,
            "text_recognition_batch_size": 8,
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
            "text_det_limit_side_len": 16384,
            "text_det_limit_type": "max",
        }
        if options != expected:
            raise ValueError("Unexpected PaddleOCR configuration")
        print("PaddleOCR initialized")
        os.write(1, b"Native OCR initialization log\n")

    def predict(self, path):
        """Mock predict method for the PaddleOCR class."""
        if os.environ.get("OCR_TEST_FAIL_PREDICT"):
            raise RuntimeError("OCR prediction failed")
        with Image.open(path) as image:
            width, height = image.size
        print("PaddleOCR predicted")
        os.write(1, b"Native OCR prediction log\n")
        return [SimpleNamespace(json={"res": {
            "rec_texts": ["RECEIPT"],
            "rec_scores": [0.95],
            "rec_boxes": [[0, 0, width, height]],
        }})]
