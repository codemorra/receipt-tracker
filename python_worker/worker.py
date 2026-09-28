import json
import os
import sys
import traceback

from .ocr import initialize_ocr
from .preview import create_preview


def send(message, output):
    """Send a message to the specified output stream.

    Args:
        message (dict): The message to send.
        output: The output stream to write the message to.
    """
    output.write(json.dumps(message, separators=(",", ":")) + "\n")
    output.flush()


def handle_request(request):
    """Handles a request from the standard input.

    Args:
        request (dict): The request to handle.

    Returns:
        dict: The response to send back to the standard output.
    """
    if not isinstance(request, dict):
        raise TypeError("Request must be an object")
    request_id = request.get("requestId")
    if not isinstance(request_id, str) or not request_id:
        raise ValueError("requestId must be a non-empty string")
    if request.get("type") != "preview":
        raise ValueError("Unsupported request type")
    if not isinstance(request.get("originalPath"), str) or not request["originalPath"]:
        raise ValueError("originalPath must be a non-empty string")
    if not isinstance(request.get("previewPath"), str) or not request["previewPath"]:
        raise ValueError("previewPath must be a non-empty string")

    result = create_preview(request["originalPath"], request["previewPath"])
    return {"requestId": request_id, "status": "ok", **result}


def main():
    """Main loop for the worker process.

    Reads requests from the standard input, handles them, and sends responses to the standard output.
    """
    protocol_output = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    sys.stdout.flush()
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())

    initialize_ocr()

    send({"type": "ready"}, protocol_output)
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            if isinstance(request, dict):
                request_id = request.get("requestId")
            send(handle_request(request), protocol_output)
        except (OSError, ValueError, TypeError) as error:
            traceback.print_exc(file=sys.stderr)
            send({"requestId": request_id, "status": "error", "error": str(error)}, protocol_output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
