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
            "text_det_box_thresh": 0.4,
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


class DocImgOrientationClassification:
    """Mock implementation of the DocImgOrientationClassification class for testing purposes."""
    def __init__(self, **options):
        if options != {"model_name": "PP-LCNet_x1_0_doc_ori", "device": "cpu", "enable_hpi": True}:
            raise ValueError("Unexpected orientation configuration")
        if os.environ.get("ORIENTATION_TEST_FAIL_START"):
            raise RuntimeError("Orientation model unavailable")
        print("Orientation initialized")
        os.write(1, b"Native orientation initialization log\n")

    def predict(self, pixels):
        """Mock predict method for the DocImgOrientationClassification class."""
        if os.environ.get("ORIENTATION_TEST_FAIL_PREDICT"):
            raise RuntimeError("Orientation prediction failed")
        print("Orientation predicted")
        os.write(1, b"Native orientation prediction log\n")
        return [SimpleNamespace(json={"res": {
            "label_names": [os.environ.get("ORIENTATION_TEST_ANGLE", "0")],
            "scores": [float(os.environ.get("ORIENTATION_TEST_CONFIDENCE", "0.95"))],
        }})]
