import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotionToLuaError } from "../src/errors.js";
import { formatArrayRelationPropertyName } from "../src/relation-array.js";
import { inferNotionSchema } from "../src/schema-infer.js";
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

describe("inferNotionSchema", () => {
  it("returns Name as the title property", () => {
    const schema = inferNotionSchema([
      record("Sword", { damage: 10 }),
    ]);

    assert.equal(schema.titlePropertyName, "Name");
  });

  it("infers number, checkbox, rich_text, and multi_select", () => {
    const schema = inferNotionSchema([
      record("Sword", {
        damage: 10,
        enabled: true,
        description: "sharp",
        tags: ["Fire", "Melee"],
      }),
      record("Bow", {
        damage: 5,
        enabled: false,
        description: "ranged",
        tags: ["Ice"],
      }),
    ]);

    assert.deepEqual(schema.properties, [
      { name: "damage", notionType: "number" },
      { name: "description", notionType: "rich_text" },
      { name: "enabled", notionType: "checkbox" },
      {
        name: "tags",
        notionType: "multi_select",
        multiSelectOptions: ["Fire", "Ice", "Melee"],
      },
    ]);
  });

  it("collects multi_select options uniquely across records with en locale sort", () => {
    const schema = inferNotionSchema([
      record("A", { tags: ["zebra", "alpha"] }),
      record("B", { tags: ["Alpha", "beta"] }),
    ]);

    const tags = schema.properties.find((property) => property.name === "tags");
    assert.deepEqual(tags?.multiSelectOptions, ["alpha", "Alpha", "beta", "zebra"]);
  });

  it("omits properties that are missing or null on every record", () => {
    const schema = inferNotionSchema([
      record("A", { damage: 1, notes: null }),
      record("B", { damage: 2 }),
      record("C", { optional: null }),
    ]);

    assert.deepEqual(
      schema.properties.map((property) => property.name),
      ["damage"],
    );
  });

  it("includes optional properties when at least one record has a value", () => {
    const schema = inferNotionSchema([
      record("A", { damage: 1 }),
      record("B", { damage: 2, notes: "extra" }),
    ]);

    assert.deepEqual(schema.properties, [
      { name: "damage", notionType: "number" },
      { name: "notes", notionType: "rich_text" },
    ]);
  });

  it("returns an empty property list for no records", () => {
    const schema = inferNotionSchema([]);

    assert.equal(schema.titlePropertyName, "Name");
    assert.deepEqual(schema.properties, []);
  });

  it("throws when a property has a nested table value", () => {
    assert.throws(
      () =>
        inferNotionSchema([
          record("A", {
            effects: { Fire: 10 },
          }),
        ]),
      (error: unknown) => {
        assert.ok(error instanceof NotionToLuaError);
        assert.match(
          error.message,
          /Property "effects" has a nested table value/,
        );
        return true;
      },
    );
  });

  it("throws when a property has an empty table value", () => {
    assert.throws(
      () =>
        inferNotionSchema([
          record("A", {
            tags: {},
          }),
        ]),
      (error: unknown) => {
        assert.ok(error instanceof NotionToLuaError);
        assert.match(
          error.message,
          /Property "tags" has an empty table value/,
        );
        return true;
      },
    );
  });

  it("throws when a property has mixed value types across records", () => {
    assert.throws(
      () =>
        inferNotionSchema([
          record("A", { value: 1 }),
          record("B", { value: "one" }),
        ]),
      (error: unknown) => {
        assert.ok(error instanceof NotionToLuaError);
        assert.match(
          error.message,
          /Property "value" has mixed value types across records/,
        );
        return true;
      },
    );
  });

  it("throws when a property name conflicts with the reserved title column", () => {
    assert.throws(
      () =>
        inferNotionSchema([
          record("A", {
            Name: "duplicate",
          }),
        ]),
      (error: unknown) => {
        assert.ok(error instanceof NotionToLuaError);
        assert.match(
          error.message,
          /Property "Name" conflicts with the reserved title column/,
        );
        return true;
      },
    );
  });

  it("throws when a record key is empty", () => {
    assert.throws(
      () =>
        inferNotionSchema([
          {
            key: "",
            keyFormat: "bracket",
            properties: { count: 1 },
          },
        ]),
      (error: unknown) => {
        assert.ok(error instanceof NotionToLuaError);
        assert.match(error.message, /Record key is empty/);
        return true;
      },
    );
  });

  it("infers scalar array relations with array notation property names", () => {
    const schema = inferNotionSchema([
      record("A", { items: [1, 2] }),
      record("B", { items: [3] }),
    ]);

    assert.deepEqual(schema.properties, [
      {
        name: "items",
        notionType: "relation",
        notionPropertyName: formatArrayRelationPropertyName("items"),
        relationMeta: {
          kind: "scalar_array",
          valueType: "number",
          valueNotionType: "number",
        },
      },
    ]);
  });

  it("infers nested array relations", () => {
    const schema = inferNotionSchema([
      record("A", { items: [{ hp: 10 }] }),
      record("B", { items: [{ hp: 20 }, { hp: 5 }] }),
    ]);

    assert.deepEqual(schema.properties, [
      {
        name: "items",
        notionType: "relation",
        notionPropertyName: formatArrayRelationPropertyName("items"),
        relationMeta: {
          kind: "nested_array",
          entryProperties: [{ name: "hp", notionType: "number" }],
        },
      },
    ]);
  });

  it("infers typed Roblox values as rich_text with typed property names", () => {
    const schema = inferNotionSchema([
      record("Spawn", {
        pos: { kind: "Vector3", x: 1, y: 2, z: 3 },
      }),
    ]);

    assert.deepEqual(schema.properties, [
      {
        name: "pos",
        notionType: "rich_text",
        robloxType: "Vector3",
        notionPropertyName: "pos [Vector3]",
      },
    ]);
  });

  it("throws when a property has mixed Roblox value types across records", () => {
    assert.throws(
      () =>
        inferNotionSchema([
          record("A", {
            pos: { kind: "Vector3", x: 1, y: 2, z: 3 },
          }),
          record("B", {
            pos: { kind: "Color3", r: 255, g: 128, b: 0 },
          }),
        ]),
      (error: unknown) => {
        assert.ok(error instanceof NotionToLuaError);
        assert.match(
          error.message,
          /Property "pos" has mixed Roblox value types across records/,
        );
        return true;
      },
    );
  });
});
