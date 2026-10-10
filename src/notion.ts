import type { Client } from "@notionhq/client";
import { APIResponseError } from "@notionhq/client";
import type {
  DataSourceObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints.js";

import { NotionToLuaError } from "./errors.js";
import { resolveLuauKeyFormat } from "./formatter.js";
import {
  convertRichTextToLuauValue,
  resolveExportableProperty,
} from "./typed-rich-text.js";
import {
  SUPPORTED_PROPERTY_TYPES,
  isSkippedPropertyName,
  type ExportableProperty,
  type LuauRecord,
  type LuauValue,
} from "./types.js";

type NotionClient = Pick<
  Client,
  "databases" | "dataSources" | "pages" | "blocks"
>;

type PageProperty = PageObjectResponse["properties"][string];

function richTextToPlainText(items: RichTextItemResponse[]): string {
  return items.map((item) => item.plain_text).join("");
}

function isPageObject(
  page: PageObjectResponse | { object: string },
): page is PageObjectResponse {
  return page.object === "page" && "properties" in page;
}

function isDataSourceWithProperties(
  dataSource: DataSourceObjectResponse | { object: string },
): dataSource is DataSourceObjectResponse {
  return dataSource.object === "data_source" && "properties" in dataSource;
}

export function getDataSourceTitle(dataSource: DataSourceObjectResponse): string {
  return (
    dataSource.title.map((item) => item.plain_text).join("") || dataSource.id
  );
}

async function retrieveDataSourceById(
  notion: NotionClient,
  dataSourceId: string,
): Promise<DataSourceObjectResponse> {
  const dataSource = await notion.dataSources.retrieve({
    data_source_id: dataSourceId,
  });

  if (!isDataSourceWithProperties(dataSource)) {
    throw new NotionToLuaError(
      "Could not retrieve the data source schema.",
    );
  }

  return dataSource;
}

function isObjectNotFoundError(error: unknown): boolean {
  if (APIResponseError.isAPIResponseError(error)) {
    return error.code === "object_not_found";
  }

  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "object_not_found"
  );
}

async function resolveDataSourceViaDatabase(
  notion: NotionClient,
  databaseId: string,
): Promise<DataSourceObjectResponse | null> {
  try {
    const database = await notion.databases.retrieve({
      database_id: databaseId,
    });

    if (!("data_sources" in database) || database.data_sources.length === 0) {
      throw new NotionToLuaError(
        "Database not found or it has no data sources.",
      );
    }

    if (database.data_sources.length > 1) {
      throw new NotionToLuaError(
        "This database has multiple data sources. Pass a data_source_id directly as databaseId.",
      );
    }

    return retrieveDataSourceById(notion, database.data_sources[0].id);
  } catch (error) {
    if (error instanceof NotionToLuaError) {
      throw error;
    }

    if (isObjectNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function resolveDataSource(
  notion: NotionClient,
  databaseId: string,
): Promise<DataSourceObjectResponse> {
  const fromDatabase = await resolveDataSourceViaDatabase(notion, databaseId);

  if (fromDatabase) {
    return fromDatabase;
  }

  try {
    return await retrieveDataSourceById(notion, databaseId);
  } catch (error) {
    if (isObjectNotFoundError(error)) {
      throw new NotionToLuaError(
        "Database or page not found. Check the integration connection and ID.",
      );
    }

    throw error;
  }
}

export function resolveTitlePropertyName(
  dataSource: DataSourceObjectResponse,
): string {
  const titleProperties = Object.entries(dataSource.properties).filter(
    ([, property]) => property.type === "title",
  );

  if (titleProperties.length === 0) {
    throw new NotionToLuaError(
      `No title property found. Add a title property (primary key column) to database "${getDataSourceTitle(dataSource)}".`,
    );
  }

  if (titleProperties.length > 1) {
    throw new NotionToLuaError(
      `Multiple title properties found. Database "${getDataSourceTitle(dataSource)}" must have exactly one title property.`,
    );
  }

  return titleProperties[0][0];
}

export function assertTitlePropertyExists(
  dataSource: DataSourceObjectResponse,
): string {
  return resolveTitlePropertyName(dataSource);
}

export async function fetchAllDatabaseRecords(
  notion: NotionClient,
  dataSourceId: string,
): Promise<PageObjectResponse[]> {
  const pages: PageObjectResponse[] = [];
  let startCursor: string | undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      result_type: "page",
      start_cursor: startCursor,
    });

    for (const result of response.results) {
      if (isPageObject(result)) {
        pages.push(result);
      }
    }

    startCursor = response.has_more
      ? (response.next_cursor ?? undefined)
      : undefined;
  } while (startCursor);

  return pages;
}

function convertDateValue(
  date: Extract<PageProperty, { type: "date" }>["date"],
): string | null {
  if (!date?.start) {
    return null;
  }

  return date.start;
}

function convertFormulaValue(
  formula: Extract<PageProperty, { type: "formula" }>["formula"],
): LuauValue {
  switch (formula.type) {
    case "string":
      return formula.string ?? null;
    case "number":
      return formula.number ?? null;
    case "boolean":
      return formula.boolean ?? null;
    case "date":
      return formula.date?.start ?? null;
    default:
      return null;
  }
}

