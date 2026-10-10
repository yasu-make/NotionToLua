import type { Client } from "@notionhq/client";
import type {
  DataSourceObjectResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints.js";

import type { ResolvedUserConfig } from "./config.js";
import { NotionToLuaError } from "./errors.js";
import {
  convertPagePropertyToLuauValue,
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
  RelationPropertyMeta,
} from "./types.js";
import { isSkippedPropertyName, resolveMissingValue } from "./types.js";
import {
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

type RelationColumn = {
  name: string;
  notionPropertyName: string;
  schema: RelationPropertySchema;
  isArray: boolean;
};

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

function toRelationColumn(
  propertyName: string,
  schema: RelationPropertySchema,
): RelationColumn {
  const arrayRelation = parseArrayRelationPropertyName(propertyName);
  return {
    name: arrayRelation?.baseName ?? propertyName,
    notionPropertyName: propertyName,
    schema,
    isArray: arrayRelation !== null,
  };
}

function listRelationColumns(
  dataSource: DataSourceObjectResponse,
): RelationColumn[] {
  const titlePropertyName = resolveTitlePropertyName(dataSource);
  const columns: RelationColumn[] = [];

  for (const [propertyName, property] of Object.entries(dataSource.properties)) {
    if (
      propertyName === titlePropertyName ||
      isSkippedPropertyName(propertyName) ||
      property.type !== "relation"
    ) {
      continue;
    }

    columns.push(toRelationColumn(propertyName, property));
  }

  return columns;
}

/**
 * Exportable properties of a data source, including Relation columns while
 * `remainingDepth` allows embedding one more level.
 */
async function describeEntryProperties(
  context: RelationResolutionContext,
  dataSource: DataSourceObjectResponse,
  remainingDepth: number,
): Promise<ExportableProperty[]> {
  const properties = listExportableProperties(dataSource);

  if (remainingDepth < 1) {
    return properties;
  }

  for (const column of listRelationColumns(dataSource)) {
    properties.push({
      name: column.name,
      notionType: "relation",
      notionPropertyName: column.notionPropertyName,
      relationMeta: await describeRelation(context, column, remainingDepth),
    });
  }

  return properties;
}

async function describeRelation(
  context: RelationResolutionContext,
  column: RelationColumn,
  remainingDepth: number,
): Promise<RelationPropertyMeta> {
  const relatedDataSource = await fetchDataSourceForRelation(
    context,
    column.schema,
  );
  const entryProperties = await describeEntryProperties(
    context,
    relatedDataSource,
    remainingDepth - 1,
  );

  if (entryProperties.length === 1) {
    const valueProperty = entryProperties[0]!;
    return {
      kind: column.isArray ? "scalar_array" : "scalar_dict",
      valueType: notionTypeToLuauType(valueProperty.notionType),
      valueNotionType: valueProperty.notionType,
      valueProperty,
    };
  }

  return {
    kind: column.isArray ? "nested_array" : "nested_dict",
    entryProperties,
  };
}

function entryPropertiesOf(meta: RelationPropertyMeta): ExportableProperty[] {
  if (meta.kind === "scalar_dict" || meta.kind === "scalar_array") {
    return meta.valueProperty ? [meta.valueProperty] : [];
  }

  return meta.entryProperties;
}

async function buildRelatedRecordTable(
  context: RelationResolutionContext,
  page: PageObjectResponse,
  dataSource: DataSourceObjectResponse,
  entryProperties: ExportableProperty[],
  visitingPageIds: Set<string>,
): Promise<LuauTable> {
  const table: LuauTable = {};

  for (const entryProperty of entryProperties) {
    const notionPropertyName =
      entryProperty.notionPropertyName ?? entryProperty.name;
    const dataSourceProperty = dataSource.properties[notionPropertyName];
    if (!dataSourceProperty) {
      continue;
    }

    const pageProperty = page.properties[notionPropertyName];

    if (entryProperty.relationMeta && dataSourceProperty.type === "relation") {
      if (pageProperty?.type !== "relation") {
        continue;
      }

      const embedded = await embedRelation(
        context,
        toRelationColumn(notionPropertyName, dataSourceProperty),
        entryProperty.relationMeta,
        pageProperty.relation.map((item) => item.id),
        visitingPageIds,
      );
      if (embedded !== undefined) {
        table[entryProperty.name] = embedded;
      }
      continue;
    }

    const converted = convertPagePropertyToLuauValue(
      pageProperty,
      dataSourceProperty,
      entryProperty,
    );
    if (converted === undefined) {
      continue;
    }

    if (converted === null) {
      const resolved = resolveMissingValue(
        context.config.emptyValue,
        dataSourceProperty.type,
      );
      if (resolved === "omit") {
        continue;
      }

      table[entryProperty.name] = resolved;
      continue;
    }

    table[entryProperty.name] = converted;
  }

  return table;
}

async function buildRelatedEntryValue(
  context: RelationResolutionContext,
  page: PageObjectResponse,
  dataSource: DataSourceObjectResponse,
  meta: RelationPropertyMeta,
  visitingPageIds: Set<string>,
): Promise<LuauValue | "omit"> {
  const entryProperties = entryPropertiesOf(meta);
  const table = await buildRelatedRecordTable(
    context,
    page,
    dataSource,
    entryProperties,
    visitingPageIds,
  );

  if (meta.kind === "nested_dict" || meta.kind === "nested_array") {
    return table;
  }

  const valueProperty = entryProperties[0];
  if (!valueProperty) {
    return {};
  }

  if (valueProperty.name in table) {
    return table[valueProperty.name]!;
  }

  if (valueProperty.notionType === "relation") {
    return "omit";
  }

  return resolveMissingValue(context.config.emptyValue, valueProperty.notionType);
}

async function embedRelation(
  context: RelationResolutionContext,
  column: RelationColumn,
  meta: RelationPropertyMeta,
  relatedPageIds: string[],
  visitingPageIds: Set<string>,
): Promise<LuauValue | undefined> {
  const dictionary: LuauTable = {};
  const arrayEntries: Array<{ sortKey: number; title: string; value: LuauValue }> =
    [];

  if (relatedPageIds.length > 0) {
    const relatedDataSource = await fetchDataSourceForRelation(
      context,
      column.schema,
    );
    const relatedTitleProperty = resolveTitlePropertyName(relatedDataSource);
    const seenTitles = new Set<string>();
    const seenSortKeys = new Set<number>();

    for (const relatedPageId of relatedPageIds) {
      if (visitingPageIds.has(relatedPageId)) {
        throw new NotionToLuaError(
          `Circular relation detected while embedding "${column.notionPropertyName}". Prefix the back-reference column with [Skip] or lower relation_depth.`,
        );
      }

      const relatedPage = await fetchPage(context, relatedPageId);
      const relatedTitle = extractTitleKey(relatedPage, relatedTitleProperty);
      const sortKey = column.isArray
        ? parseNumericRelationTitle(relatedTitle)
        : 0;
      const isDuplicate = column.isArray
        ? seenSortKeys.has(sortKey)
        : seenTitles.has(relatedTitle);

      if (isDuplicate) {
        throw new NotionToLuaError(
          `Duplicate related title "${relatedTitle}" in relation property "${column.notionPropertyName}".`,
        );
      }

      seenSortKeys.add(sortKey);
      seenTitles.add(relatedTitle);

      visitingPageIds.add(relatedPageId);
      const value = await buildRelatedEntryValue(
        context,
        relatedPage,
        relatedDataSource,
        meta,
        visitingPageIds,
      );
      visitingPageIds.delete(relatedPageId);

      if (value === "omit") {
        continue;
      }

      if (column.isArray) {
        arrayEntries.push({ sortKey, title: relatedTitle, value });
      } else {
        dictionary[relatedTitle] = value;
      }
    }
  }

  const value: LuauValue = column.isArray
    ? sortRelatedEntriesByNumericTitle(arrayEntries).map((entry) => entry.value)
    : dictionary;
  const isEmpty = column.isArray
    ? arrayEntries.length === 0
    : Object.keys(dictionary).length === 0;

  if (isEmpty && context.config.emptyRelation !== "empty_table") {
    return undefined;
  }

  return value;
}

export async function resolveEmbeddedRelationsForRecords(
  context: RelationResolutionContext,
  records: LuauRecord[],
  pages: PageObjectResponse[],
  dataSource: DataSourceObjectResponse,
): Promise<ExportableProperty[]> {
  const titlePropertyName = resolveTitlePropertyName(dataSource);
  const relationColumns = listRelationColumns(dataSource);
  const baseProperties = listExportableProperties(dataSource);

  if (relationColumns.length === 0) {
    return baseProperties;
  }

  const metaByColumn = new Map<RelationColumn, RelationPropertyMeta>();
  for (const column of relationColumns) {
    metaByColumn.set(
      column,
      await describeRelation(context, column, context.config.relationDepth),
    );
  }

  const pagesByKey = new Map(
    pages.map((page) => [extractTitleKey(page, titlePropertyName), page]),
  );

  for (const record of records) {
    const page = pagesByKey.get(record.key);

    if (!page) {
      continue;
    }

    for (const column of relationColumns) {
      const pageProperty = page.properties[column.notionPropertyName];
      if (!pageProperty || pageProperty.type !== "relation") {
        continue;
      }

      const value = await embedRelation(
        context,
        column,
        metaByColumn.get(column)!,
        pageProperty.relation.map((item) => item.id),
        new Set([page.id]),
      );

      if (value === undefined) {
        delete record.properties[column.name];
      } else {
        record.properties[column.name] = value;
      }
    }
  }

  return [
    ...baseProperties,
    ...relationColumns.map((column) => ({
      name: column.name,
      notionType: "relation",
      notionPropertyName: column.notionPropertyName,
      relationMeta: metaByColumn.get(column),
    })),
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
