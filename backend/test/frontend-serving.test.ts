import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/database.js";
import { ScanSessionService } from "../src/scans/scan-session-service.js";

const html = '<!doctype html><html><body><div id="root"></div></body></html>';

// Helper function to start the application with a temporary frontend directory.
async function startApp(t: TestContext, serveFrontend = true) {
  const directory = await mkdtemp(join(tmpdir(), "receipt-frontend-"));
  const frontend = join(directory, "frontend");
  if (serveFrontend) {
    await mkdir(join(frontend, "assets"), { recursive: true });
    await mkdir(join(frontend, "api"));
    await writeFile(join(frontend, "index.html"), html);
    await writeFile(
      join(frontend, "assets/app.js"),
      'console.log("frontend");',
    );
    await writeFile(
      join(frontend, "api/missing"),
      "must not shadow API routes",
    );
    await writeFile(join(frontend, "health"), "must not shadow health");
  }
  const { sqlite, db } = createDatabase(":memory:");
  const scans = new ScanSessionService(join(directory, "scans"), {
    async requestPreview() {
      throw new Error("Unexpected preview");
    },
    async requestProcess() {
      throw new Error("Unexpected OCR");
    },
  });
  const app = createApp(
    scans,
    db,
    () => {
      throw new Error("Unexpected provider resolution");
    },
    directory,
    undefined,
    undefined,
    serveFrontend ? frontend : undefined,
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { base: `http://127.0.0.1:${address.port}`, frontend };
}

// Test that the production setup serves the SPA correctly for various browser routes and handles HEAD requests.
test("production serves browser routes, deep links and HEAD requests", async (t) => {
  const { base } = await startApp(t);
  for (const path of [
    "/",
    "/import",
    "/receipts",
    "/analytics",
    "/warranties",
    "/settings",
    "/import?receiptId=42",
    "/receipts/",
  ]) {
    const response = await fetch(`${base}${path}`, {
      headers: { Accept: "text/html" },
    });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(await response.text(), html);
  }
  const head = await fetch(`${base}/import?receiptId=42`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

// Test that API and health routes take precedence over the frontend.
test("API and health routes take precedence over the frontend", async (t) => {
  const { base } = await startApp(t);
  const health = await fetch(`${base}/health`);
  assert.deepEqual(await health.json(), { status: "ok" });
  const categories = await fetch(`${base}/api/categories`);
  assert.equal(categories.status, 200);
  assert.ok(Array.isArray(await categories.json()));
  for (const path of ["/api", "/api/missing", "/api/missing/deep"]) {
    const missing = await fetch(`${base}${path}`, {
      headers: { Accept: "text/html" },
    });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "not_found" });
  }
});

// Test that static assets are served and missing files never receive the SPA document.
test("static assets are served and missing files never receive the SPA document", async (t) => {
  const { base } = await startApp(t);
  const asset = await fetch(`${base}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type") ?? "", /javascript/);
  assert.equal(await asset.text(), 'console.log("frontend");');
  for (const path of [
    "/assets/missing.js",
    "/assets/missing",
    "/favicon.ico",
    "/missing.css",
    "/unknown",
  ]) {
    const missing = await fetch(`${base}${path}`, {
      headers: { Accept: "text/html" },
    });
    assert.equal(missing.status, 404, path);
    assert.notEqual(await missing.text(), html);
  }
});

// Test that the SPA fallback only handles HTML GET or HEAD navigation.
test("SPA fallback only handles HTML GET or HEAD navigation", async (t) => {
  const { base } = await startApp(t);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const path of ["/", "/import", "/assets/app.js", "/api/missing"]) {
      const response = await fetch(`${base}${path}`, { method });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.notEqual(await response.text(), html);
    }
  }
  const json = await fetch(`${base}/import`, {
    headers: { Accept: "application/json" },
  });
  assert.equal(json.status, 404);
});

// Test that the development setup runs correctly even without a frontend build.
test("development runs without a frontend build", async (t) => {
  const { base } = await startApp(t, false);
  const health = await fetch(`${base}/health`);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal((await fetch(`${base}/api/categories`)).status, 200);
  assert.equal((await fetch(`${base}/import`)).status, 404);
});

// Test that a missing production index.html returns a 404 instead of an internal server error.
test("missing production index returns 404 instead of an internal server error", async (t) => {
  const { base, frontend } = await startApp(t);
  await rm(join(frontend, "index.html"));
  assert.equal((await fetch(`${base}/import`)).status, 404);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
