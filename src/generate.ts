import type { Client } from "@notionhq/client";
import type { DataSourceObjectResponse } from "@notionhq/client/build/src/api-endpoints.js";

import type { ResolvedUserConfig } from "./config.js";
import { defaultModuleGenerator } from "./generator.js";
import {
  assertTitlePropertyExists,
  fetchAllDatabaseRecords,
  pagesToLuauRecords,
  resolveDataSource,
  type TypedConversionWarning,
} from "./notion.js";
import {
  createRelationResolutionContext,
  resolveEmbeddedRelationsForRecords,
} from "./relation.js";

export type GenerateLuauNotionClient = Pick<
  Client,
  "databases" | "dataSources" | "pages" | "blocks"
>;

export type GenerateLuauCodeOptions = {
  moduleName: string;
  dataSource?: DataSourceObjectResponse;
  exportTypes?: boolean;
  config?: ResolvedUserConfig;
  onTypedFallback?: (warning: TypedConversionWarning) => void;
};

export type GenerateLuauCodeResult = {
  luauCode: string;
  recordCount: number;
  dataSource: DataSourceObjectResponse;
};

export async function generateLuauCode(
  notion: GenerateLuauNotionClient,
  databaseId: string,
  options: GenerateLuauCodeOptions,
): Promise<GenerateLuauCodeResult> {
  const config = options.config ?? {
    namedTargets: {},
    format: true,
    exportTypes: true,
    emptyValue: "omit",
    emptyRelation: "omit",
    omitArrayIndex: false,
  };
  const dataSource =
    options.dataSource ?? (await resolveDataSource(notion, databaseId));
  assertTitlePropertyExists(dataSource);

  const pages = await fetchAllDatabaseRecords(notion, dataSource.id);
  const records = pagesToLuauRecords(pages, dataSource, {
    onTypedFallback: options.onTypedFallback,
  });
  const relationContext = createRelationResolutionContext(
    notion,
    config,
    pages,
  );
  const properties = await resolveEmbeddedRelationsForRecords(
    relationContext,
    records,
    pages,
    dataSource,
  );
  const luauCode = defaultModuleGenerator.generate(records, {
    moduleName: options.moduleName,
    properties,
    exportTypes: options.exportTypes ?? config.exportTypes,
    outputOptions: {
      emptyValue: config.emptyValue,
      emptyRelation: config.emptyRelation,
      omitArrayIndex: config.omitArrayIndex,
    },
  });

  return {
    luauCode,
    recordCount: records.length,
    dataSource,
  };
}
