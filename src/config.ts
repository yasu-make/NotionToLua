import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "smol-toml";

import { NotionToLuaError } from "./errors.js";
import type { EmptyRelationMode, EmptyValueMode } from "./types.js";

export type EmitOverrides = {
  format?: boolean;
  exportTypes?: boolean;
  emptyValue?: EmptyValueMode;
  emptyRelation?: EmptyRelationMode;
  omitArrayIndex?: boolean;
  relationDepth?: number;
};

export type UserConfigTarget = {
  database_id: string;
  output?: string;
  code_block_parent_page_id?: string;
  format?: boolean;
  export_types?: boolean;
  empty_value?: EmptyValueMode;
  empty_relation?: EmptyRelationMode;
  omit_array_index?: boolean;
  relation_depth?: number;
};

export type UserConfigFile = {
  database_id?: string;
  page_id?: string;
  code_block_parent_page_id?: string;
  output?: string;
  format?: boolean;
  export_types?: boolean;
  empty_value?: EmptyValueMode;
  empty_relation?: EmptyRelationMode;
  omit_array_index?: boolean;
  relation_depth?: number;
  targets?: Record<string, UserConfigTarget>;
};

export type NamedTarget = {
  databaseId: string;
  output?: string;
  pageId?: string;
} & EmitOverrides;

export type ResolvedUserConfig = {
  namedTargets: Record<string, NamedTarget>;
  databaseId?: string;
  pageId?: string;
  output?: string;
  format: boolean;
  exportTypes: boolean;
  emptyValue: EmptyValueMode;
  emptyRelation: EmptyRelationMode;
  omitArrayIndex: boolean;
  relationDepth: number;
};

export type PullJob = {
  key?: string;
  databaseId?: string;
  output?: string;
  pageId?: string;
  format: boolean;
  exportTypes: boolean;
  emptyValue: EmptyValueMode;
  emptyRelation: EmptyRelationMode;
  omitArrayIndex: boolean;
  relationDepth: number;
};

const SECTION_NAMES = new Set(["source", "paths", "emit", "targets"]);
const RESERVED_TARGET_KEYS = new Set(["init", "push"]);
const LEGACY_SECTIONS = new Set(["source", "paths"]);

const FLAT_ALLOWED_KEYS = new Set([
  "database_id",
  "page_id",
  "code_block_parent_page_id",
  "output",
  "format",
  "export_types",
  "empty_value",
  "empty_relation",
  "omit_array_index",
  "relation_depth",
]);

const SOURCE_KEYS = new Set(["database_id", "code_block_parent_page_id"]);
const PATHS_KEYS = new Set(["output"]);
const EMIT_KEYS = new Set([
  "format",
  "export_types",
  "empty_value",
  "empty_relation",
  "omit_array_index",
  "relation_depth",
]);
const TARGET_ENTRY_KEYS = new Set([
  "database_id",
  "output",
  "code_block_parent_page_id",
  "emit",
]);

const DEFAULT_CONFIG: ResolvedUserConfig = {
  namedTargets: {},
  format: true,
  exportTypes: true,
  emptyValue: "omit",
  emptyRelation: "omit",
  omitArrayIndex: false,
  relationDepth: 1,
};

function assertNonEmptyString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new NotionToLuaError(
      `Invalid type for "${key}" in ntn-lua.toml. Expected a string.`,
    );
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new NotionToLuaError(
      `Invalid value for "${key}" in ntn-lua.toml. Expected a non-empty string.`,
    );
  }

  return trimmed;
}

function assertBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new NotionToLuaError(
      `Invalid type for "${key}" in ntn-lua.toml. Expected a boolean.`,
    );
  }

  return value;
}

function assertEmptyValueMode(value: unknown, key: string): EmptyValueMode {
  if (value !== "omit" && value !== "nil" && value !== "empty_string") {
    throw new NotionToLuaError(
      `Invalid value for "${key}" in ntn-lua.toml. Expected "omit", "nil", or "empty_string".`,
    );
  }

  return value;
}

