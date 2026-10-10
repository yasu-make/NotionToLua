# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Multi-level relations (`relation_depth`)** — Set `relation_depth` in `[emit]` (or `[targets.<key>.emit]`) to embed Relation columns of related databases, two or more levels deep. Generated `export type` definitions nest accordingly. The default `1` keeps the previous behavior. See [docs/nested-relations.md](./docs/nested-relations.md#multi-level-nesting-relation_depth).

### Fixed

- **`[Skip]` Relation columns** — Relation columns whose names start with `[Skip]` are no longer embedded.
- **Relation types with empty last record** — Relation entry types are now derived from the related database schema, so a record with an empty relation no longer collapses the type to `{ [string]: string }`.

## [0.7.0] - 2026-08-23

### Added

- **Named targets** — Configure multiple database/output pairs as `[targets.<key>]` and run `ntn-lua <key>`, or `ntn-lua` with no key to generate every target. Optional `[targets.<key>.emit]` overrides global `[emit]` for that target.
- **Skip prefix `[Skip]`** — Notion columns whose names start with `[Skip]` are not emitted to Luau, so you can keep documentation-only fields in the database.

### Changed

- **`ntn-lua init` template** — Writes `[targets.example]` plus `[emit]` instead of a single `[source]` / `[paths]` pair. Legacy sectioned and flat configs remain readable; mixing `[targets]` with `[source]` / `[paths]` is rejected.

### Fixed

- **Optional types** — Properties with null/empty cells on some records now emit `T?` even when `empty_value = "nil"`.

## [0.6.0] - 2026-08-11

### Added

- **Select/status/multi-select literal unions** — When `export_types = true`, generated entry types use string literal unions derived from actual record values for `select`, `status`, and `multi_select` properties, including relation-embedded scalar and nested entry fields.

## [0.5.0] - 2026-07-29

### Added

- **Array relations (`BaseName [Array]`)** — Relation columns with numeric related Titles are sorted and emitted as dense Luau arrays. Push creates a related database and renumbers titles to `"1".."N"`. See [docs/nested-relations.md](./docs/nested-relations.md).
- **`omit_array_index`** — When all top-level record Titles are numeric and form a dense `1..N` sequence, generated modules can omit `[n]` keys and emit a keyless Luau array with `export type Module = { Entry }`. Non-dense or non-1-based sequences fall back to keyed `[n]` output with no warning.

### Changed

- **`ntn-lua.toml` section layout** — `ntn-lua init` now writes grouped sections: `[source]` (`database_id`, `code_block_parent_page_id`), `[paths]` (`output`), and `[emit]` (`format`, `export_types`, `empty_value`, `empty_relation`, `omit_array_index`). Flat root keys remain supported for backward compatibility; mixing flat keys with section tables is rejected.
- **`code_block_parent_page_id`** — Replaces `page_id` in the init template and sectioned config. Flat `page_id` at the root is still accepted; setting both page keys is an error.
- **`ntn-lua init` template** — Generates a template with default values instead of a commented-only template.
- **Numeric record Titles** — Top-level Titles that match the same numeric rules as array relations (`0`, `1`, `12` OK; `01`, negatives, and decimals NG) are always emitted as numeric Luau indexes (`[1]`, not `["1"]`) in module values. Module types use `[number]: Entry` instead of literal `[1]:` keys. When every record Title is numeric, records are sorted numerically.
- **Typed Rich Text columns** — Notion Rich Text properties named `BaseName [TypeName]` (for example `Position [Vector3]`) are converted to Roblox values on pull and serialized back on push. Supported types: Vector2, Vector3, Color3, UDim, UDim2, Rect, NumberRange, CFrame. Invalid cells fall back to string with a warning. See [docs/typed-rich-text.md](./docs/typed-rich-text.md).

### Fixed

- macOS release binaries are ad-hoc signed after compile so Gatekeeper accepts them on Apple Silicon and Intel Macs.

## [0.4.0] - 2026-07-26

### Added

- **`ntn-lua init`** — Create `ntn-lua.toml` in the current directory from a commented template.
- **`ntn-lua push`** — Create a new Notion database from a local `.luau` ModuleScript. Infers schema from flat property values (number, checkbox, rich text, multi-select) and inserts records. Nested relation dictionaries are not supported in v1.

### Changed

- Setup no longer requires copying example files. Document `.env` contents in README; generate `ntn-lua.toml` with `ntn-lua init`.

## [0.3.0] - 2026-07-26

### Breaking

- **Relation columns are embedded automatically** as Luau dictionaries. In v0.1.x, Relation columns were skipped. Databases with Relation columns now emit nested tables (for example `{ Fire = 10, Ice = 5 }`). Related databases must be shared with your Notion integration. Duplicate related Titles and circular relations are errors. Embed depth is limited to one level.
- **Configuration moved to `ntn-lua.toml`.** Environment variables `NOTION_DATABASE_ID` and `NOTION_OUTPUT_DIR` were removed. The `--no-format` CLI flag was removed; use `format = false` in `ntn-lua.toml`.
- **Note:** v0.2.0 was never published. The Bun toolchain migration and TOML configuration changes are included in this release.

### Added

- Nested dictionary support via Notion Relations — scalar collapse (`{ [string]: number }`) when the related database has one exportable column, or nested tables when it has two or more. See [docs/nested-relations.md](./docs/nested-relations.md).
- Global `empty_value` setting (`omit`, `nil`, `empty_string`) for missing property values.
- Global `empty_relation` setting (`omit`, `empty_table`) for Relation columns with no linked records.
- `docs/nested-relations.md` — database design guide and configuration reference.

### Changed

- Development toolchain migrated to [Bun](https://bun.sh) (standalone release binaries unchanged for Rokit users).
- Release artifacts built with `bun build --compile`.

## [0.1.1] - (previous release)

- Initial Rokit distribution and StyLua formatting.

## [0.1.0] - (previous release)

- Initial release.
