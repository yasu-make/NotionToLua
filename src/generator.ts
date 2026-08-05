import {
  formatLuauKey,
  formatLuauString,
  formatLuauValue,
  indentBlock,
  resolveLuauKeyFormat,
} from "./formatter.js";
import {
  canOmitRecordIndexes,
  isNumericRecordKey,
  parseNumericRelationTitle,
} from "./record-index.js";
import { toPascalCase } from "./module-name.js";
import type {
  EmptyValueMode,
  ExportableProperty,
  GenerateModuleOptions,
  LuauRecord,
  LuauValue,
} from "./types.js";
import {
  isLuauTable,
  isPropertyValuePresent,
  isStringArray,
  isStringLikeNotionType,
  resolveMissingValue,
} from "./types.js";

function sortKeys(keys: string[]): string[] {
  return [...keys].sort((left, right) => left.localeCompare(right, "en"));
}

function sortRecords(records: LuauRecord[]): LuauRecord[] {
  const allNumeric = records.every((record) => isNumericRecordKey(record.key));

  if (allNumeric) {
    return [...records].sort(
      (left, right) =>
        parseNumericRelationTitle(left.key) -
        parseNumericRelationTitle(right.key),
    );
  }

  return [...records].sort((left, right) =>
    left.key.localeCompare(right.key, "en"),
  );
}

