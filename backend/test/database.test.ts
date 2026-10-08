import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../src/db/database.js";

// Fresh databases must be migrated and enforce foreign key constraints.
test("database initialization applies migrations to a fresh database", () => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-tracker-db-"));
  const { sqlite } = createDatabase(join(directory, "test.sqlite"));

  try {
    const migrations = sqlite
      .prepare("SELECT id FROM __drizzle_migrations")
      .all();
    assert.ok(migrations.length > 0);

    assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1);
    assert.throws(
      () =>
        sqlite
          .prepare(
            "INSERT INTO warranty (receipt_item_id, type, start_date, end_date, created_at, updated_at) VALUES (999, 'statutory', '2026-01-01', '2028-01-01', 'now', 'now')",
          )
          .run(),
      { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

// Test to ensure that database initialization skips migrations that have already been applied.
test("database initialization skips migrations already applied", () => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-tracker-db-"));
  const filename = join(directory, "test.sqlite");

  try {
    const first = createDatabase(filename);
    let migrationsBefore: unknown[];
    let categoriesBefore: unknown[];
    try {
      migrationsBefore = first.sqlite
        .prepare("SELECT * FROM __drizzle_migrations ORDER BY id")
        .all();
      categoriesBefore = first.sqlite
        .prepare("SELECT * FROM category ORDER BY id")
        .all();
    } finally {
      first.sqlite.close();
    }

    const second = createDatabase(filename);
    try {
      assert.deepEqual(
        second.sqlite
          .prepare("SELECT * FROM __drizzle_migrations ORDER BY id")
          .all(),
        migrationsBefore,
      );
      assert.deepEqual(
        second.sqlite.prepare("SELECT * FROM category ORDER BY id").all(),
        categoriesBefore,
      );
    } finally {
      second.sqlite.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Test to ensure that a migration failure prevents the backend from starting up.
test("migration failure prevents backend startup", () => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-tracker-db-"));
  const filename = join(directory, "test.sqlite");

  try {
    const sqlite = new Database(filename);
    sqlite.exec("CREATE TABLE category (id INTEGER PRIMARY KEY)");
    sqlite.close();

    assert.throws(
      () => createDatabase(filename),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.cause instanceof Error);
        assert.ok(error.cause.message.includes("already exists"));
        return true;
      },
    );

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          DATABASE_FILE: filename,
          LLM_PROVIDER: "ollama",
          OLLAMA_MODEL: "test-model",
          LOG_FILE: join(directory, "backend.log"),
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      result.stderr.includes(
        "Backend startup failed during database migration",
      ),
    );
    assert.ok(!result.stdout.includes("Backend listening"));
    const events = readFileSync(join(directory, "backend.log"), "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      events.some(
        (event) =>
          event.operation === "backend.start.failed" &&
          event.phase === "database migration" &&
          event.errorType === "DrizzleError",
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Upgrade real legacy schemas without losing remaining settings or breaking foreign keys.
test("provider migration removes obsolete settings and preserves supported defaults", () => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-provider-migration-"));
  const migrationsFolder = join(directory, "migrations");
  const source = fileURLToPath(new URL("../drizzle", import.meta.url));
  mkdirSync(join(migrationsFolder, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(source, "meta", "_journal.json"), "utf8"),
  );
  journal.entries = journal.entries.slice(0, 3);
  writeFileSync(
    join(migrationsFolder, "meta", "_journal.json"),
    JSON.stringify(journal),
  );
  for (const entry of journal.entries) {
    copyFileSync(
      join(source, `${entry.tag}.sql`),
      join(migrationsFolder, `${entry.tag}.sql`),
    );
  }
  try {
    for (const defaultProvider of ["mistral", "ollama", "openai", null]) {
      const filename = join(directory, `${defaultProvider}.sqlite`);
      const legacy = new Database(filename);
      try {
        legacy.pragma("foreign_keys = ON");
        migrate(drizzle(legacy), { migrationsFolder });
        legacy
          .prepare(
            "INSERT INTO ai_provider_settings (provider, enabled, model, ollama_base_url, api_key_encrypted) VALUES (?, 1, ?, ?, ?)",
          )
          .run("ollama", "local-model", "http://localhost:11434/proxy", null);
        for (const provider of ["mistral", "openai"]) {
          legacy
            .prepare(
              "INSERT INTO ai_provider_settings (provider, enabled, model, api_key_encrypted) VALUES (?, 1, ?, ?)",
            )
            .run(provider, `${provider}-model`, `${provider}-ciphertext`);
        }
        legacy
          .prepare(
            "INSERT INTO receipt_processing_settings (id, default_provider) VALUES (1, ?)",
          )
          .run(defaultProvider);
      } finally {
        legacy.close();
      }
      const { sqlite } = createDatabase(filename);
      try {
        assert.deepEqual(
          sqlite
            .prepare("SELECT * FROM ai_provider_settings ORDER BY provider")
            .all(),
          [
            {
              provider: "ollama",
              enabled: 1,
              model: "local-model",
              ollama_base_url: "http://localhost:11434/proxy",
              api_key_encrypted: null,
            },
            {
              provider: "openai",
              enabled: 1,
              model: "openai-model",
              ollama_base_url: null,
              api_key_encrypted: "openai-ciphertext",
            },
          ],
        );
        assert.deepEqual(
          sqlite.prepare("SELECT * FROM receipt_processing_settings").get(),
          {
            id: 1,
            default_provider:
              defaultProvider === "mistral" ? null : defaultProvider,
          },
        );
        assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1);
        assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
        assert.throws(
          () =>
            sqlite
              .prepare(
                "INSERT INTO ai_provider_settings (provider) VALUES ('mistral')",
              )
              .run(),
          { code: "SQLITE_CONSTRAINT_CHECK" },
        );
        assert.throws(
          () =>
            sqlite
              .prepare(
                "UPDATE receipt_processing_settings SET default_provider = 'missing'",
              )
              .run(),
          { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
        );
      } finally {
        sqlite.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
