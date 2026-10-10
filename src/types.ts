export interface LuauTable {
  [key: string]: LuauValue;
}

export type RobloxTypeName =
  | "Vector2"
  | "Vector3"
  | "Color3"
  | "UDim"
  | "UDim2"
  | "Rect"
  | "NumberRange"
  | "CFrame";

export type TypedRobloxValue =
  | { kind: "Vector2"; x: number; y: number }
  | { kind: "Vector3"; x: number; y: number; z: number }
  | { kind: "Color3"; r: number; g: number; b: number }
  | { kind: "UDim"; scale: number; offset: number }
  | { kind: "UDim2"; xScale: number; xOffset: number; yScale: number; yOffset: number }
  | { kind: "Rect"; minX: number; minY: number; maxX: number; maxY: number }
  | { kind: "NumberRange"; min: number; max: number }
  | {
      kind: "CFrame";
      px: number;
      py: number;
      pz: number;
      rx: number;
      ry: number;
      rz: number;
    };

export type LuauValue =
  | string
  | number
  | boolean
  | LuauTable
  | TypedRobloxValue
  | LuauValue[]
  | null;

/** @deprecated Use LuauValue[] with isStringArray() for multi-select arrays. */
export type LuauPrimitive = string | number | boolean | string[];

export type LuauKeyFormat = "identifier" | "bracket" | "numeric";

export type EmptyValueMode = "omit" | "nil" | "empty_string";

export type EmptyRelationMode = "omit" | "empty_table";

export interface OutputOptions {
  emptyValue: EmptyValueMode;
  emptyRelation: EmptyRelationMode;
  omitArrayIndex?: boolean;
}

export interface LuauRecord {
  key: string;
  keyFormat: LuauKeyFormat;
  properties: Record<string, LuauValue>;
}

export type InferredNotionType =
  | "number"
  | "checkbox"
  | "rich_text"
  | "multi_select"
  | "relation";

export interface InferredProperty {
  name: string;
  notionType: InferredNotionType;
  notionPropertyName?: string;
  robloxType?: RobloxTypeName;
  multiSelectOptions?: string[];
  relationMeta?: RelationPropertyMeta;
  relatedDataSourceId?: string;
}

export interface InferredNotionSchema {
  titlePropertyName: "Name";
  properties: InferredProperty[];
}

export type ExportableProperty = {
  name: string;
  notionType: string;
  notionPropertyName?: string;
  robloxType?: RobloxTypeName;
  relationMeta?: RelationPropertyMeta;
};

export type RelationPropertyMeta =
  | {
      kind: "scalar_dict";
      valueType: string;
      valueNotionType?: string;
      valueProperty?: ExportableProperty;
    }
  | {
      kind: "nested_dict";
      entryProperties: ExportableProperty[];
    }
  | {
      kind: "scalar_array";
      valueType: string;
      valueNotionType?: string;
      valueProperty?: ExportableProperty;
    }
  | {
      kind: "nested_array";
      entryProperties: ExportableProperty[];
    };

export interface GenerateModuleOptions {
  moduleName: string;
  properties: ExportableProperty[];
  exportTypes: boolean;
  outputOptions?: OutputOptions;
}

export const SUPPORTED_PROPERTY_TYPES = new Set([
  "number",
  "checkbox",
  "rich_text",
  "select",
  "multi_select",
  "date",
  "url",
  "formula",
  "status",
]);

/** Default prefix for Notion columns that are not synced to Luau (`skip_prefix`). */
export const SKIP_PROPERTY_PREFIX = "[Skip]";

export function isSkippedPropertyName(
  propertyName: string,
  skipPrefix = SKIP_PROPERTY_PREFIX,
): boolean {
  return propertyName.startsWith(skipPrefix);
}

const STRING_LIKE_NOTION_TYPES = new Set([
  "rich_text",
  "select",
  "url",
  "date",
  "status",
]);

export function isLuauTable(value: LuauValue): value is LuauTable {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isTypedRobloxValue(value)
  );
}

export function isTypedRobloxValue(value: LuauValue): value is TypedRobloxValue {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "kind" in value &&
    typeof (value as TypedRobloxValue).kind === "string"
  );
}

export function isStringArray(value: LuauValue): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

export function isLuauSequenceArray(value: LuauValue): value is LuauValue[] {
  return Array.isArray(value) && !isStringArray(value);
}

export function isStringLikeNotionType(notionType: string): boolean {
  return STRING_LIKE_NOTION_TYPES.has(notionType);
}

export function resolveMissingValue(
  emptyValue: EmptyValueMode,
  notionType: string,
): LuauValue | "omit" {
  if (emptyValue === "nil") {
    return null;
  }

  if (emptyValue === "empty_string" && isStringLikeNotionType(notionType)) {
    return "";
  }

  return "omit";
}

export function shouldIncludeMissingProperty(
  emptyValue: EmptyValueMode,
  notionType: string,
): boolean {
  return resolveMissingValue(emptyValue, notionType) !== "omit";
}

export function formatMissingPropertyValue(
  emptyValue: EmptyValueMode,
  notionType: string,
): LuauValue {
  const resolved = resolveMissingValue(emptyValue, notionType);
  return resolved === "omit" ? null : resolved;
}

export function isPropertyValuePresent(
  value: LuauValue,
  emptyValue: EmptyValueMode,
  notionType: string,
): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value !== null) {
    return true;
  }

  return shouldIncludeMissingProperty(emptyValue, notionType);
}
