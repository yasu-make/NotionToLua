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
  LuauTable,
  LuauValue,
  RelationPropertyMeta,
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

function flattenRelationEntries(
  meta: RelationPropertyMeta,
  relationValues: Iterable<LuauValue | null | undefined>,
): Array<LuauValue | null | undefined> {
  const isArray = meta.kind === "scalar_array" || meta.kind === "nested_array";
  const entries: Array<LuauValue | null | undefined> = [];

  for (const relationValue of relationValues) {
    if (relationValue === null || relationValue === undefined) {
      continue;
    }

    if (isArray && Array.isArray(relationValue)) {
      entries.push(...relationValue);
    } else if (!isArray && isLuauTable(relationValue)) {
      entries.push(...Object.values(relationValue));
    } else {
      entries.push(relationValue);
    }
  }

  return entries;
}

function relationValuesToLuauType(
  meta: RelationPropertyMeta | undefined,
  relationValues: Iterable<LuauValue | null | undefined>,
  emptyValue: EmptyValueMode,
): string {
  if (!meta) {
    return "{ [string]: any }";
  }

  const entries = flattenRelationEntries(meta, relationValues);

  if (meta.kind === "scalar_dict" || meta.kind === "scalar_array") {
    const valueType =
      meta.valueProperty?.notionType === "relation"
        ? relationValuesToLuauType(
            meta.valueProperty.relationMeta,
            entries,
            emptyValue,
          )
        : resolveScalarRelationValueType(
            meta.valueNotionType,
            meta.valueType,
            entries,
            emptyValue,
          );

    return meta.kind === "scalar_dict"
      ? `{ [string]: ${valueType} }`
      : `{ ${valueType} }`;
  }

  const fieldLines = sortKeys(
    meta.entryProperties.map((entryProperty) => entryProperty.name),
  )
    .map((propertyName) => {
      const entryProperty = meta.entryProperties.find(
        (item) => item.name === propertyName,
      )!;
      const fieldValues = entries.map((entry) => {
        if (entry === null || entry === undefined || !isLuauTable(entry)) {
          return entry;
        }

        const entryTable: LuauTable = entry;
        return entryTable[propertyName];
      });
      const luauType =
        entryProperty.notionType === "relation"
          ? relationValuesToLuauType(
              entryProperty.relationMeta,
              fieldValues,
              emptyValue,
            )
          : exportablePropertyToLuauTypeFromNotionType(
              entryProperty.notionType,
              fieldValues,
              emptyValue,
            );
      const keyFormat = resolveLuauKeyFormat(propertyName);
      return `${formatLuauKey(propertyName, keyFormat)}: ${luauType}?,`;
    })
    .join("\n");
  const entryType = `{\n${indentBlock(fieldLines)}\n}`;

  return meta.kind === "nested_dict"
    ? `{ [string]: ${entryType} }`
    : `{ ${entryType} }`;
}

function* topLevelPropertyValues(
  propertyName: string,
  records: LuauRecord[],
): Generator<LuauValue | null | undefined> {
  for (const record of records) {
    yield record.properties[propertyName];
  }
}

function collectStringLiteralsFromValues(
  values: Iterable<LuauValue | null | undefined>,
  emptyValue: EmptyValueMode,
  notionType: string,
): { literals: string[]; hasNonString: boolean } {
  const literalSet = new Set<string>();
  let hasNonString = false;

  for (const value of values) {
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

function collectMultiSelectLiteralsFromValues(
  values: Iterable<LuauValue | null | undefined>,
): { literals: string[]; hasNonString: boolean } {
  const literalSet = new Set<string>();
  let hasNonString = false;

  for (const value of values) {
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

function exportablePropertyToLuauTypeFromNotionType(
  notionType: string,
  values: Iterable<LuauValue | null | undefined>,
  emptyValue: EmptyValueMode,
): string {
  if (notionType === "select" || notionType === "status") {
    const { literals, hasNonString } = collectStringLiteralsFromValues(
      values,
      emptyValue,
      notionType,
    );

    if (hasNonString || literals.length === 0) {
      return "string";
    }

    return formatStringLiteralUnion(literals);
  }

  if (notionType === "multi_select") {
    const { literals, hasNonString } = collectMultiSelectLiteralsFromValues(values);

    if (hasNonString || literals.length === 0) {
      return "{ string }";
    }

    return `{ ${formatStringLiteralUnion(literals)} }`;
  }

  return notionTypeToLuauType(notionType);
}

function resolveScalarRelationValueType(
  valueNotionType: string | undefined,
  fallbackValueType: string,
  values: Iterable<LuauValue | null | undefined>,
  emptyValue: EmptyValueMode,
): string {
  const materialized = [...values];
  const baseType = valueNotionType
    ? exportablePropertyToLuauTypeFromNotionType(
        valueNotionType,
        materialized,
        emptyValue,
      )
    : fallbackValueType;
  const hasNull = materialized.some((value) => value === null);
  const nullBecomesEmptyString =
    emptyValue === "empty_string" &&
    !!valueNotionType &&
    isStringLikeNotionType(valueNotionType);

  if (hasNull && !nullBecomesEmptyString) {
    return `${baseType}?`;
  }

  return baseType;
}

function exportablePropertyToLuauType(
  property: ExportableProperty,
  records: LuauRecord[],
  emptyValue: EmptyValueMode,
): string {
  if (property.notionType === "select" || property.notionType === "status") {
    return exportablePropertyToLuauTypeFromNotionType(
      property.notionType,
      topLevelPropertyValues(property.name, records),
      emptyValue,
    );
  }

  if (property.notionType === "multi_select") {
    return exportablePropertyToLuauTypeFromNotionType(
      "multi_select",
      topLevelPropertyValues(property.name, records),
      emptyValue,
    );
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
    return relationValuesToLuauType(
      property.relationMeta,
      topLevelPropertyValues(property.name, records),
      emptyValue,
    );
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

function isPropertyFilledForType(
  record: LuauRecord,
  propertyName: string,
  emptyValue: EmptyValueMode,
  notionType: string,
): boolean {
  if (!(propertyName in record.properties)) {
    return false;
  }

  const value = record.properties[propertyName];

  if (value === null) {
    return emptyValue === "empty_string" && isStringLikeNotionType(notionType);
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isLuauTable(value)) {
    return Object.keys(value).length > 0;
  }

  return true;
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
      const filledCount = records.filter((record) =>
        isPropertyFilledForType(record, propertyName, emptyValue, notionType),
      ).length;
      const presentCount = records.filter((record) =>
        isPropertyPresentInRecord(record, propertyName, emptyValue, notionType),
      ).length;

      if (filledCount === 0 && presentCount === 0) {
        return null;
      }

      const luauType = exportablePropertyToLuauType(
        property ?? { name: propertyName, notionType: "string" },
        records,
        emptyValue,
      );
      const optionalSuffix = filledCount < records.length ? "?" : "";

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