function shouldOmitArrayIndexes(
  records: LuauRecord[],
  omitArrayIndex: boolean,
): boolean {
  if (!omitArrayIndex || records.length === 0) {
    return false;
  }

  return canOmitRecordIndexes(records.map((record) => record.key));
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

function relationPropertyToLuauType(
  property: ExportableProperty,
): string | null {
  if (!property.relationMeta) {
    return "{ [string]: any }";
  }

  if (property.relationMeta.kind === "scalar_dict") {
    return `{ [string]: ${property.relationMeta.valueType} }`;
  }

  if (property.relationMeta.kind === "scalar_array") {
    return `{ ${property.relationMeta.valueType} }`;
  }

  if (property.relationMeta.kind === "nested_array") {
    const fieldLines = sortKeys(
      property.relationMeta.entryProperties.map(
        (entryProperty) => entryProperty.name,
      ),
    )
      .map((propertyName) => {
        const entryProperty = property.relationMeta?.kind === "nested_array"
          ? property.relationMeta.entryProperties.find(
              (item) => item.name === propertyName,
            )
          : undefined;
        const luauType = notionTypeToLuauType(entryProperty?.notionType ?? "string");
        const keyFormat = resolveLuauKeyFormat(propertyName);
        return `${formatLuauKey(propertyName, keyFormat)}: ${luauType}?,`;
      })
      .join("\n");

    return `{ {\n${indentBlock(fieldLines)}\n} }`;
  }

  const fieldLines = sortKeys(
    property.relationMeta.entryProperties.map((entryProperty) => entryProperty.name),
  )
    .map((propertyName) => {
      const entryProperty = property.relationMeta?.kind === "nested_dict"
        ? property.relationMeta.entryProperties.find(
            (item) => item.name === propertyName,
          )
        : undefined;
      const luauType = notionTypeToLuauType(entryProperty?.notionType ?? "string");
      const keyFormat = resolveLuauKeyFormat(propertyName);
      return `${formatLuauKey(propertyName, keyFormat)}: ${luauType}?,`;
    })
    .join("\n");

  return `{ [string]: {\n${indentBlock(fieldLines)}\n} }`;
}

function collectStringLiteralsFromRecords(
  propertyName: string,
  records: LuauRecord[],
  emptyValue: EmptyValueMode,
  notionType: string,
): { literals: string[]; hasNonString: boolean } {
  const literalSet = new Set<string>();
  let hasNonString = false;

  for (const record of records) {
    const value = record.properties[propertyName];
    if (value === null) {
      if (emptyValue === "empty_string" && isStringLikeNotionType(notionType)) {
        literalSet.add("");
      }
      continue;
    }
    if (value === undefined) {
      continue;
    }

    if (typeof value === "string") {
      literalSet.add(value);
    } else {
      hasNonString = true;
    }
  }

  return {
    literals: [...literalSet].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
    hasNonString,
  };
}

function collectMultiSelectLiteralsFromRecords(
  propertyName: string,
  records: LuauRecord[],
): { literals: string[]; hasNonString: boolean } {
  const literalSet = new Set<string>();
  let hasNonString = false;

  for (const record of records) {
    const value = record.properties[propertyName];
    if (value === null || value === undefined) {
      continue;
    }

    if (isStringArray(value)) {
      for (const item of value) {
        literalSet.add(item);
      }
    } else {
      hasNonString = true;
    }
  }

  return {
    literals: [...literalSet].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
    hasNonString,
  };
}

function formatStringLiteralUnion(literals: string[]): string {
  return literals.map((literal) => formatLuauString(literal)).join(" | ");
}

function selectOrStatusPropertyToLuauType(
  propertyName: string,
  records: LuauRecord[],
  emptyValue: EmptyValueMode,
  notionType: string,
): string {
  const { literals, hasNonString } = collectStringLiteralsFromRecords(
    propertyName,
    records,
    emptyValue,
    notionType,
  );

  if (hasNonString || literals.length === 0) {
    return "string";
  }

  return formatStringLiteralUnion(literals);
}

function multiSelectPropertyToLuauType(
  propertyName: string,
  records: LuauRecord[],
): string {
  const { literals, hasNonString } = collectMultiSelectLiteralsFromRecords(
    propertyName,
    records,
  );

  if (hasNonString || literals.length === 0) {
    return "{ string }";
  }

  return `{ ${formatStringLiteralUnion(literals)} }`;
}

function exportablePropertyToLuauType(
  property: ExportableProperty,
  records: LuauRecord[],
  emptyValue: EmptyValueMode,
): string {
  if (property.notionType === "select" || property.notionType === "status") {
    return selectOrStatusPropertyToLuauType(
      property.name,
      records,
      emptyValue,
      property.notionType,
    );
  }

  if (property.notionType === "multi_select") {
    return multiSelectPropertyToLuauType(property.name, records);
  }

  if (property.robloxType) {
    const hasStringFallback = records.some((record) => {
      const value = record.properties[property.name];
      return value !== null && typeof value === "string";
    });

    return hasStringFallback
      ? `${property.robloxType} | string`
      : property.robloxType;
  }

  if (property.notionType === "relation") {
    return relationPropertyToLuauType(property) ?? "{ [string]: any }";
  }

  return notionTypeToLuauType(property.notionType);
}

function findExportableProperty(
  properties: ExportableProperty[],
  propertyName: string,
): ExportableProperty | undefined {
  return properties.find((property) => property.name === propertyName);
}

function resolveOutputValue(
  value: LuauValue,
  emptyValue: EmptyValueMode,
  notionType: string,
): LuauValue | "omit" {
  if (value !== null) {
    return value;
  }

  return resolveMissingValue(emptyValue, notionType);
}

function formatRecordBody(
  record: LuauRecord,
  properties: ExportableProperty[],
  emptyValue: EmptyValueMode,
): string {
  const includeNilKeys = emptyValue === "nil";
  const propertyKeys = sortKeys(Object.keys(record.properties)).filter(
    (propertyKey) => {
      const property = findExportableProperty(properties, propertyKey);
      const notionType = property?.notionType ?? "string";
      return isPropertyValuePresent(
        record.properties[propertyKey],
        emptyValue,
        notionType,
      );
    },
  );

  if (propertyKeys.length === 0) {
    return "{}";
  }

  const lines = propertyKeys.map((propertyKey) => {
    const property = findExportableProperty(properties, propertyKey);
    const notionType = property?.notionType ?? "string";
    const keyFormat = resolveLuauKeyFormat(propertyKey);
    const formattedKey = formatLuauKey(propertyKey, keyFormat);
    const outputValue = resolveOutputValue(
      record.properties[propertyKey],
      emptyValue,
      notionType,
    );
    const formattedValue = formatLuauValue(
      outputValue === "omit" ? null : outputValue,
      includeNilKeys,
    );
    return `${formattedKey} = ${formattedValue},`;
  });

  return `{\n${indentBlock(lines.join("\n"))}\n}`;
}

function formatTypePropertyKey(propertyName: string): string {
  const keyFormat = resolveLuauKeyFormat(propertyName);
  return formatLuauKey(propertyName, keyFormat);
}

function isPropertyPresentInRecord(
  record: LuauRecord,
  propertyName: string,
  emptyValue: EmptyValueMode,
  notionType: string,
): boolean {
  if (!(propertyName in record.properties)) {
    return false;
  }

  const value = record.properties[propertyName];

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isLuauTable(value)) {
    return Object.keys(value).length > 0;
  }

  return isPropertyValuePresent(value, emptyValue, notionType);
}

function generateEntryType(
  entryTypeName: string,
  properties: ExportableProperty[],
  records: LuauRecord[],
  emptyValue: EmptyValueMode,
): string | null {
  if (properties.length === 0 || records.length === 0) {
    return null;
  }

  const lines = sortKeys(properties.map((property) => property.name))
    .map((propertyName) => {
      const property = findExportableProperty(properties, propertyName);
      const notionType = property?.notionType ?? "string";
      const presentCount = records.filter((record) =>
        isPropertyPresentInRecord(record, propertyName, emptyValue, notionType),
      ).length;

      if (presentCount === 0) {
        return null;
      }

      const luauType = exportablePropertyToLuauType(
        property ?? { name: propertyName, notionType: "string" },
        records,
        emptyValue,
      );
      const optionalSuffix = presentCount < records.length ? "?" : "";

      return `${formatTypePropertyKey(propertyName)}: ${luauType}${optionalSuffix},`;
    })
    .filter((line): line is string => line !== null);

  if (lines.length === 0) {
    return null;
  }

  return `export type ${entryTypeName} = {\n${indentBlock(lines.join("\n"))}\n}`;
}

