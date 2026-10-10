import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { loadUserConfig, resolvePullJobs } from "../src/config.js";
import type { ResolvedUserConfig } from "../src/config.js";
import { NotionToLuaError } from "../src/errors.js";

function withTempConfig(
  content: string | null,
  run: (cwd: string) => void,
): void {
  const cwd = mkdtempSync(join(tmpdir(), "ntn-lua-config-"));

  try {
    if (content !== null) {
      writeFileSync(join(cwd, "ntn-lua.toml"), content, "utf8");
    }

    run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("loadUserConfig", () => {
  it("returns defaults when ntn-lua.toml is missing", () => {
    withTempConfig(null, (cwd) => {
      assert.deepEqual(loadUserConfig(cwd), {
        namedTargets: {},
        format: true,
        exportTypes: true,
        emptyValue: "omit",
        emptyRelation: "omit",
        omitArrayIndex: false,
        relationDepth: 1,
        skipPrefix: "[Skip]",
      });
    });
  });

  it("reads all supported keys from flat ntn-lua.toml (legacy page_id)", () => {
    withTempConfig(
      `database_id = "db-123"
page_id = "page-456"
output = "./out"
format = false
export_types = false
empty_value = "nil"
empty_relation = "empty_table"
omit_array_index = true
relation_depth = 3
`,
      (cwd) => {
        assert.deepEqual(loadUserConfig(cwd), {
          namedTargets: {},
          databaseId: "db-123",
          pageId: "page-456",
          output: "./out",
          format: false,
          exportTypes: false,
          emptyValue: "nil",
          emptyRelation: "empty_table",
          omitArrayIndex: true,
          relationDepth: 3,
          skipPrefix: "[Skip]",
        });
      },
    );
  });

  it("reads all supported keys from sectioned ntn-lua.toml", () => {
    withTempConfig(
      `[source]
database_id = "db-123"
code_block_parent_page_id = "page-456"

[paths]
output = "./out"

[emit]
format = false
export_types = false
empty_value = "nil"
empty_relation = "empty_table"
omit_array_index = true
relation_depth = 3
`,
      (cwd) => {
        assert.deepEqual(loadUserConfig(cwd), {
          namedTargets: {},
          databaseId: "db-123",
          pageId: "page-456",
          output: "./out",
          format: false,
          exportTypes: false,
          emptyValue: "nil",
          emptyRelation: "empty_table",
          omitArrayIndex: true,
          relationDepth: 3,
          skipPrefix: "[Skip]",
        });
      },
    );
  });

  it("reads code_block_parent_page_id from flat ntn-lua.toml", () => {
    withTempConfig(
      `database_id = "db-123"
code_block_parent_page_id = "page-789"
`,
      (cwd) => {
        const config = loadUserConfig(cwd);
        assert.equal(config.databaseId, "db-123");
        assert.equal(config.pageId, "page-789");
      },
    );
  });

  it("throws when both page_id and code_block_parent_page_id are set", () => {
    withTempConfig(
      `page_id = "page-legacy"
code_block_parent_page_id = "page-new"
`,
      (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          (error: unknown) => {
            assert.ok(error instanceof NotionToLuaError);
            assert.match(
              (error as NotionToLuaError).message,
              /Cannot specify both "page_id" and "code_block_parent_page_id"/,
            );
            return true;
          },
        );
      },
    );
  });

  it("throws when section tables and flat keys are mixed", () => {
    withTempConfig(
      `database_id = "db-123"

[emit]
format = false
`,
      (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          (error: unknown) => {
            assert.ok(error instanceof NotionToLuaError);
            assert.match(
              (error as NotionToLuaError).message,
              /Cannot mix section tables and flat keys/,
            );
            return true;
          },
        );
      },
    );
  });

  it("throws for unknown section names", () => {
    withTempConfig(
      `[unknown]
key = "value"
`,
      (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          (error: unknown) => {
            assert.ok(error instanceof NotionToLuaError);
            assert.match(
              (error as NotionToLuaError).message,
              /Unknown key "unknown"/,
            );
            return true;
          },
        );
      },
    );
  });

  it("throws for unknown keys inside a section", () => {
    withTempConfig(
      `[source]
unknown_key = "value"
`,
      (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          (error: unknown) => {
            assert.ok(error instanceof NotionToLuaError);
            assert.match(
              (error as NotionToLuaError).message,
              /Unknown key "unknown_key" in section "\[source\]"/,
            );
            return true;
          },
        );
      },
    );
  });

  it("throws for unknown keys", () => {
    withTempConfig('unknown_key = "value"\n', (cwd) => {
      assert.throws(
        () => loadUserConfig(cwd),
        (error: unknown) => {
          assert.ok(error instanceof NotionToLuaError);
          assert.match(
            (error as NotionToLuaError).message,
            /Unknown key "unknown_key"/,
          );
          return true;
        },
      );
    });
  });

  it("throws for legacy properties table", () => {
    withTempConfig(
      `[properties.Effects]
relation = "embed"
`,
      (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          (error: unknown) => {
            assert.ok(error instanceof NotionToLuaError);
            assert.match(
              (error as NotionToLuaError).message,
              /Unknown key "properties"/,
            );
            return true;
          },
        );
      },
    );
  });

  it("throws for invalid empty_value", () => {
    withTempConfig('empty_value = "missing"\n', (cwd) => {
      assert.throws(
        () => loadUserConfig(cwd),
        (error: unknown) => {
          assert.ok(error instanceof NotionToLuaError);
          assert.match(
            (error as NotionToLuaError).message,
            /Expected "omit", "nil", or "empty_string"/,
          );
          return true;
        },
      );
    });
  });

  it("accepts empty_string empty_value", () => {
    withTempConfig('empty_value = "empty_string"\n', (cwd) => {
      assert.equal(loadUserConfig(cwd).emptyValue, "empty_string");
    });
  });

  it("throws when relation_depth is not a positive integer", () => {
    for (const value of ["0", "1.5", '"2"']) {
      withTempConfig(`relation_depth = ${value}\n`, (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          /Invalid value for "relation_depth"/,
        );
      });
    }
  });

  it("reads skip_prefix globally and per target", () => {
    withTempConfig(
      `[emit]
skip_prefix = "_"

[targets.weapons]
database_id = "db-weapons"
output = "src/Weapons.luau"

[targets.weapons.emit]
skip_prefix = "#"
`,
      (cwd) => {
        const config = loadUserConfig(cwd);
        assert.equal(config.skipPrefix, "_");
        assert.equal(config.namedTargets.weapons?.skipPrefix, "#");
        assert.equal(
          resolvePullJobs({ positional: "weapons", config })[0]?.skipPrefix,
          "#",
        );
      },
    );
  });

  it("throws when skip_prefix is empty", () => {
    withTempConfig('skip_prefix = "  "\n', (cwd) => {
      assert.throws(
        () => loadUserConfig(cwd),
        /Invalid value for "skip_prefix"/,
      );
    });
  });

  it("reads per-target relation_depth overrides", () => {
    withTempConfig(
      `[emit]
relation_depth = 2

[targets.weapons]
database_id = "db-weapons"
output = "src/Weapons.luau"

[targets.weapons.emit]
relation_depth = 4
`,
      (cwd) => {
        const config = loadUserConfig(cwd);
        assert.equal(config.relationDepth, 2);
        assert.equal(config.namedTargets.weapons?.relationDepth, 4);
      },
    );
  });

  it("throws when omit_array_index has an invalid type", () => {
    withTempConfig('omit_array_index = "yes"\n', (cwd) => {
      assert.throws(
        () => loadUserConfig(cwd),
        (error: unknown) => {
          assert.ok(error instanceof NotionToLuaError);
          assert.match(
            (error as NotionToLuaError).message,
            /Invalid type for "omit_array_index"/,
          );
          return true;
        },
      );
    });
  });

  it("throws when format has an invalid type", () => {
    withTempConfig('format = "yes"\n', (cwd) => {
      assert.throws(
        () => loadUserConfig(cwd),
        (error: unknown) => {
          assert.ok(error instanceof NotionToLuaError);
          assert.match(
            (error as NotionToLuaError).message,
            /Invalid type for "format"/,
          );
          return true;
        },
      );
    });
  });

  it("throws when database_id is empty", () => {
    withTempConfig('database_id = ""\n', (cwd) => {
      assert.throws(
        () => loadUserConfig(cwd),
        (error: unknown) => {
          assert.ok(error instanceof NotionToLuaError);
          assert.match(
            (error as NotionToLuaError).message,
            /Invalid value for "database_id"/,
          );
          return true;
        },
      );
    });
  });

  it("throws when output is whitespace only", () => {
    withTempConfig('output = "   "\n', (cwd) => {
      assert.throws(
        () => loadUserConfig(cwd),
        (error: unknown) => {
          assert.ok(error instanceof NotionToLuaError);
          assert.match(
            (error as NotionToLuaError).message,
            /Invalid value for "output"/,
          );
          return true;
        },
      );
    });
  });

  it("throws when ntn-lua.toml is invalid TOML", () => {
    withTempConfig("[[[\n", (cwd) => {
      assert.throws(
        () => loadUserConfig(cwd),
        (error: unknown) => {
          assert.ok(error instanceof NotionToLuaError);
          assert.match(
            (error as NotionToLuaError).message,
            /Failed to parse ntn-lua\.toml/,
          );
          return true;
        },
      );
    });
  });

  it("reads named targets from ntn-lua.toml", () => {
    withTempConfig(
      `[emit]
format = false

[targets.weapons]
database_id = "db-weapons"
output = "src/Weapons.luau"

[targets.items]
database_id = "db-items"
output = "src/Items.luau"
code_block_parent_page_id = "page-items"
`,
      (cwd) => {
        assert.deepEqual(loadUserConfig(cwd), {
          namedTargets: {
            weapons: {
              databaseId: "db-weapons",
              output: "src/Weapons.luau",
            },
            items: {
              databaseId: "db-items",
              output: "src/Items.luau",
              pageId: "page-items",
            },
          },
          format: false,
          exportTypes: true,
          emptyValue: "omit",
          emptyRelation: "omit",
          omitArrayIndex: false,
          relationDepth: 1,
          skipPrefix: "[Skip]",
        });
      },
    );
  });

  it("throws when [targets] is mixed with [source] or [paths]", () => {
    withTempConfig(
      `[source]
database_id = "db-123"

[targets.weapons]
database_id = "db-weapons"
output = "src/Weapons.luau"
`,
      (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          (error: unknown) => {
            assert.ok(error instanceof NotionToLuaError);
            assert.match(
              (error as NotionToLuaError).message,
              /Cannot mix "\[targets\]" with "\[source\]" or "\[paths\]"/,
            );
            return true;
          },
        );
      },
    );
  });

  it("throws when a named target is missing database_id", () => {
    withTempConfig(
      `[targets.weapons]
output = "src/Weapons.luau"
`,
      (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          (error: unknown) => {
            assert.ok(error instanceof NotionToLuaError);
            assert.match(
              (error as NotionToLuaError).message,
              /Missing "database_id" in "\[targets\.weapons\]"/,
            );
            return true;
          },
        );
      },
    );
  });

  it("throws when a target key is a reserved command name", () => {
    withTempConfig(
      `[targets.push]
database_id = "db-123"
`,
      (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          (error: unknown) => {
            assert.ok(error instanceof NotionToLuaError);
            assert.match(
              (error as NotionToLuaError).message,
              /reserved command name/,
            );
            return true;
          },
        );
      },
    );
  });

  it("reads per-target emit overrides", () => {
    withTempConfig(
      `[emit]
format = true
export_types = true
empty_value = "omit"

[targets.weapons]
database_id = "db-weapons"
output = "src/Weapons.luau"

[targets.weapons.emit]
empty_value = "nil"
format = false

[targets.items]
database_id = "db-items"
output = "src/Items.luau"
`,
      (cwd) => {
        const config = loadUserConfig(cwd);
        assert.equal(config.format, true);
        assert.equal(config.emptyValue, "omit");
        assert.deepEqual(config.namedTargets.weapons, {
          databaseId: "db-weapons",
          output: "src/Weapons.luau",
          format: false,
          emptyValue: "nil",
        });
        assert.deepEqual(config.namedTargets.items, {
          databaseId: "db-items",
          output: "src/Items.luau",
        });
      },
    );
  });

  it("throws for unknown keys in [targets.<key>.emit]", () => {
    withTempConfig(
      `[targets.weapons]
database_id = "db-weapons"

[targets.weapons.emit]
unknown_key = true
`,
      (cwd) => {
        assert.throws(
          () => loadUserConfig(cwd),
          (error: unknown) => {
            assert.ok(error instanceof NotionToLuaError);
            assert.match(
              (error as NotionToLuaError).message,
              /Unknown key "unknown_key" in section "\[targets\.weapons\.emit\]"/,
            );
            return true;
          },
        );
      },
    );
  });
});

