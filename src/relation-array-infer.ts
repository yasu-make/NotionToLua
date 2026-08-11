import { NotionToLuaError } from "./errors.js";
import type {
  InferredNotionType,
  LuauRecord,
  LuauValue,
  RelationPropertyMeta,
} from "./types.js";
import {
  isLuauTable,
  isStringArray,
  isTypedRobloxValue,
} from "./types.js";

function notionTypeToLuauType(notionType: string): string {
  switch (notionType) {
    case "number":
      return "number";
    case "checkbox":
      return "boolean";
    case "multi_select":
      return "{ string }";
    default:
      return "string";
  }
}

function classifyScalarElement(value: LuauValue): InferredNotionType {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "checkbox";
  }
  if (typeof value === "string") {
    return "rich_text";
  }
  if (isTypedRobloxValue(value)) {
    return "rich_text";
  }

  throw new NotionToLuaError(
    "Array relation entries must be scalars or tables.",
  );
}

function collectSequenceArrays(
  records: LuauRecord[],
  propertyName: string,
): LuauValue[][] {
  const arrays: LuauValue[][] = [];

  for (const record of records) {
    const value = record.properties[propertyName];
    if (value === null || value === undefined) {
      continue;
    }

    if (!Array.isArray(value) || isStringArray(value)) {
      throw new NotionToLuaError(
        `Property "${propertyName}" has mixed array types across records.`,
      );
    }

    arrays.push(value);
  }

  return arrays;
}

function inferNestedArrayProperties(
  arrays: LuauValue[][],
  propertyName: string,
): Array<{ name: string; notionType: InferredNotionType }> {
  const propertyTypes = new Map<string, InferredNotionType>();

  for (const array of arrays) {
    for (const element of array) {
      if (!isLuauTable(element)) {
        throw new NotionToLuaError(
          `Property "${propertyName}" has mixed array entry types.`,
        );
      }

      for (const [key, value] of Object.entries(element)) {
        if (value === null) {
          continue;
        }

        const elementType = classifyScalarElement(value);
        const existing = propertyTypes.get(key);

        if (existing === undefined) {
          propertyTypes.set(key, elementType);
        } else if (existing !== elementType) {
          throw new NotionToLuaError(
            `Property "${propertyName}.${key}" has mixed value types across array entries.`,
          );
        }
      }
    }
  }

  return [...propertyTypes.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([name, notionType]) => ({ name, notionType }));
}

export function inferRelationArrayMeta(
  propertyName: string,
  records: LuauRecord[],
): RelationPropertyMeta {
  const arrays = collectSequenceArrays(records, propertyName);
  if (arrays.length === 0) {
    return { kind: "scalar_array", valueType: "string" };
  }

  let elementKind: "scalar" | "nested" | undefined;

  for (const array of arrays) {
    for (const element of array) {
      const currentKind = isLuauTable(element) ? "nested" : "scalar";

      if (elementKind === undefined) {
        elementKind = currentKind;
      } else if (elementKind !== currentKind) {
        throw new NotionToLuaError(
          `Property "${propertyName}" has mixed array entry types.`,
        );
      }
    }
  }

  if (elementKind === "nested") {
    const entryProperties = inferNestedArrayProperties(arrays, propertyName).map(
      (property) => ({
        name: property.name,
        notionType: property.notionType,
      }),
    );

    return {
      kind: "nested_array",
      entryProperties,
    };
  }

  let scalarType: InferredNotionType | undefined;

  for (const array of arrays) {
    for (const element of array) {
      const currentType = classifyScalarElement(element);

      if (scalarType === undefined) {
        scalarType = currentType;
      } else if (scalarType !== currentType) {
        throw new NotionToLuaError(
          `Property "${propertyName}" has mixed scalar array entry types.`,
        );
      }
    }
  }

  return {
    kind: "scalar_array",
    valueType: notionTypeToLuauType(scalarType ?? "string"),
    ...(scalarType !== undefined ? { valueNotionType: scalarType } : {}),
  };
}

export function extractScalarArrayColumnName(
  meta: Extract<RelationPropertyMeta, { kind: "scalar_array" }>,
): InferredNotionType {
  switch (meta.valueType) {
    case "number":
      return "number";
    case "boolean":
      return "checkbox";
    default:
      return "rich_text";
  }
}
