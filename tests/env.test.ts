import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveDatabaseId,
  resolveOutputPath,
  resolvePageId,
  type ResolvedUserConfig,
} from "../src/config.js";

const sampleConfig: ResolvedUserConfig = {
  namedTargets: {},
  databaseId: "from-config-db",
  pageId: "from-config-page",
  output: "./from-config",
  format: true,
  exportTypes: true,
};

describe("resolveDatabaseId", () => {
  it("prefers flag over positional and config", () => {
    assert.equal(
      resolveDatabaseId({
        flag: "from-flag",
        positional: "from-positional",
        config: sampleConfig,
      }),
      "from-flag",
    );
  });

  it("prefers positional over config when flag is omitted", () => {
    assert.equal(
      resolveDatabaseId({
        positional: "from-positional",
        config: sampleConfig,
      }),
      "from-positional",
    );
  });

  it("uses config when flag and positional are omitted", () => {
    assert.equal(resolveDatabaseId({ config: sampleConfig }), "from-config-db");
  });

  it("returns undefined when nothing is provided", () => {
    assert.equal(resolveDatabaseId({}), undefined);
  });

  it("treats blank flag and positional as unset", () => {
    assert.equal(
      resolveDatabaseId({
        flag: "   ",
        positional: "   ",
        config: sampleConfig,
      }),
      "from-config-db",
    );
  });
});

describe("resolveOutputPath", () => {
  it("prefers flag over config", () => {
    assert.equal(
      resolveOutputPath({ flag: "./from-flag", config: sampleConfig }),
      "./from-flag",
    );
  });

  it("uses config when flag is omitted", () => {
    assert.equal(resolveOutputPath({ config: sampleConfig }), "./from-config");
  });

  it("returns undefined when flag and config are omitted", () => {
    assert.equal(resolveOutputPath({}), undefined);
  });

  it("treats blank flag as unset", () => {
    assert.equal(
      resolveOutputPath({ flag: "   ", config: sampleConfig }),
      "./from-config",
    );
  });
});

describe("resolvePageId", () => {
  it("prefers flag over config", () => {
    assert.equal(
      resolvePageId({ flag: "from-flag", config: sampleConfig }),
      "from-flag",
    );
  });

  it("uses config when flag is omitted", () => {
    assert.equal(resolvePageId({ config: sampleConfig }), "from-config-page");
  });

  it("returns undefined when flag and config are omitted", () => {
    assert.equal(resolvePageId({}), undefined);
  });

  it("treats blank flag as unset", () => {
    assert.equal(
      resolvePageId({ flag: "   ", config: sampleConfig }),
      "from-config-page",
    );
  });
});

describe("legacy env vars", () => {
  it("ignores NOTION_DATABASE_ID when resolving database id", () => {
    const previous = process.env.NOTION_DATABASE_ID;
    process.env.NOTION_DATABASE_ID = "from-env";

    try {
      assert.equal(resolveDatabaseId({}), undefined);
      assert.equal(
        resolveDatabaseId({ config: sampleConfig }),
        "from-config-db",
      );
      assert.equal(
        resolveDatabaseId({
          flag: "from-flag",
          config: sampleConfig,
        }),
        "from-flag",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NOTION_DATABASE_ID;
      } else {
        process.env.NOTION_DATABASE_ID = previous;
      }
    }
  });

  it("ignores NOTION_OUTPUT_DIR when resolving output path", () => {
    const previous = process.env.NOTION_OUTPUT_DIR;
    process.env.NOTION_OUTPUT_DIR = "./from-env";

    try {
      assert.equal(resolveOutputPath({}), undefined);
      assert.equal(
        resolveOutputPath({ config: sampleConfig }),
        "./from-config",
      );
      assert.equal(
        resolveOutputPath({ flag: "./from-flag", config: sampleConfig }),
        "./from-flag",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NOTION_OUTPUT_DIR;
      } else {
        process.env.NOTION_OUTPUT_DIR = previous;
      }
    }
  });
});