export function convertPropertyValue(
  property: PageProperty,
): LuauValue | undefined {
  if (!SUPPORTED_PROPERTY_TYPES.has(property.type)) {
    return undefined;
  }

  switch (property.type) {
    case "number":
      return property.number ?? null;
    case "checkbox":
      return property.checkbox ?? null;
    case "rich_text":
      return richTextToPlainText(property.rich_text) || null;
    case "select":
      return property.select?.name ?? null;
    case "multi_select":
      return property.multi_select.length > 0
        ? property.multi_select.map((option) => option.name)
        : null;
    case "date":
      return convertDateValue(property.date);
    case "url":
      return property.url ?? null;
    case "formula":
      return convertFormulaValue(property.formula);
    case "status":
      return property.status?.name ?? null;
    default:
      return undefined;
  }
}

export function extractTitleKey(
  page: PageObjectResponse,
  titlePropertyName: string,
): string {
  const titleProperty = page.properties[titlePropertyName];

  if (!titleProperty || titleProperty.type !== "title") {
    throw new NotionToLuaError(
      `Failed to read title property "${titlePropertyName}".`,
    );
  }

  const title = richTextToPlainText(titleProperty.title).trim();

  if (!title) {
    throw new NotionToLuaError(
      `Title property "${titlePropertyName}" is empty on one or more records. Set a value on every record.`,
    );
  }

  return title;
}

export function convertPagePropertyToLuauValue(
  pageProperty: PageProperty | undefined,
  dataSourceProperty:
    | DataSourceObjectResponse["properties"][string]
    | undefined,
  exportableProperty: ExportableProperty,
): LuauValue | undefined {
  if (!pageProperty || !dataSourceProperty) {
    return undefined;
  }

  if (pageProperty.type !== dataSourceProperty.type) {
    return undefined;
  }

  const converted = convertPropertyValue(pageProperty);
  if (converted === undefined) {
    return undefined;
  }

  if (
    exportableProperty.robloxType &&
    dataSourceProperty.type === "rich_text" &&
    typeof converted === "string"
  ) {
    return convertRichTextToLuauValue(
      exportableProperty.robloxType,
      converted,
    ).value;
  }

  return converted;
}

export type TypedConversionWarning = {
  recordKey: string;
  propertyName: string;
  robloxType: string;
  rawValue: string;
};

export function collectTypedConversionWarnings(
  recordKey: string,
  exportableProperty: ExportableProperty,
  rawValue: string,
): TypedConversionWarning | null {
  if (!exportableProperty.robloxType) {
    return null;
  }

  const { usedFallback } = convertRichTextToLuauValue(
    exportableProperty.robloxType,
    rawValue,
  );

  if (!usedFallback) {
    return null;
  }

  return {
    recordKey,
    propertyName: exportableProperty.name,
    robloxType: exportableProperty.robloxType,
    rawValue,
  };
}

export function pagesToLuauRecords(
  pages: PageObjectResponse[],
  dataSource: DataSourceObjectResponse,
  options?: {
    onTypedFallback?: (warning: TypedConversionWarning) => void;
    skipPrefix?: string;
  },
): LuauRecord[] {
  const titlePropertyName = resolveTitlePropertyName(dataSource);
  const exportableProperties = listExportableProperties(
    dataSource,
    options?.skipPrefix,
  );

  const seenKeys = new Map<string, number>();
  const records: LuauRecord[] = [];

  for (const page of pages) {
    const key = extractTitleKey(page, titlePropertyName);
    const duplicateCount = (seenKeys.get(key) ?? 0) + 1;
    seenKeys.set(key, duplicateCount);

    if (duplicateCount > 1) {
      throw new NotionToLuaError(
        `Duplicate title value "${key}". Keys must be unique.`,
      );
    }

    const properties: Record<string, LuauValue> = {};

    for (const exportableProperty of exportableProperties) {
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

      if (
        exportableProperty.robloxType &&
        typeof converted === "string" &&
        dataSourceProperty?.type === "rich_text"
      ) {
        const warning = collectTypedConversionWarnings(
          key,
          exportableProperty,
          converted,
        );
        if (warning) {
          options?.onTypedFallback?.(warning);
        }
      }

      properties[exportableProperty.name] = converted;
    }

    records.push({
      key,
      keyFormat: resolveLuauKeyFormat(key),
      properties,
    });
  }

  return records;
}

export function listExportablePropertyNames(
  dataSource: DataSourceObjectResponse,
): string[] {
  return listExportableProperties(dataSource).map((property) => property.name);
}

export function listExportableProperties(
  dataSource: DataSourceObjectResponse,
  skipPrefix?: string,
): ExportableProperty[] {
  const titlePropertyName = resolveTitlePropertyName(dataSource);

  return Object.entries(dataSource.properties)
    .filter(
      ([propertyName, property]) =>
        propertyName !== titlePropertyName &&
        !isSkippedPropertyName(propertyName, skipPrefix) &&
        SUPPORTED_PROPERTY_TYPES.has(property.type),
    )
    .map(([propertyName, property]) =>
      resolveExportableProperty(propertyName, property.type),
    );
}
