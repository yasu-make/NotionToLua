import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { NotionToLuaError } from "./errors.js";

export const NTN_LUA_TOML_TEMPLATE = `# ntn-lua — run from the directory that contains this file.
# CLI: ntn-lua            (all targets)
#      ntn-lua <key>      (one target)
#      ntn-lua -d <id> -o <path>  (ad-hoc, no target key)

[emit]
format = true
export_types = true
empty_value = "omit"         # omit | nil | empty_string
empty_relation = "omit"      # omit | empty_table
omit_array_index = false

[targets.example]
database_id = "your-database-or-data-source-id"
output = "src/shared/Config/Example.luau"
# code_block_parent_page_id = "your-page-id"  # only for Notion code block output

# [targets.items]
# database_id = "your-items-database-id"
# output = "src/shared/Config/Items.luau"
# [targets.items.emit]
# empty_value = "nil"    # overrides [emit] for this target only
`;

export function initConfig(cwd = process.cwd()): string {
  const configPath = resolve(cwd, "ntn-lua.toml");

  if (existsSync(configPath)) {
    throw new NotionToLuaError(
      "ntn-lua.toml already exists. Edit it directly or delete it before running init again.",
    );
  }

  writeFileSync(configPath, NTN_LUA_TOML_TEMPLATE, "utf8");
  return configPath;
}
