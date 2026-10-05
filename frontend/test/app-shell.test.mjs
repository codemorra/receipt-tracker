import assert from "node:assert/strict";
import test from "node:test";
import {
  appearanceKey,
  readAppearance,
  saveAppearance,
  resolveTheme,
} from "../src/appearance/appearance.ts";
import {
  receiptIdFromSearch,
  resolveRoute,
  sections,
} from "../src/routes/routing.ts";

// Tests for the app shell's appearance and routing behavior.
test("appearance mode and accent persist independently across reloads", () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  saveAppearance(storage, { mode: "dark", accent: "purple" });
  assert.deepEqual(readAppearance(storage), { mode: "dark", accent: "purple" });
  saveAppearance(storage, { ...readAppearance(storage), mode: "system" });
  assert.deepEqual(readAppearance(storage), {
    mode: "system",
    accent: "purple",
  });
  saveAppearance(storage, { ...readAppearance(storage), accent: "orange" });
  assert.deepEqual(readAppearance(storage), {
    mode: "system",
    accent: "orange",
  });
  assert.deepEqual([...entries.keys()], [appearanceKey]);
});

// Tests for handling invalid or unavailable appearance storage.
test("invalid or unavailable appearance storage uses safe independent defaults", () => {
  for (const value of [null, "invalid json", "null", "42", '"dark"']) {
    assert.deepEqual(readAppearance({ getItem: () => value }), {
      mode: "system",
      accent: "blue",
    });
  }
  assert.deepEqual(
    readAppearance({ getItem: () => '{"mode":"invalid","accent":"green"}' }),
    { mode: "system", accent: "green" },
  );
  assert.deepEqual(
    readAppearance({ getItem: () => '{"mode":"dark","accent":"invalid"}' }),
    { mode: "dark", accent: "blue" },
  );
  const unavailable = {
    getItem() {
      throw new Error("Storage disabled");
    },
    setItem() {
      throw new Error("Storage disabled");
    },
  };
  assert.deepEqual(readAppearance(unavailable), {
    mode: "system",
    accent: "blue",
  });
  assert.doesNotThrow(() =>
    saveAppearance(unavailable, { mode: "light", accent: "blue" }),
  );
});

// Tests for theme resolution based on system preference and explicit modes.
test("system theme follows OS changes while explicit modes stay fixed", () => {
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("system", true), "dark");
  for (const systemDark of [true, false]) {
    assert.equal(resolveTheme("light", systemDark), "light");
    assert.equal(resolveTheme("dark", systemDark), "dark");
  }
});

// Tests for route resolution and handling of direct shell routes, root, and trailing slashes.
test("direct shell routes, root, and trailing slashes resolve consistently", () => {
  assert.equal(resolveRoute("/", ""), "import");
  for (const section of sections) {
    assert.equal(resolveRoute(`/${section}`, ""), section);
    assert.equal(resolveRoute(`/${section}/`, "?unrelated=1"), section);
  }
  assert.equal(resolveRoute("/missing", ""), "notFound");
  assert.equal(resolveRoute("/receipts/12", ""), "notFound");
  assert.equal(resolveRoute("/legacy-import", ""), "notFound");
});

// Tests for loading existing receipt-ID URLs in the application shell.
test("existing receipt-ID URLs and reload/back flows load in the application shell", () => {
  for (const path of ["/", "/import", "/receipts"]) {
    assert.equal(resolveRoute(path, "?receiptId=123"), "import");
    assert.equal(receiptIdFromSearch("?receiptId=123"), 123);
  }
  const urls = [
    new URL("http://localhost/?receiptId=123"),
    new URL("http://localhost/import"),
    new URL("http://localhost/import?receiptId=456"),
  ];
  for (const url of [...urls, ...urls.toReversed()]) {
    assert.equal(resolveRoute(url.pathname, url.search), "import");
  }
  for (const value of ["", "0", "-1", "1.5", "NaN", "9007199254740992"]) {
    assert.equal(receiptIdFromSearch(`?receiptId=${value}`), null);
    assert.equal(resolveRoute("/receipts", `?receiptId=${value}`), "receipts");
  }
});