const emitConfig: ResolvedUserConfig = {
  namedTargets: {},
  format: true,
  exportTypes: true,
  emptyValue: "omit",
  emptyRelation: "omit",
  omitArrayIndex: false,
  relationDepth: 1,
  skipPrefix: "[Skip]",
};

const defaultJobEmit = {
  format: true,
  exportTypes: true,
  emptyValue: "omit" as const,
  emptyRelation: "omit" as const,
  omitArrayIndex: false,
  relationDepth: 1,
  skipPrefix: "[Skip]",
};

describe("resolvePullJobs", () => {
  it("uses a named target key", () => {
    const config: ResolvedUserConfig = {
      ...emitConfig,
      namedTargets: {
        weapons: { databaseId: "db-weapons", output: "src/Weapons.luau" },
        items: { databaseId: "db-items", output: "src/Items.luau" },
      },
    };

    assert.deepEqual(resolvePullJobs({ positional: "items", config }), [
      {
        key: "items",
        databaseId: "db-items",
        output: "src/Items.luau",
        ...defaultJobEmit,
      },
    ]);
  });

  it("returns every named target when no key is given", () => {
    const config: ResolvedUserConfig = {
      ...emitConfig,
      namedTargets: {
        weapons: { databaseId: "db-weapons", output: "src/Weapons.luau" },
        items: { databaseId: "db-items", output: "src/Items.luau" },
      },
    };

    assert.deepEqual(resolvePullJobs({ config }), [
      {
        key: "items",
        databaseId: "db-items",
        output: "src/Items.luau",
        ...defaultJobEmit,
      },
      {
        key: "weapons",
        databaseId: "db-weapons",
        output: "src/Weapons.luau",
        ...defaultJobEmit,
      },
    ]);
  });

  it("throws for an unknown target key", () => {
    const config: ResolvedUserConfig = {
      ...emitConfig,
      namedTargets: {
        weapons: { databaseId: "db-weapons", output: "src/Weapons.luau" },
      },
    };

    assert.throws(
      () => resolvePullJobs({ positional: "missing", config }),
      (error: unknown) => {
        assert.ok(error instanceof NotionToLuaError);
        assert.match(
          (error as NotionToLuaError).message,
          /Unknown target "missing".*weapons/,
        );
        return true;
      },
    );
  });

  it("throws when -o is used without a key and multiple targets exist", () => {
    const config: ResolvedUserConfig = {
      ...emitConfig,
      namedTargets: {
        weapons: { databaseId: "db-weapons", output: "src/Weapons.luau" },
        items: { databaseId: "db-items", output: "src/Items.luau" },
      },
    };

    assert.throws(
      () => resolvePullJobs({ outputFlag: "./other.luau", config }),
      (error: unknown) => {
        assert.ok(error instanceof NotionToLuaError);
        assert.match(
          (error as NotionToLuaError).message,
          /Cannot apply -o or -p to every target/,
        );
        return true;
      },
    );
  });

  it("overrides a named target with -d and -o", () => {
    const config: ResolvedUserConfig = {
      ...emitConfig,
      namedTargets: {
        weapons: { databaseId: "db-weapons", output: "src/Weapons.luau" },
      },
    };

    assert.deepEqual(
      resolvePullJobs({
        positional: "weapons",
        databaseFlag: "db-other",
        outputFlag: "./other.luau",
        config,
      }),
      [
        {
          key: "weapons",
          databaseId: "db-other",
          output: "./other.luau",
          ...defaultJobEmit,
        },
      ],
    );
  });

  it("treats positional as a database id for legacy configs", () => {
    const config: ResolvedUserConfig = {
      ...emitConfig,
      databaseId: "from-config-db",
      output: "./from-config",
    };

    assert.deepEqual(
      resolvePullJobs({ positional: "from-positional", config }),
      [
        {
          databaseId: "from-positional",
          output: "./from-config",
          ...defaultJobEmit,
        },
      ],
    );
  });

  it("prefers per-target emit overrides over global [emit]", () => {
    const config: ResolvedUserConfig = {
      ...emitConfig,
      emptyValue: "omit",
      format: true,
      namedTargets: {
        weapons: {
          databaseId: "db-weapons",
          output: "src/Weapons.luau",
          emptyValue: "nil",
          format: false,
        },
      },
    };

    assert.deepEqual(resolvePullJobs({ positional: "weapons", config }), [
      {
        key: "weapons",
        databaseId: "db-weapons",
        output: "src/Weapons.luau",
        format: false,
        exportTypes: true,
        emptyValue: "nil",
        emptyRelation: "omit",
        omitArrayIndex: false,
        relationDepth: 1,
        skipPrefix: "[Skip]",
      },
    ]);
  });
});

