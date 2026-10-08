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

// Translation keys and interpolation parameters must agree between languages.
test("application DE/EN have matching keys and interpolation parameters", () => {
  const english = new Map(flatten(en));
  const german = new Map(flatten(de));
  assert.deepEqual([...english.keys()].sort(), [...german.keys()].sort());
  for (const [key, value] of english) {
    const parameters = (text) =>
      [...text.matchAll(/\{\{(.*?)\}\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(parameters(value), parameters(german.get(key)), key);
    assert.ok(german.get(key).trim(), key);
  }
});

// Every translation referenced by application code must resolve in both languages.
test("all application translation keys resolve in both languages", async () => {
  const i18n = createInstance();
  await i18n.init({
    resources: { en: { translation: en }, de: { translation: de } },
    fallbackLng: false,
  });
  const leaves = flatten(en).map(([key]) => key);
  const pattern = /\bt\(\s*(["`])([^"`\n]+)\1/g;
  const sourceFiles = files(source);
  for (const file of sourceFiles) {
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
      for (const lng of ["en", "de"]) {
        for (const key of keys)
          assert.ok(
            i18n.exists(key, { lng }),
            `${lng}: ${key} in ${file.pathname}`,
          );
      }
    }
  }
});
