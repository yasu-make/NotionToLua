import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  DataSourceObjectResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";

import { NotionToLuaError } from "../src/errors.js";
import { formatLuauValue } from "../src/formatter.js";
import { generateModuleScript } from "../src/generator.js";
import {
  createRelationResolutionContext,
  resolveEmbeddedRelationsForRecords,
} from "../src/relation.js";
import type { LuauRecord } from "../src/types.js";

const DEFAULT_TITLE_PROPERTY = "Name";

function createRichText(text: string) {
  return [
    {
      type: "text" as const,
      text: { content: text, link: null },
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default" as const,
      },
      plain_text: text,
      href: null,
    },
  ];
}

function createPage(
  id: string,
  name: string,
  properties: PageObjectResponse["properties"] = {},
  titleProperty = DEFAULT_TITLE_PROPERTY,
): PageObjectResponse {
  return {
    object: "page",
    id,
    created_time: "2024-01-01T00:00:00.000Z",
    last_edited_time: "2024-01-01T00:00:00.000Z",
    created_by: { object: "user", id: "user-id" },
    last_edited_by: { object: "user", id: "user-id" },
    cover: null,
    icon: null,
    parent: { type: "database_id", database_id: "database-id" },
    archived: false,
    in_trash: false,
    is_locked: false,
    properties: {
      [titleProperty]: {
        id: "title-id",
        type: "title",
        title: createRichText(name),
      },
      ...properties,
    },
    url: `https://www.notion.so/${id}`,
    public_url: null,
  };
}

function createDataSource(
  id: string,
  properties: DataSourceObjectResponse["properties"],
  titleProperty = DEFAULT_TITLE_PROPERTY,
): DataSourceObjectResponse {
  return {
    object: "data_source",
    id,
    cover: null,
    icon: null,
    created_time: "2024-01-01T00:00:00.000Z",
    created_by: { object: "user", id: "user-id" },
    last_edited_by: { object: "user", id: "user-id" },
    title: createRichText("Test DB"),
    description: [],
    is_inline: false,
    properties: {
      [titleProperty]: {
        id: "title-id",
        name: titleProperty,
        type: "title",
        title: {},
        description: null,
      },
      ...properties,
    },
    parent: { type: "database_id", database_id: "database-id" },
    database_parent: { type: "page_id", page_id: "parent-page-id" },
    url: `https://www.notion.so/${id}`,
    public_url: null,
    archived: false,
    in_trash: false,
  };
}