function generateModuleType(
  moduleTypeName: string,
  entryTypeName: string,
  records: LuauRecord[],
  omitArrayIndex = false,
): string | null {
  if (records.length === 0) {
    return `export type ${moduleTypeName} = {\n}`;
  }

  if (shouldOmitArrayIndexes(records, omitArrayIndex)) {
    return `export type ${moduleTypeName} = { ${entryTypeName} }`;
  }

  const sortedRecords = sortRecords(records);
  const hasNumeric = sortedRecords.some(
    (record) => record.keyFormat === "numeric",
  );

  if (!hasNumeric) {
    const lines = sortedRecords.map((record) => {
      const formattedKey = formatLuauKey(record.key, record.keyFormat);
      return `${formattedKey}: ${entryTypeName},`;
    });

    return `export type ${moduleTypeName} = {\n${indentBlock(lines.join("\n"))}\n}`;
  }

  const allNumeric = sortedRecords.every(
    (record) => record.keyFormat === "numeric",
  );
  if (allNumeric) {
    return `export type ${moduleTypeName} = { [number]: ${entryTypeName} }`;
  }

  const lines: string[] = [];
  for (const record of sortedRecords) {
    if (record.keyFormat !== "numeric") {
      const formattedKey = formatLuauKey(record.key, record.keyFormat);
      lines.push(`${formattedKey}: ${entryTypeName},`);
    }
  }
  lines.push(`[number]: ${entryTypeName},`);

  return `export type ${moduleTypeName} = {\n${indentBlock(lines.join("\n"))}\n}`;
}

function generateTypeDefinitions(
  moduleName: string,
  properties: ExportableProperty[],
  records: LuauRecord[],
  emptyValue: EmptyValueMode,
  omitArrayIndex = false,
): string | null {
  const entryTypeName = `${toPascalCase(moduleName)}Entry`;
  const moduleTypeName = toPascalCase(moduleName);
  const entryType = generateEntryType(
    entryTypeName,
    properties,
    records,
    emptyValue,
  );

  if (!entryType) {
    return null;
  }

  const moduleType = generateModuleType(
    moduleTypeName,
    entryTypeName,
    records,
    omitArrayIndex,
  );
  if (!moduleType) {
    return entryType;
  }

  return `${entryType}\n\n${moduleType}`;
}

function formatModuleTableBody(
  records: LuauRecord[],
  properties: ExportableProperty[],
  emptyValue: EmptyValueMode,
  omitArrayIndex = false,
): string {
  const sortedRecords = sortRecords(records);

  if (sortedRecords.length === 0) {
    return "{}";
  }

  if (shouldOmitArrayIndexes(sortedRecords, omitArrayIndex)) {
    const lines = sortedRecords.map((record) => {
      const body = formatRecordBody(record, properties, emptyValue);
      return `${body},`;
    });

    return `{\n${indentBlock(lines.join("\n"))}\n}`;
  }

  const lines = sortedRecords.map((record) => {
    const formattedKey = formatLuauKey(record.key, record.keyFormat);
    const body = formatRecordBody(record, properties, emptyValue);
    const indentedBody = indentBlock(body).trimStart();
    return `${formattedKey} = ${indentedBody},`;
  });

  return `{\n${indentBlock(lines.join("\n"))}\n}`;
}

export function generateModuleScript(
  records: LuauRecord[],
  options: GenerateModuleOptions,
): string {
  const { moduleName, properties, exportTypes, outputOptions } = options;
  const emptyValue = outputOptions?.emptyValue ?? "omit";
  const omitArrayIndex = outputOptions?.omitArrayIndex ?? false;
  const moduleTypeName = toPascalCase(moduleName);
  const typeDefinitions = exportTypes
    ? generateTypeDefinitions(
        moduleName,
        properties,
        records,
        emptyValue,
        omitArrayIndex,
      )
    : null;
  const tableBody = formatModuleTableBody(
    records,
    properties,
    emptyValue,
    omitArrayIndex,
  );
  const typeAnnotation =
    exportTypes && typeDefinitions ? `: ${moduleTypeName}` : "";
  const parts: string[] = [];

  if (typeDefinitions) {
    parts.push(typeDefinitions, "");
  }

  parts.push(`local ${moduleName}${typeAnnotation} = ${tableBody}`, "", `return ${moduleName}`);

  return `${parts.join("\n")}\n`;
}

export interface ModuleGenerator {
  generate(records: LuauRecord[], options: GenerateModuleOptions): string;
}

export const defaultModuleGenerator: ModuleGenerator = {
  generate: generateModuleScript,
};