function assertEmptyRelationMode(
  value: unknown,
  key: string,
): EmptyRelationMode {
  if (value !== "omit" && value !== "empty_table") {
    throw new NotionToLuaError(
      `Invalid value for "${key}" in ntn-lua.toml. Expected "omit" or "empty_table".`,
    );
  }

  return value;
}

function assertPositiveInteger(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new NotionToLuaError(
      `Invalid value for "${key}" in ntn-lua.toml. Expected a positive integer.`,
    );
  }

  return value;
}

function assertSectionTable(
  value: unknown,
  section: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new NotionToLuaError(
      `Invalid ntn-lua.toml. Expected a table for section "[${section}]".`,
    );
  }

  return value as Record<string, unknown>;
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: Set<string>,
  context?: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      const suffix = context ? ` in ${context}` : "";
      throw new NotionToLuaError(`Unknown key "${key}"${suffix} in ntn-lua.toml.`);
    }
  }
}

function applySourceFields(
  config: UserConfigFile,
  record: Record<string, unknown>,
): void {
  if ("database_id" in record) {
    config.database_id = assertNonEmptyString(record.database_id, "database_id");
  }

  if ("code_block_parent_page_id" in record) {
    config.code_block_parent_page_id = assertNonEmptyString(
      record.code_block_parent_page_id,
      "code_block_parent_page_id",
    );
  }
}

function applyPathsFields(
  config: UserConfigFile,
  record: Record<string, unknown>,
): void {
  if ("output" in record) {
    config.output = assertNonEmptyString(record.output, "output");
  }
}

function applyEmitFields(
  config: {
    format?: boolean;
    export_types?: boolean;
    empty_value?: EmptyValueMode;
    empty_relation?: EmptyRelationMode;
    omit_array_index?: boolean;
    relation_depth?: number;
  },
  record: Record<string, unknown>,
): void {
  if ("format" in record) {
    config.format = assertBoolean(record.format, "format");
  }

  if ("export_types" in record) {
    config.export_types = assertBoolean(record.export_types, "export_types");
  }

  if ("empty_value" in record) {
    config.empty_value = assertEmptyValueMode(record.empty_value, "empty_value");
  }

  if ("empty_relation" in record) {
    config.empty_relation = assertEmptyRelationMode(
      record.empty_relation,
      "empty_relation",
    );
  }

  if ("omit_array_index" in record) {
    config.omit_array_index = assertBoolean(
      record.omit_array_index,
      "omit_array_index",
    );
  }

  if ("relation_depth" in record) {
    config.relation_depth = assertPositiveInteger(
      record.relation_depth,
      "relation_depth",
    );
  }
}

function applyFlatFields(
  config: UserConfigFile,
  record: Record<string, unknown>,
): void {
  applySourceFields(config, record);
  applyPathsFields(config, record);
  applyEmitFields(config, record);

  if ("page_id" in record) {
    config.page_id = assertNonEmptyString(record.page_id, "page_id");
  }
}

function assertExclusivePageIdFields(config: UserConfigFile): void {
  if (config.page_id && config.code_block_parent_page_id) {
    throw new NotionToLuaError(
      'Cannot specify both "page_id" and "code_block_parent_page_id" in ntn-lua.toml.',
    );
  }
}