describe("formatLuauValue nested tables", () => {
  it("formats scalar dictionaries", () => {
    const output = formatLuauValue({
      Fire: 10,
      Ice: 5,
    });

    assert.match(output, /Fire = 10,/);
    assert.match(output, /Ice = 5,/);
  });

  it("formats nested dictionaries", () => {
    const output = formatLuauValue({
      Fire: {
        Power: 10,
        Duration: 3,
      },
    });

    assert.match(output, /Fire = \{/);
    assert.match(output, /Power = 10,/);
    assert.match(output, /Duration = 3,/);
  });

  it("formats sequence arrays", () => {
    const output = formatLuauValue([
      { Damage: 10 },
      { Damage: 20 },
    ]);

    assert.match(output, /Damage = 10,/);
    assert.match(output, /Damage = 20,/);
  });

  it("includes nil keys when requested", () => {
    const output = formatLuauValue({ Fire: null }, true);
    assert.match(output, /Fire = nil,/);
  });
});

describe("resolveEmbeddedRelationsForRecords", () => {
  it("embeds scalar relation dictionaries", async () => {
    const effectsDataSource = createDataSource("effects-ds", {
      Power: {
        id: "power",
        name: "Power",
        type: "number",
        number: { format: "number" },
        description: null,
      },
    });

    const weaponsDataSource = createDataSource("weapons-ds", {
      Damage: {
        id: "damage",
        name: "Damage",
        type: "number",
        number: { format: "number" },
        description: null,
      },
      Effects: {
        id: "effects",
        name: "Effects",
        type: "relation",
        relation: {
          database_id: "effects-db",
          data_source_id: "effects-ds",
        },
        description: null,
      },
    });

    const firePage = createPage("fire-page", "Fire", {
      Power: { id: "power", type: "number", number: 10 },
    });
    const icePage = createPage("ice-page", "Ice", {
      Power: { id: "power", type: "number", number: 5 },
    });
    const swordPage = createPage("sword-page", "Sword", {
      Damage: { id: "damage", type: "number", number: 12 },
      Effects: {
        id: "effects",
        type: "relation",
        relation: [
          { id: "fire-page" },
          { id: "ice-page" },
        ],
        has_more: false,
      },
    });

    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: { Damage: 12 },
      },
    ];

    const notion = {
      databases: {
        retrieve: async () => ({
          data_sources: [{ id: "effects-ds" }],
        }),
      },
      dataSources: {
        retrieve: async ({ data_source_id }: { data_source_id: string }) => {
          if (data_source_id === "effects-ds") {
            return effectsDataSource;
          }

          return weaponsDataSource;
        },
      },
      pages: {
        retrieve: async ({ page_id }: { page_id: string }) => {
          if (page_id === "fire-page") {
            return firePage;
          }

          if (page_id === "ice-page") {
            return icePage;
          }

          return swordPage;
        },
      },
    };

    const context = createRelationResolutionContext(
      notion as never,
      {
        format: true,
        exportTypes: true,
        emptyValue: "omit",
        emptyRelation: "omit",
        relationDepth: 1,
      },
      [swordPage],
    );

    const properties = await resolveEmbeddedRelationsForRecords(
      context,
      records,
      [swordPage],
      weaponsDataSource,
    );

    assert.deepEqual(records[0]?.properties.Effects, {
      Fire: 10,
      Ice: 5,
    });

    const effectsProperty = properties.find(
      (property) => property.name === "Effects",
    );
    assert.equal(effectsProperty?.relationMeta?.kind, "scalar_dict");
    assert.equal(
      effectsProperty?.relationMeta?.kind === "scalar_dict"
        ? effectsProperty.relationMeta.valueType
        : undefined,
      "number",
    );
  });

  it("embeds array relations sorted by numeric titles", async () => {
    const itemDataSource = createDataSource("items-ds", {
      Damage: {
        id: "damage",
        name: "Damage",
        type: "number",
        number: { format: "number" },
        description: null,
      },
    });

    const weaponsDataSource = createDataSource("weapons-ds", {
      "Items [Array]": {
        id: "items",
        name: "Items [Array]",
        type: "relation",
        relation: {
          database_id: "items-db",
          data_source_id: "items-ds",
        },
        description: null,
      },
    });

    const itemTwo = createPage("item-2", "2", {
      Damage: { id: "damage", type: "number", number: 20 },
    });
    const itemTen = createPage("item-10", "10", {
      Damage: { id: "damage", type: "number", number: 100 },
    });
    const swordPage = createPage("sword-page", "Sword", {
      "Items [Array]": {
        id: "items",
        type: "relation",
        relation: [{ id: "item-10" }, { id: "item-2" }],
        has_more: false,
      },
    });

    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {},
      },
    ];

    const notion = {
      databases: {
        retrieve: async () => ({
          data_sources: [{ id: "items-ds" }],
        }),
      },
      dataSources: {
        retrieve: async ({ data_source_id }: { data_source_id: string }) => {
          if (data_source_id === "items-ds") {
            return itemDataSource;
          }

          return weaponsDataSource;
        },
      },
      pages: {
        retrieve: async ({ page_id }: { page_id: string }) => {
          if (page_id === "item-2") {
            return itemTwo;
          }

          if (page_id === "item-10") {
            return itemTen;
          }

          return swordPage;
        },
      },
    };

    const context = createRelationResolutionContext(
      notion as never,
      {
        format: true,
        exportTypes: true,
        emptyValue: "omit",
        emptyRelation: "omit",
        relationDepth: 1,
      },
      [swordPage],
    );

    const properties = await resolveEmbeddedRelationsForRecords(
      context,
      records,
      [swordPage],
      weaponsDataSource,
    );

    assert.deepEqual(records[0]?.properties.Items, [20, 100]);

    const itemsProperty = properties.find((property) => property.name === "Items");
    assert.equal(itemsProperty?.notionPropertyName, "Items [Array]");
    assert.equal(itemsProperty?.relationMeta?.kind, "scalar_array");
  });

  it("omits empty relations by default", async () => {
    const weaponsDataSource = createDataSource("weapons-ds", {
      Effects: {
        id: "effects",
        name: "Effects",
        type: "relation",
        relation: {
          database_id: "effects-db",
          data_source_id: "effects-ds",
        },
        description: null,
      },
    });

    const swordPage = createPage("sword-page", "Sword", {
      Effects: {
        id: "effects",
        type: "relation",
        relation: [],
        has_more: false,
      },
    });

    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {},
      },
    ];

    const context = createRelationResolutionContext(
      {
        databases: { retrieve: async () => ({ data_sources: [{ id: "effects-ds" }] }) },
        dataSources: { retrieve: async () => createDataSource("effects-ds", {}) },
        pages: { retrieve: async () => swordPage },
      } as never,
      {
        format: true,
        exportTypes: true,
        emptyValue: "omit",
        emptyRelation: "omit",
        relationDepth: 1,
      },
      [swordPage],
    );

    await resolveEmbeddedRelationsForRecords(
      context,
      records,
      [swordPage],
      weaponsDataSource,
    );

    assert.equal("Effects" in (records[0]?.properties ?? {}), false);
  });

  it("outputs empty tables when empty_relation is empty_table", async () => {
    const weaponsDataSource = createDataSource("weapons-ds", {
      Effects: {
        id: "effects",
        name: "Effects",
        type: "relation",
        relation: {
          database_id: "effects-db",
          data_source_id: "effects-ds",
        },
        description: null,
      },
    });

    const swordPage = createPage("sword-page", "Sword", {
      Effects: {
        id: "effects",
        type: "relation",
        relation: [],
        has_more: false,
      },
    });

    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {},
      },
    ];

    const context = createRelationResolutionContext(
      {
        databases: { retrieve: async () => ({ data_sources: [{ id: "effects-ds" }] }) },
        dataSources: { retrieve: async () => createDataSource("effects-ds", {}) },
        pages: { retrieve: async () => swordPage },
      } as never,
      {
        format: true,
        exportTypes: true,
        emptyValue: "omit",
        emptyRelation: "empty_table",
        relationDepth: 1,
      },
      [swordPage],
    );

    await resolveEmbeddedRelationsForRecords(
      context,
      records,
      [swordPage],
      weaponsDataSource,
    );

    assert.deepEqual(records[0]?.properties.Effects, {});
  });

  it("throws on circular relations", async () => {
    const effectsDataSource = createDataSource("effects-ds", {
      Power: {
        id: "power",
        name: "Power",
        type: "number",
        number: { format: "number" },
        description: null,
      },
    });

    const dataSource = createDataSource("weapons-ds", {
      Effects: {
        id: "effects",
        name: "Effects",
        type: "relation",
        relation: {
          database_id: "effects-db",
          data_source_id: "effects-ds",
        },
        description: null,
      },
    });

    const page = createPage("page-a", "Sword", {
      Effects: {
        id: "effects",
        type: "relation",
        relation: [{ id: "page-a" }],
        has_more: false,
      },
    });

    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {},
      },
    ];

    const context = createRelationResolutionContext(
      {
        databases: {
          retrieve: async () => ({
            data_sources: [{ id: "effects-ds" }],
          }),
        },
        dataSources: {
          retrieve: async () => effectsDataSource,
        },
        pages: { retrieve: async () => page },
      } as never,
      {
        format: true,
        exportTypes: true,
        emptyValue: "omit",
        emptyRelation: "omit",
        relationDepth: 1,
      },
      [page],
    );

    await assert.rejects(
      () =>
        resolveEmbeddedRelationsForRecords(
          context,
          records,
          [page],
          dataSource,
        ),
      (error: unknown) => {
        assert.ok(error instanceof NotionToLuaError);
        assert.match(error.message, /Circular relation detected/);
        return true;
      },
    );
  });
});

