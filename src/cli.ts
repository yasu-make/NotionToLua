#!/usr/bin/env node

import { parseArgs } from "node:util";

import { createCodeBlockUpdater } from "./blocks.js";
import {
  loadUserConfig,
  resolvePageId as resolvePageIdFromConfig,
  resolvePullJobs,
  configForPullJob,
  type PullJob,
  type ResolvedUserConfig,
} from "./config.js";
import { loadEnvFile, requireNotionToken } from "./env.js";
import { toUserErrorMessage } from "./errors.js";
import {
  resolveOutputTarget,
  writeLuauFile,
  writeLuauToPath,
} from "./file-output.js";
import { generateLuauCode } from "./generate.js";
import { resolveModuleName } from "./module-name.js";
import { createNotionClient } from "./notion-client.js";
import { getDataSourceTitle, resolveDataSource } from "./notion.js";
import { initConfig } from "./init.js";
import { pushLuauFile } from "./push.js";
import { resolvePageId as resolveNotionPageId } from "./resolve-page.js";
import { formatLuauCode } from "./stylua.js";

loadEnvFile();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "database-id": { type: "string", short: "d" },
    "page-id": { type: "string", short: "p" },
    output: { type: "string", short: "o" },
    help: { type: "boolean", short: "h", default: false },
  },
});

function printHelp(): void {
  console.log(`Usage:
  ntn-lua init
  ntn-lua [<target-key>] [-d <id>] [-p <page-id>] [-o <dir-or-file>]
  ntn-lua push <file.luau> [-p <page-id>]

Examples:
  ntn-lua init
  ntn-lua                          (all [targets], or legacy database_id / output)
  ntn-lua weapons                  ([targets.weapons])
  ntn-lua -d <id> -o ./output
  ntn-lua -d <id> -o ./output/Weapons.luau
  ntn-lua push ./output/Weapons.luau -p <page-id>

Commands:
  init                Create ntn-lua.toml in the current directory
  push                Create a new Notion database from a local .luau ModuleScript

Options:
  -d, --database-id   Source database_id or data_source_id (pull mode)
  -p, --page-id       Notion page ID (parent for push; code block target in pull mode)
  -o, --output        Output directory or .lua / .luau file path (pull mode)
  -h, --help          Show help

Configuration (ntn-lua.toml):
  [targets.<key>]
    database_id                 Database or data source id for this target
    output                      Output directory or .lua / .luau file path
    code_block_parent_page_id   Optional Notion page ID for code block output
  [targets.<key>.emit]          Optional per-target overrides of [emit]
  [emit]
    format              Run Stylua formatting (default: true)
    export_types        Emit Luau export types (default: true)
    empty_value         How to emit null values: omit, nil, or empty_string (default: omit)
    empty_relation      How to emit empty relations: omit or empty_table (default: omit)
    omit_array_index    Omit numeric array indexes when keys are 1..N (default: false)
    relation_depth      How many levels of nested Relation columns to embed (default: 1)

  Legacy single-target keys still work: [source] database_id, [paths] output,
  and flat root keys. Do not mix them with [targets].

Priority:
  target        positional key → all [targets] when omitted
  database_id   -d / --database-id → target / legacy ntn-lua.toml database_id
  output        -o / --output → target / legacy ntn-lua.toml output
  code_block_parent_page_id   -p / --page-id → target / ntn-lua.toml
  emit          [targets.<key>.emit] → [emit]

Environment:
  NOTION_API_TOKEN    Required. Notion integration internal secret`);
}

function writeWarning(message: string): void {
  process.stderr.write(`Warning: ${message}\n`);
}

function runInit(): number {
  try {
    const configPath = initConfig();
    console.log(
      `Created ${configPath}. Edit [targets.<key>] database_id and output, then run ntn-lua.`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${toUserErrorMessage(error)}\n`);
    return 1;
  }
}

async function runPush(config: ResolvedUserConfig): Promise<number> {
  const filePath = positionals[1]?.trim();

  if (!filePath) {
    writeWarning(
      "No Luau file was provided. Usage: ntn-lua push <file.luau> [-p <page-id>]",
    );
    printHelp();
    return 1;
  }

  const pageId = resolvePageIdFromConfig({
    flag: values["page-id"],
    config,
  });

  if (!pageId) {
    writeWarning(
      "No page ID was provided. Use -p or set code_block_parent_page_id in ntn-lua.toml.",
    );
    printHelp();
    return 1;
  }

  try {
    const notion = createNotionClient(requireNotionToken());
    const result = await pushLuauFile(notion, { filePath, pageId });

    console.log(
      `Pushed ${result.recordCount} record(s) to new database ${result.databaseId} (data_source ${result.dataSourceId}) from ${result.moduleName}.`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${toUserErrorMessage(error)}\n`);
    return 1;
  }
}