function parseNamedTargets(value: unknown): Record<string, UserConfigTarget> {
  const record = assertSectionTable(value, "targets");
  const keys = Object.keys(record);

  if (keys.length === 0) {
    throw new NotionToLuaError(
      'Invalid ntn-lua.toml. "[targets]" must contain at least one target.',
    );
  }

  const targets: Record<string, UserConfigTarget> = {};

  for (const key of keys) {
    if (RESERVED_TARGET_KEYS.has(key)) {
      throw new NotionToLuaError(
        `Invalid target key "${key}" in ntn-lua.toml. "${key}" is a reserved command name.`,
      );
    }

    const targetRecord = assertSectionTable(record[key], `targets.${key}`);
    assertAllowedKeys(targetRecord, TARGET_ENTRY_KEYS, `section "[targets.${key}]"`);

    if (!("database_id" in targetRecord)) {
      throw new NotionToLuaError(
        `Missing "database_id" in "[targets.${key}]" in ntn-lua.toml.`,
      );
    }

    const parsed: UserConfigTarget = {
      database_id: assertNonEmptyString(targetRecord.database_id, "database_id"),
    };

    if ("output" in targetRecord) {
      parsed.output = assertNonEmptyString(targetRecord.output, "output");
    }

    if ("code_block_parent_page_id" in targetRecord) {
      parsed.code_block_parent_page_id = assertNonEmptyString(
        targetRecord.code_block_parent_page_id,
        "code_block_parent_page_id",
      );
    }

    if ("emit" in targetRecord) {
      const emit = assertSectionTable(targetRecord.emit, `targets.${key}.emit`);
      assertAllowedKeys(emit, EMIT_KEYS, `section "[targets.${key}.emit]"`);
      applyEmitFields(parsed, emit);
    }

    targets[key] = parsed;
  }

  return targets;
}

function parseSectionConfig(record: Record<string, unknown>): UserConfigFile {
  for (const key of Object.keys(record)) {
    if (!SECTION_NAMES.has(key)) {
      throw new NotionToLuaError(`Unknown key "${key}" in ntn-lua.toml.`);
    }
  }

  const hasTargets = "targets" in record;
  const hasLegacy = Object.keys(record).some((key) => LEGACY_SECTIONS.has(key));

  if (hasTargets && hasLegacy) {
    throw new NotionToLuaError(
      'Cannot mix "[targets]" with "[source]" or "[paths]" in ntn-lua.toml.',
    );
  }

  const config: UserConfigFile = {};

  if ("source" in record) {
    const source = assertSectionTable(record.source, "source");
    assertAllowedKeys(source, SOURCE_KEYS, 'section "[source]"');
    applySourceFields(config, source);
  }

  if ("paths" in record) {
    const paths = assertSectionTable(record.paths, "paths");
    assertAllowedKeys(paths, PATHS_KEYS, 'section "[paths]"');
    applyPathsFields(config, paths);
  }

  if ("emit" in record) {
    const emit = assertSectionTable(record.emit, "emit");
    assertAllowedKeys(emit, EMIT_KEYS, 'section "[emit]"');
    applyEmitFields(config, emit);
  }

  if (hasTargets) {
    config.targets = parseNamedTargets(record.targets);
  }

  assertExclusivePageIdFields(config);
  return config;
}

function parseFlatConfig(record: Record<string, unknown>): UserConfigFile {
  assertAllowedKeys(record, FLAT_ALLOWED_KEYS);

  const config: UserConfigFile = {};
  applyFlatFields(config, record);
  assertExclusivePageIdFields(config);
  return config;
}

function validateUserConfig(raw: unknown): UserConfigFile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new NotionToLuaError(
      "Invalid ntn-lua.toml. Expected a table at the root.",
    );
  }

  const record = raw as Record<string, unknown>;
  const hasSection = Object.keys(record).some((key) => SECTION_NAMES.has(key));
  const hasFlat = Object.keys(record).some((key) => !SECTION_NAMES.has(key));

  if (hasSection && hasFlat) {
    throw new NotionToLuaError(
      "Cannot mix section tables and flat keys in ntn-lua.toml.",
    );
  }

  if (hasSection) {
    return parseSectionConfig(record);
  }

  return parseFlatConfig(record);
}

function assignOptionalString<T extends object>(
  target: T,
  key: keyof T,
  value: string | undefined,
): void {
  if (value) {
    target[key] = value as T[keyof T];
  }
}