describe("generateModuleScript relation types", () => {
  it("emits scalar dictionary types for embedded relations", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {
          Damage: 12,
          Effects: {
            Fire: 10,
            Ice: 5,
          },
        },
      },
    ];

    const output = generateModuleScript(records, {
      moduleName: "Weapons",
      properties: [
        { name: "Damage", notionType: "number" },
        {
          name: "Effects",
          notionType: "relation",
          relationMeta: { kind: "scalar_dict", valueType: "number" },
        },
      ],
      exportTypes: true,
    });

    assert.match(output, /Effects: \{ \[string\]: number \}/);
    assert.match(output, /Fire = 10,/);
    assert.match(output, /Ice = 5,/);
  });

  it("emits nil values when empty_value is nil", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {
          Damage: 12,
          Notes: null,
        },
      },
    ];

    const output = generateModuleScript(records, {
      moduleName: "Weapons",
      properties: [
        { name: "Damage", notionType: "number" },
        { name: "Notes", notionType: "rich_text" },
      ],
      exportTypes: true,
      outputOptions: {
        emptyValue: "nil",
        emptyRelation: "omit",
      },
    });

    assert.match(output, /Notes = nil,/);
  });

  it("emits empty strings for string-like properties when empty_value is empty_string", () => {
    const records: LuauRecord[] = [
      {
        key: "Sword",
        keyFormat: "identifier",
        properties: {
          Notes: null,
          Power: null,
        },
      },
    ];

    const output = generateModuleScript(records, {
      moduleName: "Weapons",
      properties: [
        { name: "Notes", notionType: "rich_text" },
        { name: "Power", notionType: "number" },
      ],
      exportTypes: true,
      outputOptions: {
        emptyValue: "empty_string",
        emptyRelation: "omit",
      },
    });

    assert.match(output, /Notes = "",/);
    assert.doesNotMatch(output, /Power =/);
  });
});

