import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatMissingPropertyValue,
  isLuauSequenceArray,
  isSkippedPropertyName,
} from "../src/types.js";

describe("isLuauSequenceArray", () => {
  it("returns true for non-string arrays", () => {
    assert.equal(isLuauSequenceArray([1, 2, 3]), true);
    assert.equal(isLuauSequenceArray([null]), true);
    assert.equal(isLuauSequenceArray(["a", 1]), true);
  });

  it("returns false for string arrays", () => {
    assert.equal(isLuauSequenceArray([]), false);
    assert.equal(isLuauSequenceArray(["a", "b"]), false);
  });

  it("returns false for non-arrays", () => {
    assert.equal(isLuauSequenceArray(null), false);
    assert.equal(isLuauSequenceArray("text"), false);
    assert.equal(isLuauSequenceArray(0), false);
    assert.equal(isLuauSequenceArray({ key: "value" }), false);
  });
});

describe("formatMissingPropertyValue", () => {
  it("returns null for nil mode", () => {
    assert.equal(formatMissingPropertyValue("nil", "rich_text"), null);
  });

  it("returns empty string for empty_string mode on string-like types", () => {
    assert.equal(formatMissingPropertyValue("empty_string", "rich_text"), "");
    assert.equal(formatMissingPropertyValue("empty_string", "select"), "");
  });

  it("returns null for omit mode", () => {
    assert.equal(formatMissingPropertyValue("omit", "rich_text"), null);
    assert.equal(formatMissingPropertyValue("omit", "number"), null);
  });
});

describe("isSkippedPropertyName", () => {
  it("skips names that start with [Skip]", () => {
    assert.equal(isSkippedPropertyName("[Skip] Notes"), true);
    assert.equal(isSkippedPropertyName("[Skip]設計メモ"), true);
    assert.equal(isSkippedPropertyName("[Skip]"), true);
  });

  it("does not skip names without the prefix", () => {
    assert.equal(isSkippedPropertyName("Notes"), false);
    assert.equal(isSkippedPropertyName("Skip Notes"), false);
    assert.equal(isSkippedPropertyName("Notes [Skip]"), false);
    assert.equal(isSkippedPropertyName("Position [Vector3]"), false);
  });
});
