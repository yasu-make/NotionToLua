import type { Client } from "@notionhq/client";
import type {
  DataSourceObjectResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";

import type { ResolvedUserConfig } from "./config.js";
import { NotionToLuaError } from "./errors.js";
import {
  convertPagePropertyToLuauValue,
  convertPropertyValue,
  extractTitleKey,
  listExportableProperties,
  resolveDataSource,
  resolveTitlePropertyName,
} from "./notion.js";
import type {
  ExportableProperty,
  LuauRecord,
  LuauTable,
  LuauValue,
} from "./types.js";
import { isLuauTable, resolveMissingValue } from "./types.js";
import {
  formatArrayRelationPropertyName,
  parseArrayRelationPropertyName,
  parseNumericRelationTitle,
  sortRelatedEntriesByNumericTitle,
} from "./relation-array.js";

type NotionClient = Pick<
  Client,
  "databases" | "dataSources" | "pages" | "blocks"
>;

type RelationPropertySchema = Extract<
  DataSourceObjectResponse["properties"][string],
  { type: "relation" }
>;

const DEFAULT_RELATION_MAX_DEPTH = 1;

export type RelationResolutionContext = {
  notion: NotionClient;
  config: ResolvedUserConfig;
  pageCache: Map<string, PageObjectResponse>;
  dataSourceCache: Map<string, DataSourceObjectResponse>;
};

function isPageObject(
  page: PageObjectResponse | { object: string },
): page is PageObjectResponse {
  return page.object === "page" && "properties" in page;
}

async function fetchPage(
  context: RelationResolutionContext,
  pageId: string,
): Promise<PageObjectResponse> {
  const cached = context.pageCache.get(pageId);
  if (cached) {
    return cached;
  }

  const page = await context.notion.pages.retrieve({ page_id: pageId });

  if (!isPageObject(page)) {
    throw new NotionToLuaError(
      `Failed to retrieve related page "${pageId}".`,
    );
  }

  context.pageCache.set(pageId, page);
  return page;
}

async function fetchDataSourceForRelation(
  context: RelationResolutionContext,
  relationSchema: RelationPropertySchema,
): Promise<DataSourceObjectResponse> {
  const dataSourceId =
    relationSchema.relation.data_source_id ??
    relationSchema.relation.database_id;

  if (!dataSourceId) {
    throw new NotionToLuaError(
      "Relation property is missing a linked data source.",
    );
  }

  const cached = context.dataSourceCache.get(dataSourceId);
  if (cached) {
    return cached;
  }

  const dataSource = await resolveDataSource(context.notion, dataSourceId);
  context.dataSourceCache.set(dataSourceId, dataSource);
  return dataSource;
}

function convertFlatProperties(
  page: PageObjectResponse,
  dataSource: DataSourceObjectResponse,
): Record<string, LuauValue> {
  const properties: Record<string, LuauValue> = {};

  for (const exportableProperty of listExportableProperties(dataSource)) {
    const notionPropertyName =
      exportableProperty.notionPropertyName ?? exportableProperty.name;
    const pageProperty = page.properties[notionPropertyName];
    const dataSourceProperty = dataSource.properties[notionPropertyName];

    const converted = convertPagePropertyToLuauValue(
      pageProperty,
      dataSourceProperty,
      exportableProperty,
    );
    if (converted === undefined) {
      continue;
    }

    properties[exportableProperty.name] = converted;
  }

  return properties;
}

function notionTypeToLuauType(notionType: string): string {
  switch (notionType) {
    case "number":
      return "number";
    case "checkbox":
      return "boolean";
    case "multi_select":
      return "{ string }";
    case "formula":
      return "string | number | boolean";
    default:
      return "string";
  }
}

function buildScalarDictMeta(
  exportableProperties: ExportableProperty[],
): ExportableProperty["relationMeta"] {
  const property = exportableProperties[0];
  return {
    kind: "scalar_dict",
    valueType: notionTypeToLuauType(property?.notionType ?? "string"),
    valueNotionType: property?.notionType,
  };
}

function buildNestedDictMeta(
  exportableProperties: ExportableProperty[],
): ExportableProperty["relationMeta"] {
  return {
    kind: "nested_dict",
    entryProperties: exportableProperties,
  };
}

function buildRelatedRecordTable(
  page: PageObjectResponse,
  dataSource: DataSourceObjectResponse,
  emptyValue: ResolvedUserConfig["emptyValue"],
): LuauTable {
  const table: LuauTable = {};

  for (const exportableProperty of listExportableProperties(dataSource)) {
    const notionPropertyName =
      exportableProperty.notionPropertyName ?? exportableProperty.name;
    const dataSourceProperty = dataSource.properties[notionPropertyName];
    if (!dataSourceProperty) {
      continue;
    }

    const pageProperty = page.properties[notionPropertyName];
    const converted = convertPagePropertyToLuauValue(
      pageProperty,
      dataSourceProperty,
      exportableProperty,
    );
    if (converted === undefined) {
      continue;
    }

    if (converted === null) {
      const resolved = resolveMissingValue(emptyValue, dataSourceProperty.type);
      if (resolved === "omit") {
        continue;
      }

      table[exportableProperty.name] = resolved;
      continue;
    }

    table[exportableProperty.name] = converted;
  }

  return table;
}

function buildScalarArrayMeta(
  exportableProperties: ExportableProperty[],
): ExportableProperty["relationMeta"] {
  const property = exportableProperties[0];
  return {
    kind: "scalar_array",
    valueType: notionTypeToLuauType(property?.notionType ?? "string"),
    valueNotionType: property?.notionType,
  };
}

function buildNestedArrayMeta(
  exportableProperties: ExportableProperty[],
): ExportableProperty["relationMeta"] {
  return {
    kind: "nested_array",
    entryProperties: exportableProperties,
  };
}

async function embedRelationArray(
  context: RelationResolutionContext,
  relationPropertyName: string,
  relationSchema: RelationPropertySchema,
  relatedPageIds: string[],
  visitingPageIds: Set<string>,
  depth: number,
): Promise<{ value: LuauValue[]; meta: ExportableProperty["relationMeta"] }> {
  if (depth > DEFAULT_RELATION_MAX_DEPTH) {
    throw new NotionToLuaError(
      `Relation property "${relationPropertyName}" exceeds max depth (${DEFAULT_RELATION_MAX_DEPTH}).`,
    );
  }

  if (relatedPageIds.length === 0) {
    return {
      value: [],
      meta: { kind: "scalar_array", valueType: "string" },
    };
  }

  const relatedDataSource = await fetchDataSourceForRelation(
    context,
    relationSchema,
  );
  const relatedTitleProperty = resolveTitlePropertyName(relatedDataSource);
  const relatedExportableProperties = listExportableProperties(relatedDataSource);
  const relatedExportableNames = relatedExportableProperties.map(
    (property) => property.name,
  );
  const { emptyValue } = context.config;

  const entries: Array<{ sortKey: number; title: string; value: LuauValue }> =
    [];
  const seenSortKeys = new Map<number, number>();

  for (const relatedPageId of relatedPageIds) {
    if (visitingPageIds.has(relatedPageId)) {
      throw new NotionToLuaError(
        `Circular relation detected while embedding "${relationPropertyName}".`,
      );
    }

    visitingPageIds.add(relatedPageId);
    const relatedPage = await fetchPage(context, relatedPageId);
    const relatedTitle = extractTitleKey(relatedPage, relatedTitleProperty);
    const sortKey = parseNumericRelationTitle(relatedTitle);
    const duplicateCount = (seenSortKeys.get(sortKey) ?? 0) + 1;
    seenSortKeys.set(sortKey, duplicateCount);

    if (duplicateCount > 1) {
      throw new NotionToLuaError(
        `Duplicate related title "${relatedTitle}" in relation property "${relationPropertyName}".`,
      );
    }

    let value: LuauValue;

    if (relatedExportableNames.length === 1) {
      const solePropertyName = relatedExportableNames[0];
      const soleProperty = relatedExportableProperties[0];
      const soleValue = convertFlatProperties(relatedPage, relatedDataSource)[
        solePropertyName
      ] ?? null;

      if (soleValue === null) {
        const resolved = resolveMissingValue(
          emptyValue,
          soleProperty?.notionType ?? "string",
        );
        if (resolved === "omit") {
          visitingPageIds.delete(relatedPageId);
          continue;
        }

        value = resolved;
      } else {
        value = soleValue;
      }
    } else if (relatedExportableNames.length === 0) {
      value = {};
    } else {
      value = buildRelatedRecordTable(
        relatedPage,
        relatedDataSource,
        emptyValue,
      );
    }

    entries.push({ sortKey, title: relatedTitle, value });
    visitingPageIds.delete(relatedPageId);
  }

  const meta =
    relatedExportableNames.length === 1
      ? buildScalarArrayMeta(relatedExportableProperties)
      : buildNestedArrayMeta(relatedExportableProperties);

  return {
    value: sortRelatedEntriesByNumericTitle(entries).map((entry) => entry.value),
    meta,
  };
}

function applyEmptyRelationArray(
  values: LuauValue[],
  emptyRelation: ResolvedUserConfig["emptyRelation"],
): LuauValue | undefined {
  if (values.length === 0) {
    if (emptyRelation === "empty_table") {
      return [];
    }

    return undefined;
  }

  return values;
}

async function embedRelationDictionary(
  context: RelationResolutionContext,
  relationPropertyName: string,
  relationSchema: RelationPropertySchema,
  relatedPageIds: string[],
  visitingPageIds: Set<string>,
  depth: number,
): Promise<{ value: LuauTable; meta: ExportableProperty["relationMeta"] }> {
  if (depth > DEFAULT_RELATION_MAX_DEPTH) {
    throw new NotionToLuaError(
      `Relation property "${relationPropertyName}" exceeds max depth (${DEFAULT_RELATION_MAX_DEPTH}).`,
    );
  }

  if (relatedPageIds.length === 0) {
    return {
      value: {},
      meta: { kind: "scalar_dict", valueType: "string" },
    };
  }

  const relatedDataSource = await fetchDataSourceForRelation(
    context,
    relationSchema,
  );
  const relatedTitleProperty = resolveTitlePropertyName(relatedDataSource);
  const relatedExportableProperties = listExportableProperties(relatedDataSource);
  const relatedExportableNames = relatedExportableProperties.map(
    (property) => property.name,
  );
  const { emptyValue } = context.config;

  const dictionary: LuauTable = {};
  const seenKeys = new Map<string, number>();

  for (const relatedPageId of relatedPageIds) {
    if (visitingPageIds.has(relatedPageId)) {
      throw new NotionToLuaError(
        `Circular relation detected while embedding "${relationPropertyName}".`,
      );
    }

    visitingPageIds.add(relatedPageId);
    const relatedPage = await fetchPage(context, relatedPageId);
    const relatedKey = extractTitleKey(relatedPage, relatedTitleProperty);
    const duplicateCount = (seenKeys.get(relatedKey) ?? 0) + 1;
    seenKeys.set(relatedKey, duplicateCount);

    if (duplicateCount > 1) {
      throw new NotionToLuaError(
        `Duplicate related title "${relatedKey}" in relation property "${relationPropertyName}".`,
      );
    }

    if (relatedExportableNames.length === 1) {
      const solePropertyName = relatedExportableNames[0];
      const soleProperty = relatedExportableProperties[0];
      const soleValue = convertFlatProperties(relatedPage, relatedDataSource)[
        solePropertyName
      ] ?? null;

      if (soleValue === null) {
        const resolved = resolveMissingValue(
          emptyValue,
          soleProperty?.notionType ?? "string",
        );
        if (resolved === "omit") {
          visitingPageIds.delete(relatedPageId);
          continue;
        }

        dictionary[relatedKey] = resolved;
      } else {
        dictionary[relatedKey] = soleValue;
      }
    } else if (relatedExportableNames.length === 0) {
      dictionary[relatedKey] = {};
    } else {
      dictionary[relatedKey] = buildRelatedRecordTable(
        relatedPage,
        relatedDataSource,
        emptyValue,
      );
    }

    visitingPageIds.delete(relatedPageId);
  }

  const meta =
    relatedExportableNames.length === 1
      ? buildScalarDictMeta(relatedExportableProperties)
      : buildNestedDictMeta(relatedExportableProperties);

  return { value: dictionary, meta };
}

function applyEmptyRelation(
  dictionary: LuauTable,
  emptyRelation: ResolvedUserConfig["emptyRelation"],
): LuauValue | undefined {
  if (Object.keys(dictionary).length === 0) {
    if (emptyRelation === "empty_table") {
      return {};
    }

    return undefined;
  }

  return dictionary;
}

export async function resolveEmbeddedRelationsForRecords(
  context: RelationResolutionContext,
  records: LuauRecord[],
  pages: PageObjectResponse[],
  dataSource: DataSourceObjectResponse,
): Promise<ExportableProperty[]> {
  const titlePropertyName = resolveTitlePropertyName(dataSource);
  const relationPropertyNames = Object.entries(dataSource.properties)
    .filter(([propertyName, property]) => {
      if (propertyName === titlePropertyName) {
        return false;
      }

      return property.type === "relation";
    })
    .map(([propertyName]) => propertyName);

  const relationMetaByProperty = new Map<
    string,
    ExportableProperty["relationMeta"]
  >();

  if (relationPropertyNames.length === 0) {
    return listExportableProperties(dataSource);
  }

  const pagesByKey = new Map(
    pages.map((page) => [extractTitleKey(page, titlePropertyName), page]),
  );

  for (const record of records) {
    const page = pagesByKey.get(record.key);

    if (!page) {
      continue;
    }

    for (const relationPropertyName of relationPropertyNames) {
      const schemaProperty = dataSource.properties[relationPropertyName];

      if (!schemaProperty || schemaProperty.type !== "relation") {
        continue;
      }

      const pageProperty = page.properties[relationPropertyName];
      if (!pageProperty || pageProperty.type !== "relation") {
        continue;
      }

      const relatedPageIds = pageProperty.relation.map((item) => item.id);
      const visitingPageIds = new Set<string>([page.id]);
      const arrayRelation = parseArrayRelationPropertyName(relationPropertyName);
      const propertyKey = arrayRelation?.baseName ?? relationPropertyName;

      if (arrayRelation) {
        const { value: arrayValue, meta } = await embedRelationArray(
          context,
          relationPropertyName,
          schemaProperty,
          relatedPageIds,
          visitingPageIds,
          1,
        );

        relationMetaByProperty.set(propertyKey, meta);

        const resolvedValue = applyEmptyRelationArray(
          arrayValue,
          context.config.emptyRelation,
        );

        if (resolvedValue === undefined) {
          delete record.properties[propertyKey];
        } else {
          record.properties[propertyKey] = resolvedValue;
        }

        continue;
      }

      const { value: dictionary, meta } = await embedRelationDictionary(
        context,
        relationPropertyName,
        schemaProperty,
        relatedPageIds,
        visitingPageIds,
        1,
      );

      relationMetaByProperty.set(propertyKey, meta);

      const resolvedValue = applyEmptyRelation(
        dictionary,
        context.config.emptyRelation,
      );

      if (resolvedValue === undefined) {
        delete record.properties[propertyKey];
      } else {
        record.properties[propertyKey] = resolvedValue;
      }
    }
  }

  const baseProperties = listExportableProperties(dataSource);

  return [
    ...baseProperties,
    ...relationPropertyNames.map((propertyName) => {
      const arrayRelation = parseArrayRelationPropertyName(propertyName);
      const name = arrayRelation?.baseName ?? propertyName;

      return {
        name,
        notionType: "relation",
        notionPropertyName: arrayRelation
          ? formatArrayRelationPropertyName(name)
          : propertyName,
        relationMeta: relationMetaByProperty.get(name),
      };
    }),
  ];
}

export function createRelationResolutionContext(
  notion: NotionClient,
  config: ResolvedUserConfig,
  pages: PageObjectResponse[],
): RelationResolutionContext {
  const pageCache = new Map<string, PageObjectResponse>();

  for (const page of pages) {
    pageCache.set(page.id, page);
  }

  return {
    notion,
    config,
    pageCache,
    dataSourceCache: new Map(),
  };
}