function targetLabel(job: PullJob): string {
  return job.key ? ` (target ${job.key})` : "";
}

async function pullOne(
  notion: ReturnType<typeof createNotionClient>,
  config: ResolvedUserConfig,
  job: PullJob,
): Promise<void> {
  const databaseId = job.databaseId;

  if (!databaseId) {
    throw new Error("Missing database ID for pull job.");
  }

  const pageId = job.pageId;
  const outputPath = job.output;

  if (outputPath && pageId) {
    writeWarning(
      "--page-id is ignored in file output mode (nothing is written to Notion).",
    );
  }

  const dataSource = await resolveDataSource(notion, databaseId);
  const title = getDataSourceTitle(dataSource);
  const outputTarget = outputPath
    ? resolveOutputTarget(outputPath, {
        defaultTitle: title,
        fallbackId: dataSource.id,
      })
    : null;
  const moduleName =
    outputTarget?.kind === "file"
      ? outputTarget.moduleName
      : resolveModuleName(title, dataSource.id);

  const jobConfig = configForPullJob(config, job);

  const { luauCode, recordCount } = await generateLuauCode(notion, databaseId, {
    moduleName,
    dataSource,
    exportTypes: job.exportTypes,
    config: jobConfig,
    onTypedFallback: (warning) => {
      writeWarning(
        `Record "${warning.recordKey}" property "${warning.propertyName}" [${warning.robloxType}] could not be parsed; kept as string "${warning.rawValue}".`,
      );
    },
  });

  const formatted = await formatLuauCode(luauCode, { skip: !job.format });

  if (formatted.warning) {
    writeWarning(formatted.warning);
  }

  const finalCode = formatted.code;

  if (outputTarget) {
    const filePath =
      outputTarget.kind === "file"
        ? writeLuauToPath(outputTarget.filePath, finalCode)
        : writeLuauFile(
            outputTarget.directory,
            title,
            finalCode,
            dataSource.id,
          );
    console.log(
      `Converted ${recordCount} record(s) to Luau and wrote ${filePath}${targetLabel(job)}.`,
    );
    return;
  }

  const resolvedPageId = await resolveNotionPageId(notion, dataSource, pageId);
  const codeBlockUpdater = createCodeBlockUpdater(notion);
  const codeBlockAction = await codeBlockUpdater.sync(
    resolvedPageId,
    finalCode,
  );

  console.log(
    `Converted ${recordCount} record(s) to Luau and ${codeBlockAction === "updated" ? "updated" : "created"} the code block on page ${resolvedPageId}${targetLabel(job)}.`,
  );
}

async function runPull(config: ResolvedUserConfig): Promise<number> {
  let jobs: PullJob[];

  try {
    jobs = resolvePullJobs({
      databaseFlag: values["database-id"],
      outputFlag: values.output,
      pageFlag: values["page-id"],
      positional: positionals[0],
      config,
    });
  } catch (error) {
    process.stderr.write(`${toUserErrorMessage(error)}\n`);
    return 1;
  }

  if (jobs.length === 0 || jobs.some((job) => !job.databaseId)) {
    writeWarning(
      "No database ID was provided. Use -d, a target key, a positional argument, or set database_id / [targets] in ntn-lua.toml.",
    );
    printHelp();
    return 1;
  }

  try {
    const notion = createNotionClient(requireNotionToken());

    for (const job of jobs) {
      await pullOne(notion, config, job);
    }

    return 0;
  } catch (error) {
    process.stderr.write(`${toUserErrorMessage(error)}\n`);
    return 1;
  }
}

async function run(): Promise<number> {
  if (values.help) {
    printHelp();
    return 0;
  }

  if (positionals[0] === "init") {
    return runInit();
  }

  const config = loadUserConfig();

  if (positionals[0] === "push") {
    return runPush(config);
  }

  return runPull(config);
}

const exitCode = await run();
process.exit(exitCode);
