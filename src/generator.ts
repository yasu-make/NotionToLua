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
} from "./types.js";
import {
  isLuauSequenceArray,
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
  records: LuauRecord[],
  emptyValue: EmptyValueMode,
): string | null {
  if (!property.relationMeta) {
    return "{ [string]: any }";
  }

  if (property.relationMeta.kind === "scalar_dict") {
    const valueType = resolveScalarRelationValueType(
      property.relationMeta.valueNotionType,
      property.relationMeta.valueType,
      scalarRelationValues(property.name, records, "scalar_dict"),
      emptyValue,
    );
    return `{ [string]: ${valueType} }`;
  }

  if (property.relationMeta.kind === "scalar_array") {
    const valueType = resolveScalarRelationValueType(
      property.relationMeta.valueNotionType,
      property.relationMeta.valueType,
      scalarRelationValues(property.name, records, "scalar_array"),
      emptyValue,
    );
    return `{ ${valueType} }`;
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
        const luauType = entryProperty
          ? entryPropertyToLuauType(
              entryProperty,
              property.name,
              records,
              emptyValue,
              "nested_array",
            )
          : notionTypeToLuauType("string");
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
      const luauType = entryProperty
        ? entryPropertyToLuauType(
            entryProperty,
            property.name,
            records,
            emptyValue,
            "nested_dict",
          )
        : notionTypeToLuauType("string");
      const keyFormat = resolveLuauKeyFormat(propertyName);
      return `${formatLuauKey(propertyName, keyFormat)}: ${luauType}?,`;
    })
    .join("\n");

  return `{ [string]: {\n${indentBlock(fieldLines)}\n} }`;
}

function* topLevelPropertyValues(
  propertyName: string,
  records: LuauRecord[],
): Generator<LuauValue | null | undefined> {
  for (const record of records) {
    yield record.properties[propertyName];
  }
}

function* nestedRelationEntryValues(
  relationPropertyName: string,
  entryPropertyName: string,
  records: LuauRecord[],
  kind: "nested_dict" | "nested_array",
): Generator<LuauValue | null | undefined> {
  for (const record of records) {
    const relationValue = record.properties[relationPropertyName];
    if (relationValue === null || relationValue === undefined) {
      continue;
    }

    if (kind === "nested_dict") {
      if (!isLuauTable(relationValue)) {
        yield relationValue;
        continue;
      }

      for (const nestedValue of Object.values(relationValue)) {
        if (!isLuauTable(nestedValue)) {
          yield nestedValue;
          continue;
        }

        const nestedTable: LuauTable = nestedValue;
        yield nestedTable[entryPropertyName];
      }
      continue;
    }

    if (!isLuauSequenceArray(relationValue)) {
      yield relationValue;
      continue;
    }

    for (const nestedValue of relationValue) {
      if (!isLuauTable(nestedValue)) {
        yield nestedValue;
        continue;
      }

      const nestedTable: LuauTable = nestedValue;
      yield nestedTable[entryPropertyName];
    }
  }
}

function* scalarRelationValues(
  relationPropertyName: string,
  records: LuauRecord[],
  kind: "scalar_dict" | "scalar_array",
): Generator<LuauValue | null | undefined> {
  for (const record of records) {
    const relationValue = record.properties[relationPropertyName];
    if (relationValue === null || relationValue === undefined) {
      continue;
    }

    if (kind === "scalar_dict") {
      if (!isLuauTable(relationValue)) {
        yield relationValue;
        continue;
      }

      for (const scalarValue of Object.values(relationValue)) {
        yield scalarValue;
      }
      continue;
    }

    if (!Array.isArray(relationValue)) {
      yield relationValue;
      continue;
    }

    for (const scalarValue of relationValue) {
      yield scalarValue;
    }
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

function entryPropertyToLuauType(
  entryProperty: ExportableProperty,
  relationPropertyName: string,
  records: LuauRecord[],
  emptyValue: EmptyValueMode,
  kind: "nested_dict" | "nested_array",
): string {
  return exportablePropertyToLuauTypeFromNotionType(
    entryProperty.notionType,
    nestedRelationEntryValues(
      relationPropertyName,
      entryProperty.name,
      records,
      kind,
    ),
    emptyValue,
  );
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
    return relationPropertyToLuauType(property, records, emptyValue) ?? "{ [string]: any }";
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
