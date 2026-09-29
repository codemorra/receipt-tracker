import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAlias } from "../src/matching/alias-normalizer.js";

// Tests for the alias normalizer, ensuring it correctly handles various input formats and edge cases.
test("normalizes Unicode, German spelling, punctuation, units, and decimal commas", () => {
  assert.equal(
    normalizeAlias("  Ｇ＆Ｇ  Crème-Brûlée  1,5L! "),
    "g und g crème brûlée 1.5 l",
  );
  assert.equal(normalizeAlias("MÜLLER  1000 ml"), "mueller 1000 ml");
  assert.equal(normalizeAlias("Müller 1000ml"), "mueller 1000 ml");
  assert.equal(normalizeAlias("Straße\t1,5 kg"), "strasse 1.5 kg");
  assert.equal(normalizeAlias("A & B"), normalizeAlias("A und B"));
});

// Additional tests for edge cases and specific normalization rules.
test("does not expand abbreviations into semantic names", () => {
  assert.notEqual(normalizeAlias("G&G"), normalizeAlias("Gut & Günstig"));
});
