import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateModuleScript } from "../src/generator.js";
import type { ExportableProperty, LuauRecord, OutputOptions } from "../src/types.js";

const sampleProperties: ExportableProperty[] = [
  { name: "count", notionType: "number" },
  { name: "enabled", notionType: "checkbox" },
];

function generate(
  records: LuauRecord[],
  moduleName = "testModule",
  properties: ExportableProperty[] = sampleProperties,
  exportTypes = true,
  outputOptions?: Partial<OutputOptions>,
): string {
  return generateModuleScript(records, {
    moduleName,
    properties,
    exportTypes,
    outputOptions: outputOptions
      ? {
          emptyValue: "omit",
          emptyRelation: "omit",
          ...outputOptions,
        }
      : undefined,
  });
}

describe("generateModuleScript", () => {
  it("returns an empty module for no records", () => {
    const output = generate([], "testModule", []);

    assert.match(output, /local testModule = \{\}/);
    assert.match(output, /return testModule/);
    assert.doesNotMatch(output, /export type/);
  });

  it("sorts records by key", () => {
    const records: LuauRecord[] = [
      {
        key: "Zebra",
        keyFormat: "identifier",
        properties: { label: "z" },
      },
      {
        key: "Alpha",
        keyFormat: "identifier",
        properties: { label: "a" },
      },
      {
        key: "Middle",
        keyFormat: "identifier",
        properties: { label: "m" },
      },
    ];

    const output = generate(records, "testModule", [
      { name: "label", notionType: "rich_text" },
    ]);

    assert.ok(output.indexOf("Alpha") < output.indexOf("Middle"));
    assert.ok(output.indexOf("Middle") < output.indexOf("Zebra"));
  });

  it("uses local variable and return statement", () => {
    const records: LuauRecord[] = [
      {
        key: "ItemA",
        keyFormat: "identifier",
        properties: { count: 1 },
      },
    ];

    const output = generate(records);

    assert.match(output, /export type TestModuleEntry/);
    assert.match(output, /export type TestModule/);
    assert.match(output, /export type TestModule = \{\n    ItemA: TestModuleEntry,\n\}\n\nlocal testModule: TestModule = \{/);
    assert.match(output, /\},\n\}\n\nreturn testModule/);
  });

  it("uses 4-space indentation", () => {
    const records: LuauRecord[] = [
      {
        key: "ItemA",
        keyFormat: "identifier",
        properties: { count: 1 },
      },
    ];

    const output = generate(records);
    const lines = output.split("\n");

    assert.match(lines.find((line) => line.includes("ItemA = {")) ?? "", /^ {4}ItemA = \{$/);
    assert.match(lines.find((line) => line.includes("count = 1")) ?? "", /^ {12}count = 1,$/);
  });

  it("adds trailing commas to records and properties", () => {
    const records: LuauRecord[] = [
      {
        key: "ItemA",
        keyFormat: "identifier",
        properties: { count: 1, enabled: true },
      },
      {
        key: "ItemB",
        keyFormat: "identifier",
        properties: { count: 2 },
      },
    ];

    const output = generate(records);

    assert.match(output, /count = 1,/);
    assert.match(output, /enabled = true,/);
    assert.match(output, /count = 2,/);
    assert.match(output, /\},\n    ItemB = \{/);
  });

  it("sorts property keys within each record", () => {
    const records: LuauRecord[] = [
      {
        key: "ItemA",
        keyFormat: "identifier",
        properties: {
          zebra: "z",
          alpha: "a",
          middle: "m",
        },
      },
    ];

    const output = generate(records, "testModule", [
      { name: "zebra", notionType: "rich_text" },
      { name: "alpha", notionType: "rich_text" },
      { name: "middle", notionType: "rich_text" },
    ]);

    assert.ok(output.indexOf("alpha") < output.indexOf("middle"));
    assert.ok(output.indexOf("middle") < output.indexOf("zebra"));
  });

  it("omits null properties", () => {
    const records: LuauRecord[] = [
      {
        key: "ItemA",
        keyFormat: "identifier",
        properties: {
          kept: "yes",
          skipped: null,
        },
      },
    ];

    const output = generate(records, "testModule", [
      { name: "kept", notionType: "rich_text" },
      { name: "skipped", notionType: "rich_text" },
    ]);

    assert.match(output, /kept: string,/);
    assert.match(output, /kept = "yes",/);
    assert.doesNotMatch(output, /skipped =/);
    assert.doesNotMatch(output, /skipped:/);
  });

  it("marks type fields optional only when missing in some records", () => {
    const records: LuauRecord[] = [
      {
        key: "ItemA",
        keyFormat: "identifier",
        properties: { count: 1, enabled: true },
      },
      {
        key: "ItemB",
        keyFormat: "identifier",
        properties: { count: 2 },
      },
    ];

    const output = generate(records);

    assert.match(output, /count: number,/);
    assert.match(output, /enabled: boolean\?,/);
  });

  it("uses bracket notation for invalid identifier keys", () => {
    const records: LuauRecord[] = [
      {
        key: "my-item",
        keyFormat: "bracket",
        properties: { label: "test" },
      },
    ];

    const output = generate(records, "testModule", [
      { name: "label", notionType: "rich_text" },
    ]);

    assert.match(output, /\["my-item"\] = \{/);
  });

  it("omits type definitions when exportTypes is false", () => {
    const records: LuauRecord[] = [
      {
        key: "ItemA",
        keyFormat: "identifier",
        properties: { count: 1 },
      },
    ];

    const output = generate(records, "testModule", sampleProperties, false);

    assert.doesNotMatch(output, /export type/);
    assert.doesNotMatch(output, /local testModule:/);
    assert.match(output, /local testModule = \{/);
    assert.match(output, /return testModule/);
  });

  it("formats bracket property keys inside records and types", () => {
    const records: LuauRecord[] = [
      {
        key: "ItemA",
        keyFormat: "identifier",
        properties: {
          "my-prop": "value",
        },
      },
    ];

    const output = generate(records, "testModule", [
      { name: "my-prop", notionType: "rich_text" },
    ]);

    assert.match(output, /\["my-prop"\]: string,/);
    assert.match(output, /\["my-prop"\] = "value",/);
  });

  it("sorts numeric record keys numerically and formats them with bracket indexes", () => {
    const records: LuauRecord[] = [
      {
        key: "10",
        keyFormat: "numeric",
        properties: { count: 10 },
      },
      {
        key: "1",
        keyFormat: "numeric",
        properties: { count: 1 },
      },
    ];

    const output = generate(records);

    assert.ok(output.indexOf("[1] = {") < output.indexOf("[10] = {"));
    assert.match(output, /export type TestModule = \{ \[number\]: TestModuleEntry \}/);
    assert.doesNotMatch(output, /\[1\]: TestModuleEntry,/);
    assert.doesNotMatch(output, /\[10\]: TestModuleEntry,/);
  });

  it("keeps keyed numeric indexes when omitArrayIndex is false", () => {
    const records: LuauRecord[] = [
      {
        key: "1",
        keyFormat: "numeric",
        properties: { count: 1 },
      },
      {
        key: "2",
        keyFormat: "numeric",
        properties: { count: 2 },
      },
      {
        key: "3",
        keyFormat: "numeric",
        properties: { count: 3 },
      },
    ];

    const output = generate(records, "testModule", sampleProperties, true, {
      omitArrayIndex: false,
    });

    assert.match(output, /\[1\] = \{/);
    assert.match(output, /\[2\] = \{/);
    assert.match(output, /\[3\] = \{/);
    assert.match(output, /export type TestModule = \{ \[number\]: TestModuleEntry \}/);
    assert.doesNotMatch(output, /export type TestModule = \{ TestModuleEntry \}/);
    assert.doesNotMatch(output, /\[1\]: TestModuleEntry,/);
  });

  it("emits keyless arrays and array module types when omitArrayIndex is true and keys are 1..N", () => {
    const records: LuauRecord[] = [
      {
        key: "1",
        keyFormat: "numeric",
        properties: { count: 1 },
      },
      {
        key: "2",
        keyFormat: "numeric",
        properties: { count: 2 },
      },
      {
        key: "3",
        keyFormat: "numeric",
        properties: { count: 3 },
      },
    ];

    const output = generate(records, "testModule", sampleProperties, true, {
      omitArrayIndex: true,
    });

    assert.match(output, /export type TestModule = \{ TestModuleEntry \}/);
    assert.match(output, /local testModule: TestModule = \{\n    \{\n        count = 1,/);
    assert.match(output, /count = 2,/);
    assert.match(output, /count = 3,/);
    assert.doesNotMatch(output, /\[1\] =/);
    assert.doesNotMatch(output, /\[2\] =/);
    assert.doesNotMatch(output, /\[3\] =/);
  });

  it("falls back to keyed numeric indexes when omitArrayIndex is true but keys are not dense 1..N", () => {
    const records: LuauRecord[] = [
      {
        key: "1",
        keyFormat: "numeric",
        properties: { count: 1 },
      },
      {
        key: "2",
        keyFormat: "numeric",
        properties: { count: 2 },
      },
      {
        key: "4",
        keyFormat: "numeric",
        properties: { count: 4 },
      },
    ];

    const output = generate(records, "testModule", sampleProperties, true, {
      omitArrayIndex: true,
    });

    assert.match(output, /\[1\] = \{/);
    assert.match(output, /\[2\] = \{/);
    assert.match(output, /\[4\] = \{/);
    assert.match(output, /export type TestModule = \{ \[number\]: TestModuleEntry \}/);
    assert.doesNotMatch(output, /export type TestModule = \{ TestModuleEntry \}/);
    assert.doesNotMatch(output, /\[1\]: TestModuleEntry,/);
  });

  it("falls back to keyed numeric indexes when omitArrayIndex is true but keys do not start at 1", () => {
    const records: LuauRecord[] = [
      {
        key: "0",
        keyFormat: "numeric",
        properties: { count: 0 },
      },
      {
        key: "1",
        keyFormat: "numeric",
        properties: { count: 1 },
      },
      {
        key: "2",
        keyFormat: "numeric",
        properties: { count: 2 },
      },
    ];

    const output = generate(records, "testModule", sampleProperties, true, {
      omitArrayIndex: true,
    });

    assert.match(output, /\[0\] = \{/);
    assert.match(output, /\[1\] = \{/);
    assert.match(output, /\[2\] = \{/);
    assert.match(output, /export type TestModule = \{ \[number\]: TestModuleEntry \}/);
    assert.doesNotMatch(output, /export type TestModule = \{ TestModuleEntry \}/);
    assert.doesNotMatch(output, /\[1\]: TestModuleEntry,/);
  });

  it("uses [number] index signature for mixed numeric and non-numeric module types", () => {
    const records: LuauRecord[] = [
      {
        key: "Alpha",
        keyFormat: "identifier",
        properties: { count: 1 },
      },
      {
        key: "1",
        keyFormat: "numeric",
        properties: { count: 10 },
      },
      {
        key: "2",
        keyFormat: "numeric",
        properties: { count: 20 },
      },
    ];

    const output = generate(records);

    assert.match(output, /Alpha: TestModuleEntry,/);
    assert.match(output, /\[number\]: TestModuleEntry,/);
    assert.doesNotMatch(output, /\[1\]: TestModuleEntry,/);
    assert.doesNotMatch(output, /\[2\]: TestModuleEntry,/);
    assert.match(output, /Alpha = \{/);
    assert.match(output, /\[1\] = \{/);
    assert.match(output, /\[2\] = \{/);
  });
});

describe("generateModuleScript select/status/multi_select literal unions", () => {
  it("emits select literal union from record values", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: { weaponType: "melee" },
      },
      {
        key: "Bow",
        keyFormat: "identifier",
        properties: { weaponType: "ranged" },
      },
    ];

    const output = generate(records, "weapons", [
      { name: "weaponType", notionType: "select" },
    ]);

    assert.match(output, /weaponType: "melee" \| "ranged",/);
  });

  it("emits status literal union from record values", () => {
    const records: LuauRecord[] = [
      {
        key: "TaskA",
        keyFormat: "identifier",
        properties: { status: "Done" },
      },
      {
        key: "TaskB",
        keyFormat: "identifier",
        properties: { status: "In Progress" },
      },
    ];

    const output = generate(records, "tasks", [
      { name: "status", notionType: "status" },
    ]);

    assert.match(output, /status: "Done" \| "In Progress",/);
  });

  it("emits multi_select literal union wrapped in array type", () => {
    const records: LuauRecord[] = [
      {
        key: "SpellA",
        keyFormat: "identifier",
        properties: { elements: ["Fire"] },
      },
      {
        key: "SpellB",
        keyFormat: "identifier",
        properties: { elements: ["Ice", "Fire"] },
      },
    ];

    const output = generate(records, "spells", [
      { name: "elements", notionType: "multi_select" },
    ]);

    assert.match(output, /elements: \{ "Fire" \| "Ice" \},/);
  });

  it("emits a single literal without union separator for one select value", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: { weaponType: "melee" },
      },
    ];

    const output = generate(records, "weapons", [
      { name: "weaponType", notionType: "select" },
    ]);

    assert.match(output, /weaponType: "melee",/);
    assert.doesNotMatch(output, /weaponType: "melee" \|/);
  });

  it("sorts literal union members with en locale", () => {
    const records: LuauRecord[] = [
      {
        key: "Z",
        keyFormat: "identifier",
        properties: { tier: "Zebra" },
      },
      {
        key: "A",
        keyFormat: "identifier",
        properties: { tier: "Alpha" },
      },
    ];

    const output = generate(records, "items", [
      { name: "tier", notionType: "select" },
    ]);

    assert.match(output, /tier: "Alpha" \| "Zebra",/);
  });

  it("escapes special characters in literal unions", () => {
    const records: LuauRecord[] = [
      {
        key: "Greeting",
        keyFormat: "identifier",
        properties: { phrase: 'say "hi"' },
      },
    ];

    const output = generate(records, "quotes", [
      { name: "phrase", notionType: "select" },
    ]);

    assert.match(output, /phrase: "say \\"hi\\"",/);
  });

  it("omits literal union type definitions when exportTypes is false", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: { weaponType: "melee" },
      },
    ];

    const output = generate(
      records,
      "weapons",
      [{ name: "weaponType", notionType: "select" }],
      false,
    );

    assert.doesNotMatch(output, /export type/);
    assert.doesNotMatch(output, /weaponType:/);
    assert.match(output, /weaponType = "melee",/);
  });

  it("includes empty string in select union when empty_value is empty_string and value is null", () => {
    const records: LuauRecord[] = [
      {
        key: "Unset",
        keyFormat: "identifier",
        properties: { weaponType: null },
      },
      {
        key: "Melee",
        keyFormat: "identifier",
        properties: { weaponType: "melee" },
      },
    ];

    const output = generate(
      records,
      "weapons",
      [{ name: "weaponType", notionType: "select" }],
      true,
      { emptyValue: "empty_string" },
    );

    assert.match(output, /weaponType: "" \| "melee",/);
    assert.match(output, /weaponType = "",/);
  });

  it("marks select fields optional when only some records have values", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: { weaponType: "melee" },
      },
      {
        key: "Unknown",
        keyFormat: "identifier",
        properties: {},
      },
    ];

    const output = generate(records, "weapons", [
      { name: "weaponType", notionType: "select" },
    ]);

    assert.match(output, /weaponType: "melee"\?,/);
  });

  it("falls back to string when select values include non-string types", () => {
    const records: LuauRecord[] = [
      {
        key: "Bad",
        keyFormat: "identifier",
        properties: { weaponType: 42 },
      },
      {
        key: "Good",
        keyFormat: "identifier",
        properties: { weaponType: "melee" },
      },
    ];

    const output = generate(records, "weapons", [
      { name: "weaponType", notionType: "select" },
    ]);

    assert.match(output, /weaponType: string,/);
    assert.doesNotMatch(output, /weaponType: "melee"/);
  });

  it("does not include empty string when property key is missing under empty_string", () => {
    const records: LuauRecord[] = [
      {
        key: "Unknown",
        keyFormat: "identifier",
        properties: {},
      },
      {
        key: "Melee",
        keyFormat: "identifier",
        properties: { weaponType: "melee" },
      },
    ];

    const output = generate(
      records,
      "weapons",
      [{ name: "weaponType", notionType: "select" }],
      true,
      { emptyValue: "empty_string" },
    );

    assert.match(output, /weaponType: "melee"\?,/);
    assert.doesNotMatch(output, /""/);
  });

  it("falls back to { string } when multi_select values include non-string types", () => {
    const records: LuauRecord[] = [
      {
        key: "Bad",
        keyFormat: "identifier",
        properties: { tags: 42 },
      },
      {
        key: "Good",
        keyFormat: "identifier",
        properties: { tags: ["Fire", "Ice"] },
      },
    ];

    const output = generate(records, "items", [
      { name: "tags", notionType: "multi_select" },
    ]);

    assert.match(output, /tags: \{ string \},/);
    assert.doesNotMatch(output, /tags: \{ "Fire"/);
  });
});

describe("generateModuleScript relation literal unions", () => {
  it("emits select literal unions for nested_dict relation entries", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {
          Effects: {
            Fire: { element: "Fire", Power: 10 },
            Ice: { element: "Ice", Power: 5 },
          },
        },
      },
    ];

    const output = generate(records, "weapons", [
      {
        name: "Effects",
        notionType: "relation",
        relationMeta: {
          kind: "nested_dict",
          entryProperties: [
            { name: "element", notionType: "select" },
            { name: "Power", notionType: "number" },
          ],
        },
      },
    ]);

    assert.match(
      output,
      /Effects: \{ \[string\]: \{\s*element: "Fire" \| "Ice"\?,/s,
    );
    assert.match(output, /Power: number\?,/);
  });

  it("emits select literal unions for scalar_dict relation values", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {
          WeaponTypes: {
            Primary: "melee",
            Secondary: "ranged",
          },
        },
      },
    ];

    const output = generate(records, "weapons", [
      {
        name: "WeaponTypes",
        notionType: "relation",
        relationMeta: {
          kind: "scalar_dict",
          valueType: "string",
          valueNotionType: "select",
        },
      },
    ]);

    assert.match(output, /WeaponTypes: \{ \[string\]: "melee" \| "ranged" \}/);
  });

  it("emits select literal unions for scalar_array relation values", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {
          Tags: ["melee", "ranged", "melee"],
        },
      },
    ];

    const output = generate(records, "weapons", [
      {
        name: "Tags",
        notionType: "relation",
        relationMeta: {
          kind: "scalar_array",
          valueType: "string",
          valueNotionType: "select",
        },
      },
    ]);

    assert.match(output, /Tags: \{ "melee" \| "ranged" \}/);
  });

  it("emits multi_select literal unions for nested_array relation entries", () => {
    const records: LuauRecord[] = [
      {
        key: "SpellA",
        keyFormat: "identifier",
        properties: {
          Tags: [
            { labels: ["Fire"] },
            { labels: ["Ice", "Fire"] },
          ],
        },
      },
    ];

    const output = generate(records, "spells", [
      {
        name: "Tags",
        notionType: "relation",
        relationMeta: {
          kind: "nested_array",
          entryProperties: [{ name: "labels", notionType: "multi_select" }],
        },
      },
    ]);

    assert.match(output, /labels: \{ "Fire" \| "Ice" \}/);
  });
});
