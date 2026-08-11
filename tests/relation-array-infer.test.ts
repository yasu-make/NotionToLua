import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotionToLuaError } from "../src/errors.js";
import {
  extractScalarArrayColumnName,
  inferRelationArrayMeta,
} from "../src/relation-array-infer.js";
import type { LuauRecord } from "../src/types.js";

function record(
  key: string,
  properties: LuauRecord["properties"],
): LuauRecord {
  return {
    key,
    keyFormat: "identifier",
    properties,
  };
}

function expectNotionToLuaError(
  fn: () => unknown,
  messagePattern?: RegExp,
): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof NotionToLuaError);
    if (messagePattern) {
      assert.match(error.message, messagePattern);
    }
    return true;
  });
}

describe("inferRelationArrayMeta", () => {
  it("defaults to string scalar_array when every record is missing or null", () => {
    assert.deepEqual(
      inferRelationArrayMeta("items", [
        record("A", { items: null }),
        record("B", {}),
        record("C", { items: undefined as unknown as null }),
      ]),
      { kind: "scalar_array", valueType: "string" },
    );
  });

  it("infers number scalar_array", () => {
    assert.deepEqual(
      inferRelationArrayMeta("scores", [
        record("A", { scores: [1, 2] }),
        record("B", { scores: [3] }),
      ]),
      { kind: "scalar_array", valueType: "number", valueNotionType: "number" },
    );
  });

  it("infers boolean scalar_array", () => {
    assert.deepEqual(
      inferRelationArrayMeta("flags", [
        record("A", { flags: [true] }),
        record("B", { flags: [false, true] }),
      ]),
      { kind: "scalar_array", valueType: "boolean", valueNotionType: "checkbox" },
    );
  });

  it("throws when property values are string arrays", () => {
    expectNotionToLuaError(() =>
      inferRelationArrayMeta("labels", [
        record("A", { labels: ["alpha"] }),
        record("B", { labels: ["beta", "gamma"] }),
      ]),
    );
  });

  it("infers TypedRobloxValue scalar_array as string", () => {
    assert.deepEqual(
      inferRelationArrayMeta("positions", [
        record("A", {
          positions: [{ kind: "Vector3", x: 1, y: 2, z: 3 }],
        }),
        record("B", {
          positions: [{ kind: "Vector3", x: 4, y: 5, z: 6 }],
        }),
      ]),
      { kind: "scalar_array", valueType: "string", valueNotionType: "rich_text" },
    );
  });

  it("infers nested_array with entryProperties sorted by name", () => {
    assert.deepEqual(
      inferRelationArrayMeta("entries", [
        record("A", {
          entries: [{ zebra: 1, alpha: "x" }],
        }),
        record("B", {
          entries: [{ beta: true, alpha: "y" }],
        }),
      ]),
      {
        kind: "nested_array",
        entryProperties: [
          { name: "alpha", notionType: "rich_text" },
          { name: "beta", notionType: "checkbox" },
          { name: "zebra", notionType: "number" },
        ],
      },
    );
  });

  it("throws when scalar and nested entries are mixed", () => {
    expectNotionToLuaError(
      () =>
        inferRelationArrayMeta("items", [
          record("A", { items: [1, 2] }),
          record("B", { items: [{ name: "nested" }] }),
        ]),
      /mixed array entry types/,
    );
  });

  it("throws when scalar entry types are mixed", () => {
    expectNotionToLuaError(
      () =>
        inferRelationArrayMeta("items", [
          record("A", { items: [1] }),
          record("B", { items: [true] }),
        ]),
      /mixed scalar array entry types/,
    );
  });

  it("throws when string[] is mixed with sequence arrays", () => {
    expectNotionToLuaError(
      () =>
        inferRelationArrayMeta("items", [
          record("A", { items: ["a", "b"] }),
          record("B", { items: [1, 2] }),
        ]),
      /mixed array types/,
    );
  });

  it("throws when nested entry property types are mixed", () => {
    expectNotionToLuaError(
      () =>
        inferRelationArrayMeta("entries", [
          record("A", { entries: [{ score: 1 }] }),
          record("B", { entries: [{ score: "text" }] }),
        ]),
      /mixed value types across array entries/,
    );
  });

  it("throws when nested entry properties contain non-scalars", () => {
    expectNotionToLuaError(
      () =>
        inferRelationArrayMeta("entries", [
          record("A", { entries: [{ payload: { nested: true } }] }),
        ]),
      /must be scalars or tables/,
    );
  });
});

describe("extractScalarArrayColumnName", () => {
  it("maps number valueType to number", () => {
    assert.equal(
      extractScalarArrayColumnName({ kind: "scalar_array", valueType: "number" }),
      "number",
    );
  });

  it("maps boolean valueType to checkbox", () => {
    assert.equal(
      extractScalarArrayColumnName({
        kind: "scalar_array",
        valueType: "boolean",
      }),
      "checkbox",
    );
  });

  it("maps string and other valueTypes to rich_text", () => {
    assert.equal(
      extractScalarArrayColumnName({ kind: "scalar_array", valueType: "string" }),
      "rich_text",
    );
    assert.equal(
      extractScalarArrayColumnName({
        kind: "scalar_array",
        valueType: "{ string }",
      }),
      "rich_text",
    );
  });
});