function numberProperty(name: string) {
  return {
    id: name,
    name,
    type: "number" as const,
    number: { format: "number" as const },
    description: null,
  };
}

function relationProperty(name: string, dataSourceId: string) {
  return {
    id: name,
    name,
    type: "relation" as const,
    relation: {
      database_id: `${dataSourceId}-db`,
      data_source_id: dataSourceId,
      type: "single_property" as const,
      single_property: {},
    },
    description: null,
  };
}

function relationValue(name: string, pageIds: string[]) {
  return {
    id: name,
    type: "relation" as const,
    relation: pageIds.map((id) => ({ id })),
    has_more: false,
  };
}

function numberValue(name: string, value: number) {
  return { id: name, type: "number" as const, number: value };
}

function createNotionMock(
  dataSources: DataSourceObjectResponse[],
  pages: PageObjectResponse[],
) {
  return {
    databases: {
      retrieve: async ({ database_id }: { database_id: string }) => ({
        data_sources: [{ id: database_id }],
      }),
    },
    dataSources: {
      retrieve: async ({ data_source_id }: { data_source_id: string }) => {
        const dataSource = dataSources.find((item) => item.id === data_source_id);
        assert.ok(dataSource, `unexpected data source ${data_source_id}`);
        return dataSource;
      },
    },
    pages: {
      retrieve: async ({ page_id }: { page_id: string }) => {
        const page = pages.find((item) => item.id === page_id);
        assert.ok(page, `unexpected page ${page_id}`);
        return page;
      },
    },
  } as never;
}

async function resolveWeapons(
  weaponsDataSource: DataSourceObjectResponse,
  weaponPages: PageObjectResponse[],
  relatedDataSources: DataSourceObjectResponse[],
  relatedPages: PageObjectResponse[],
  relationDepth: number,
) {
  const records: LuauRecord[] = weaponPages.map((page) => ({
    key: page.properties.Name?.type === "title"
      ? page.properties.Name.title[0]!.plain_text
      : "",
    keyFormat: "identifier",
    properties: {},
  }));
  const context = createRelationResolutionContext(
    createNotionMock(relatedDataSources, [...weaponPages, ...relatedPages]),
    {
      namedTargets: {},
      format: true,
      exportTypes: true,
      emptyValue: "omit",
      emptyRelation: "omit",
      omitArrayIndex: false,
      relationDepth,
    },
    weaponPages,
  );
  const properties = await resolveEmbeddedRelationsForRecords(
    context,
    records,
    weaponPages,
    weaponsDataSource,
  );

  return { records, properties };
}

