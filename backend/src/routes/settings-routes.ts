import express, { type Express, type RequestHandler } from "express";
import { z } from "zod";
import { errorType, type Logger } from "../logger.js";
import type { ProviderSettingsService } from "../settings/provider-settings-service.js";
import {
  ProviderSettingsError,
  providerIdSchema,
} from "../settings/provider-settings.js";
import { SecretStorageError } from "../settings/secret-storage.js";

/**
 * Middleware to protect AI settings routes from foreign browser origins and DNS-rebinding hosts.
 * @param request The incoming Express request object.
 * @param response The outgoing Express response object.
 * @param next The next middleware function in the Express stack.
 * @returns Nothing. Calls next() if the request is allowed, otherwise sends a 403 response.
 */
const protectSettings: RequestHandler = (request, response, next) => {
  let target: URL;
  try {
    target = new URL(`http://${request.headers.host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
      throw new Error();
  } catch {
    response.status(403).json({ error: "settings_request_forbidden" });
    return;
  }
  const origin = request.headers.origin;
  const allowedOrigins = [
    target.origin,
    `https://${target.host}`,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ];
  if (
    request.get("x-receipt-tracker-settings") !== "1" ||
    (origin !== undefined && !allowedOrigins.includes(origin))
  ) {
    response.status(403).json({ error: "settings_request_forbidden" });
    return;
  }
  // The custom header forces foreign browser requests through a CORS preflight.
  // No CORS permissions are granted. Local non-browser clients can omit Origin.
  next();
};

/**
 * Registers the AI settings routes with the given Express application.
 * @param app The Express application instance.
 * @param settings The provider settings service.
 * @param logger The logger instance.
 */
export function registerSettingsRoutes(
  app: Express,
  settings: ProviderSettingsService,
  logger: Logger,
) {
  // Apply the protection middleware and JSON body parser to all AI settings routes.
  app.use("/api/settings/ai", protectSettings, express.json({ limit: "32kb" }));

  function handleFailure(error: unknown, response: express.Response) {
    logger("error", "settings.ai.failed", { errorType: errorType(error) });
    if (error instanceof ProviderSettingsError) {
      response
        .status(error.code === "invalid_provider_settings" ? 400 : 409)
        .json({ error: error.code });
    } else if (error instanceof SecretStorageError) {
      response.status(503).json({ error: error.code });
    } else {
      response.status(500).json({ error: "provider_settings_failed" });
    }
  }

  // GET route to fetch the current AI settings.
  app.get("/api/settings/ai", (_request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      response.json(settings.getSettings());
    } catch (error) {
      handleFailure(error, response);
    }
  });

  // PATCH route to update a specific AI provider's settings.
  app.patch("/api/settings/ai/providers/:provider", (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!request.is("application/json")) {
      response.status(415).json({ error: "settings_json_required" });
      return;
    }
    try {
      response.json(
        settings.updateProvider(request.params.provider, request.body),
      );
    } catch (error) {
      handleFailure(error, response);
    }
  });

  // PATCH route to update the default AI provider.
  const defaultSchema = z
    .object({ provider: providerIdSchema.nullable() })
    .strict();
  app.patch("/api/settings/ai/default-provider", (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!request.is("application/json")) {
      response.status(415).json({ error: "settings_json_required" });
      return;
    }
    const parsed = defaultSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_provider_settings" });
      return;
    }
    try {
      response.json({
        defaultProvider: settings.setDefaultProvider(parsed.data.provider),
      });
    } catch (error) {
      handleFailure(error, response);
    }
  });
}