function copyEmitOverrides(target: NamedTarget, source: UserConfigTarget): void {
  if (source.format !== undefined) {
    target.format = source.format;
  }

  if (source.export_types !== undefined) {
    target.exportTypes = source.export_types;
  }

  if (source.empty_value !== undefined) {
    target.emptyValue = source.empty_value;
  }

  if (source.empty_relation !== undefined) {
    target.emptyRelation = source.empty_relation;
  }

  if (source.omit_array_index !== undefined) {
    target.omitArrayIndex = source.omit_array_index;
  }

  if (source.relation_depth !== undefined) {
    target.relationDepth = source.relation_depth;
  }
}

function resolveNamedTargets(
  targets: Record<string, UserConfigTarget> | undefined,
): Record<string, NamedTarget> {
  if (!targets) {
    return {};
  }

  const resolved: Record<string, NamedTarget> = {};

  for (const [key, target] of Object.entries(targets)) {
    const named: NamedTarget = {
      databaseId: target.database_id,
    };
    assignOptionalString(named, "output", target.output);
    assignOptionalString(named, "pageId", target.code_block_parent_page_id);
    copyEmitOverrides(named, target);
    resolved[key] = named;
  }

  return resolved;
}

function resolveConfig(config: UserConfigFile): ResolvedUserConfig {
  const resolved: ResolvedUserConfig = {
    namedTargets: resolveNamedTargets(config.targets),
    format: config.format ?? true,
    exportTypes: config.export_types ?? true,
    emptyValue: config.empty_value ?? "omit",
    emptyRelation: config.empty_relation ?? "omit",
    omitArrayIndex: config.omit_array_index ?? false,
    relationDepth: config.relation_depth ?? 1,
  };

  assignOptionalString(resolved, "databaseId", config.database_id);
  assignOptionalString(
    resolved,
    "pageId",
    config.code_block_parent_page_id ?? config.page_id,
  );
  assignOptionalString(resolved, "output", config.output);

  return resolved;
}

export function loadUserConfig(cwd = process.cwd()): ResolvedUserConfig {
  const path = resolve(cwd, "ntn-lua.toml");

  let content: string;

  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { ...DEFAULT_CONFIG, namedTargets: {} };
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = parse(content);
  } catch (error) {
    throw new NotionToLuaError(
      `Failed to parse ntn-lua.toml: ${error instanceof Error ? error.message : "invalid TOML"}`,
    );
  }

  return resolveConfig(validateUserConfig(parsed));
}

