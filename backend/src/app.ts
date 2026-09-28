import express, { type ErrorRequestHandler } from "express";
import {
  WorkerRequestError,
  WorkerUnavailableError,
} from "./worker/python-worker-client.js";
import {
  InvalidCornersError,
  InvalidUploadError,
  MAX_UPLOAD_BYTES,
  ScanSessionService,
} from "./scans/scan-session-service.js";

/**
 * Creates and configures an Express application.
 *
 * @param scans - The ScanSessionService instance used for handling scan sessions.
 * @returns The configured Express application.
 */
export function createApp(scans: ScanSessionService) {
  const app = express();

  // Health check endpoint
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  // Scan creation endpoint
  app.post(
    "/api/scans",
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (request, response) => {
      try {
        const scan = await scans.create(
          request.headers["content-type"],
          request.body,
        );
        response.status(201).json(scan);
      } catch (error) {
        if (error instanceof InvalidUploadError) {
          response
            .status(error.status)
            .json({ error: "invalid_upload", message: error.message });
        } else if (error instanceof WorkerUnavailableError) {
          response.status(503).json({ error: "worker_unavailable" });
        } else if (error instanceof WorkerRequestError) {
          response.status(422).json({ error: "invalid_image" });
        } else {
          console.error("Scan creation failed", error);
          response.status(500).json({ error: "scan_failed" });
        }
      }
    },
  );

  // Scan preview endpoint
  app.get("/api/scans/:scanId/preview", async (request, response) => {
    try {
      const previewPath = await scans.previewPath(request.params.scanId);
      if (!previewPath) {
        response.status(404).json({ error: "scan_not_found" });
        return;
      }
      response.type("image/webp").sendFile(previewPath);
    } catch (error) {
      console.error("Scan preview failed", error);
      response.status(500).json({ error: "scan_failed" });
    }
  });

  // Scan processing endpoint
  app.post(
    "/api/scans/:scanId/process",
    express.json({ limit: "16kb" }),
    async (request, response) => {
      try {
        const result = await scans.process(
          request.params.scanId,
          request.body?.corners,
        );
        if (!result) {
          response.status(404).json({ error: "scan_not_found" });
          return;
        }
        response.json(result);
      } catch (error) {
        if (error instanceof InvalidCornersError) {
          response.status(400).json({ error: "invalid_corners" });
        } else if (error instanceof WorkerUnavailableError) {
          response.status(503).json({ error: "worker_unavailable" });
        } else if (error instanceof WorkerRequestError) {
          response.status(422).json({ error: "processing_failed" });
        } else {
          console.error("Scan processing failed", error);
          response.status(500).json({ error: "scan_failed" });
        }
      }
    },
  );

  // Scan archive endpoint
  app.get("/api/scans/:scanId/archive", async (request, response) => {
    try {
      const archivePath = await scans.archivePath(request.params.scanId);
      if (!archivePath) {
        response.status(404).json({ error: "scan_not_found" });
        return;
      }
      response.type("image/webp").sendFile(archivePath);
    } catch (error) {
      console.error("Scan archive failed", error);
      response.status(500).json({ error: "scan_failed" });
    }
  });

  // Global error handler
  const handleError: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 413
    ) {
      response.status(413).json({ error: "upload_too_large" });
      return;
    }
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 400
    ) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    console.error("Request failed", error);
    response.status(500).json({ error: "request_failed" });
  };
  app.use(handleError);

  return app;
}