describe("nested relations (relation_depth)", () => {
  // Weapons -> Effects (Power, Element) -> Elements (Damage)
  const elementsDataSource = createDataSource("elements-ds", {
    Damage: numberProperty("Damage"),
  });
  const effectsDataSource = createDataSource("effects-ds", {
    Power: numberProperty("Power"),
    Element: relationProperty("Element", "elements-ds"),
  });
  const weaponsDataSource = createDataSource("weapons-ds", {
    Effects: relationProperty("Effects", "effects-ds"),
  });
  const heatPage = createPage("heat-page", "Heat", {
    Damage: numberValue("Damage", 3),
  });
  const firePage = createPage("fire-page", "Fire", {
    Power: numberValue("Power", 10),
    Element: relationValue("Element", ["heat-page"]),
  });
  const swordPage = createPage("sword-page", "Sword", {
    Effects: relationValue("Effects", ["fire-page"]),
  });

  it("ignores relation columns of related databases at the default depth", async () => {
    const { records } = await resolveWeapons(
      weaponsDataSource,
      [swordPage],
      [effectsDataSource, elementsDataSource],
      [firePage, heatPage],
      1,
    );

    assert.deepEqual(records[0]?.properties.Effects, { Fire: 10 });
  });

  it("embeds two levels of relations when relation_depth is 2", async () => {
    const { records, properties } = await resolveWeapons(
      weaponsDataSource,
      [swordPage],
      [effectsDataSource, elementsDataSource],
      [firePage, heatPage],
      2,
    );

    assert.deepEqual(records[0]?.properties.Effects, {
      Fire: { Power: 10, Element: { Heat: 3 } },
    });

    const output = generateModuleScript(records, {
      moduleName: "Weapons",
      properties,
      exportTypes: true,
    });

    assert.match(output, /Element: \{ \[string\]: number \}\?,/);
    assert.match(output, /Power: number\?,/);
    assert.match(output, /Element = \{\s*Heat = 3,\s*\}/);
  });

  it("embeds three levels through array relations", async () => {
    const stagesDataSource = createDataSource("stages-ds", {
      Scale: numberProperty("Scale"),
    });
    const tiersDataSource = createDataSource("tiers-ds", {
      "Stages [Array]": relationProperty("Stages [Array]", "stages-ds"),
    });
    const itemsDataSource = createDataSource("items-ds", {
      Tiers: relationProperty("Tiers", "tiers-ds"),
    });
    const stageOne = createPage("stage-1", "1", {
      Scale: numberValue("Scale", 1.5),
    });
    const stageTwo = createPage("stage-2", "2", {
      Scale: numberValue("Scale", 2),
    });
    const goldTier = createPage("gold-tier", "Gold", {
      "Stages [Array]": relationValue("Stages [Array]", ["stage-2", "stage-1"]),
    });
    const crownPage = createPage("crown-page", "Crown", {
      Tiers: relationValue("Tiers", ["gold-tier"]),
    });

    const { records, properties } = await resolveWeapons(
      itemsDataSource,
      [crownPage],
      [tiersDataSource, stagesDataSource],
      [goldTier, stageOne, stageTwo],
      3,
    );

    assert.deepEqual(records[0]?.properties.Tiers, { Gold: [1.5, 2] });

    const output = generateModuleScript(records, {
      moduleName: "Items",
      properties,
      exportTypes: true,
    });

    assert.match(output, /Tiers: \{ \[string\]: \{ number \} \}/);
  });

  it("reports back-references as circular relations", async () => {
    const backEffects = createDataSource("effects-ds", {
      Power: numberProperty("Power"),
      Weapons: relationProperty("Weapons", "weapons-ds"),
    });
    const fire = createPage("fire-page", "Fire", {
      Power: numberValue("Power", 10),
      Weapons: relationValue("Weapons", ["sword-page"]),
    });

    await assert.rejects(
      () =>
        resolveWeapons(
          weaponsDataSource,
          [swordPage],
          [backEffects, weaponsDataSource],
          [fire],
          2,
        ),
      /Circular relation detected while embedding "Weapons"/,
    );
  });

  it("does not embed [Skip] relation columns at any level", async () => {
    const skippedEffects = createDataSource("effects-ds", {
      Power: numberProperty("Power"),
      "[Skip] Weapons": relationProperty("[Skip] Weapons", "weapons-ds"),
    });
    const fire = createPage("fire-page", "Fire", {
      Power: numberValue("Power", 10),
      "[Skip] Weapons": relationValue("[Skip] Weapons", ["sword-page"]),
    });
    const weapons = createDataSource("weapons-ds", {
      Effects: relationProperty("Effects", "effects-ds"),
      "[Skip] Notes": relationProperty("[Skip] Notes", "effects-ds"),
    });
    const sword = createPage("sword-page", "Sword", {
      Effects: relationValue("Effects", ["fire-page"]),
      "[Skip] Notes": relationValue("[Skip] Notes", ["fire-page"]),
    });

    const { records, properties } = await resolveWeapons(
      weapons,
      [sword],
      [skippedEffects, weapons],
      [fire],
      2,
    );

    assert.deepEqual(records[0]?.properties, { Effects: { Fire: 10 } });
    assert.deepEqual(
      properties.map((property) => property.name),
      ["Effects"],
    );
  });
});
