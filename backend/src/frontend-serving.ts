import express, { type Express } from "express";

/**
 * Register frontend serving routes for the SPA.
 * This should be done after API routes so that only browser routes receive the SPA document.
 * @param app The Express application instance.
 * @param frontendRoot The root directory of the frontend static files.
 */
export function registerFrontendServing(
  app: Express,
  frontendRoot: string,
): void {
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  app.use(express.static(frontendRoot, { index: false, redirect: false }));

  app.get(
    /^\/(?:import|receipts|analytics|warranties|settings)?\/*$/,
    (request, response, next) => {
      if (!request.accepts("html")) {
        next();
        return;
      }
      response.sendFile("index.html", { root: frontendRoot }, (error) => {
        if (!error) return;
        if ("status" in error && error.status === 404) next();
        else next(error);
      });
    },
  );
}