function namedTargetKeys(config: ResolvedUserConfig): string[] {
  return Object.keys(config.namedTargets).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function trimFlag(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function emitFromConfig(config: ResolvedUserConfig): {
  format: boolean;
  exportTypes: boolean;
  emptyValue: EmptyValueMode;
  emptyRelation: EmptyRelationMode;
  omitArrayIndex: boolean;
  relationDepth: number;
} {
  return {
    format: config.format,
    exportTypes: config.exportTypes,
    emptyValue: config.emptyValue,
    emptyRelation: config.emptyRelation,
    omitArrayIndex: config.omitArrayIndex,
    relationDepth: config.relationDepth,
  };
}

function mergeEmit(
  config: ResolvedUserConfig,
  override?: EmitOverrides,
): {
  format: boolean;
  exportTypes: boolean;
  emptyValue: EmptyValueMode;
  emptyRelation: EmptyRelationMode;
  omitArrayIndex: boolean;
  relationDepth: number;
} {
  const base = emitFromConfig(config);
  return {
    format: override?.format ?? base.format,
    exportTypes: override?.exportTypes ?? base.exportTypes,
    emptyValue: override?.emptyValue ?? base.emptyValue,
    emptyRelation: override?.emptyRelation ?? base.emptyRelation,
    omitArrayIndex: override?.omitArrayIndex ?? base.omitArrayIndex,
    relationDepth: override?.relationDepth ?? base.relationDepth,
  };
}

export function configForPullJob(
  config: ResolvedUserConfig,
  job: PullJob,
): ResolvedUserConfig {
  return {
    ...config,
    format: job.format,
    exportTypes: job.exportTypes,
    emptyValue: job.emptyValue,
    emptyRelation: job.emptyRelation,
    omitArrayIndex: job.omitArrayIndex,
    relationDepth: job.relationDepth,
  };
}

function pullJobFromTarget(
  key: string,
  target: NamedTarget,
  config: ResolvedUserConfig,
): PullJob {
  const job: PullJob = {
    key,
    databaseId: target.databaseId,
    ...mergeEmit(config, target),
  };
  assignOptionalString(job, "output", target.output);
  assignOptionalString(job, "pageId", target.pageId);
  return job;
}

function applyPullJobFlags(
  job: PullJob,
  flags: { databaseId?: string; output?: string; pageId?: string },
): PullJob {
  const next: PullJob = { ...job };
  assignOptionalString(next, "databaseId", flags.databaseId);
  assignOptionalString(next, "output", flags.output);
  assignOptionalString(next, "pageId", flags.pageId);
  return next;
}

export function resolvePullJobs(options: {
  databaseFlag?: string;
  outputFlag?: string;
  pageFlag?: string;
  positional?: string;
  config: ResolvedUserConfig;
}): PullJob[] {
  const databaseFlag = trimFlag(options.databaseFlag);
  const outputFlag = trimFlag(options.outputFlag);
  const pageFlag = trimFlag(options.pageFlag);
  const positional = trimFlag(options.positional);
  const flags = {
    databaseId: databaseFlag,
    output: outputFlag,
    pageId: pageFlag,
  };
  const keys = namedTargetKeys(options.config);

  if (keys.length > 0) {
    if (positional) {
      const target = options.config.namedTargets[positional];

      if (!target) {
        throw new NotionToLuaError(
          `Unknown target "${positional}". Available targets: ${keys.join(", ")}.`,
        );
      }

      return [
        applyPullJobFlags(
          pullJobFromTarget(positional, target, options.config),
          flags,
        ),
      ];
    }

    if (databaseFlag) {
      return [
        applyPullJobFlags(
          {
            databaseId: databaseFlag,
            ...mergeEmit(options.config),
          },
          flags,
        ),
      ];
    }

    if (keys.length > 1 && (outputFlag || pageFlag)) {
      throw new NotionToLuaError(
        "Cannot apply -o or -p to every target. Pass a target key, for example: ntn-lua weapons -o ./out.luau",
      );
    }

    return keys.map((key) => {
      const target = options.config.namedTargets[key];
      if (!target) {
        throw new NotionToLuaError(`Unknown target "${key}".`);
      }

      return applyPullJobFlags(
        pullJobFromTarget(key, target, options.config),
        flags,
      );
    });
  }

  const legacyJob: PullJob = { ...mergeEmit(options.config) };
  assignOptionalString(
    legacyJob,
    "databaseId",
    databaseFlag ?? positional ?? options.config.databaseId,
  );
  assignOptionalString(legacyJob, "output", options.config.output);
  assignOptionalString(legacyJob, "pageId", options.config.pageId);

  return [applyPullJobFlags(legacyJob, flags)];
}

export function resolveDatabaseId(options?: {
  flag?: string;
  positional?: string;
  config?: ResolvedUserConfig;
}): string | undefined {
  const fromFlag = options?.flag?.trim();
  if (fromFlag) {
    return fromFlag;
  }

  const fromPositional = options?.positional?.trim();
  if (fromPositional) {
    return fromPositional;
  }

  return options?.config?.databaseId;
}

export function resolveOutputPath(options?: {
  flag?: string;
  config?: ResolvedUserConfig;
}): string | undefined {
  const fromFlag = options?.flag?.trim();
  if (fromFlag) {
    return fromFlag;
  }

  return options?.config?.output;
}

export function resolvePageId(options?: {
  flag?: string;
  config?: ResolvedUserConfig;
}): string | undefined {
  const fromFlag = options?.flag?.trim();
  if (fromFlag) {
    return fromFlag;
  }

  return options?.config?.pageId;
}
