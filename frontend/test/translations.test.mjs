import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createInstance } from "i18next";

const source = new URL("../src/", import.meta.url);
const en = JSON.parse(readFileSync(new URL("locales/en.json", source), "utf8"));
const de = JSON.parse(readFileSync(new URL("locales/de.json", source), "utf8"));
function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, text]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof text === "string" ? [[path, text]] : flatten(text, path);
  });
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    return entry.isDirectory()
      ? files(url)
      : /\.tsx?$/.test(entry.name)
        ? [url]
        : [];
  });
}

// Tests for ensuring that translation keys are consistent and fully utilized across the shell.
test("shell DE/EN have matching keys and interpolation parameters", () => {
  const english = new Map(flatten(en));
  const german = new Map(flatten(de));
  assert.deepEqual([...english.keys()].sort(), [...german.keys()].sort());
  for (const [key, value] of english) {
    const parameters = (text) =>
      [...text.matchAll(/\{\{(.*?)\}\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(parameters(value), parameters(german.get(key)), key);
    assert.ok(german.get(key).trim(), key);
  }
  assert.deepEqual(
    Object.keys(en).sort(),
    ["appearance", "common", "navigation", "pages"].sort(),
  );
});

// Tests for verifying that all shell translation keys are resolvable in both languages and that there are no unused locale entries.
test("all shell translation keys resolve in both languages without unused locale entries", async () => {
  const i18n = createInstance();
  await i18n.init({
    resources: { en: { translation: en }, de: { translation: de } },
    fallbackLng: false,
  });
  const leaves = flatten(en).map(([key]) => key);
  const pattern = /\bt\(\s*(["`])([^"`\n]+)\1/g;
  const usedKeys = new Set();
  // The original workflow is a reference snapshot with its own legacy locales.
  const shellFiles = [
    ...files(new URL("hooks/", source)),
    ...files(new URL("routes/", source)),
    ...files(new URL("appearance/", source)),
    ...files(new URL("components/", source)),
    ...files(new URL("pages/", source)),
    ...["App.tsx", "main.tsx", "i18n.ts"].map((name) => new URL(name, source)),
  ];
  for (const file of shellFiles) {
    for (const [, , expression] of readFileSync(file, "utf8").matchAll(
      pattern,
    )) {
      const prefix = expression.split("${")[0];
      const dynamic = expression.includes("${") || prefix.endsWith(".");
      const keys = dynamic
        ? leaves.filter((key) => key.startsWith(prefix))
        : [expression];
      assert.ok(
        keys.length,
        `No translations for ${expression} in ${file.pathname}`,
      );
      for (const key of keys) usedKeys.add(key);
      for (const lng of ["en", "de"]) {
        for (const key of keys)
          assert.ok(
            i18n.exists(key, { lng }),
            `${lng}: ${key} in ${file.pathname}`,
          );
      }
    }
  }
  assert.deepEqual([...usedKeys].sort(), leaves.sort());
});
