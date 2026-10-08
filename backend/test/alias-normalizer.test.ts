import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAlias } from "../src/matching/alias-normalizer.js";

// Tests for the alias normalizer, ensuring it correctly handles various input formats and edge cases.
test("normalizes Unicode, German spelling, punctuation, units, and decimal commas", () => {
  assert.equal(
    normalizeAlias("  Ｔ＆Ｂ  Crème-Brûlée  1,5L! "),
    "t und b crème brûlée 1.5 l",
  );
  assert.equal(normalizeAlias("TESTMÜHLE  1000 ml"), "testmuehle 1000 ml");
  assert.equal(normalizeAlias("Testmühle 1000ml"), "testmuehle 1000 ml");
  assert.equal(normalizeAlias("Straße\t1,5 kg"), "strasse 1.5 kg");
  assert.equal(normalizeAlias("A & B"), normalizeAlias("A und B"));
});

// Additional tests for edge cases and specific normalization rules.
test("does not expand abbreviations into semantic names", () => {
  assert.notEqual(normalizeAlias("T&B"), normalizeAlias("Test & Brand"));
});
