# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-07-27

Everything this repo depends on is now on its current major, and kept there
automatically rather than by memory.

### Changed

- **js-yaml 4 → 5.2.2.** The parsing API used here (`load`, `err.mark.line`,
  `err.reason`) is unchanged; all 93 tests pass untouched. js-yaml 5 renamed its
  CommonJS bundle to `dist/js-yaml.cjs.js`, so `scripts/build-action.js` now probes
  both layouts, verifies whichever it finds pulls in nothing external before inlining
  it, and strips the sourcemap comment that would otherwise dangle in `dist/action.js`.
- **`actions/checkout` v4 → v7**, **`actions/setup-node` v4 → v7** in CI.
- **CI matrix adds Node 26**, now ubuntu + windows × node 18/20/22/24/26.

### Added

- **`.github/dependabot.yml`** — weekly grouped updates for npm and github-actions,
  so this does not go stale again.

### Not changed

- `runs.using: node24` in `action.yml`. Verified against GitHub's metadata-syntax
  reference: `node20` and `node24` are the only JavaScript action runtimes, so this
  is already the newest available. There is no `node26`.

## [1.1.0] — 2026-07-27

Repositioned around the gap pnpm's own tooling leaves open, after confirming that
the official `pnpm-v10-to-v11` codemod exists, covers `package.json`/`.npmrc`/
`pnpm-workspace.yaml`, and explicitly declines the `npm_config_*` → `pnpm_config_*`
rename that the migration guide tells you to perform "wherever they are set (CI
configs, shell profiles, Docker images)".

### Added

- **`--fix` / `--fix-dry-run`** — performs that rename in Dockerfiles and workflow
  YAML, and inserts the missing `COPY pnpm-workspace.yaml`. Rewrites only the key
  token, never URL-scoped auth, preserves CRLF, idempotent, and re-scans afterwards
  so the report reflects disk. Deliberately does **not** migrate the `pnpm` field —
  it points at pnpm's codemod instead.
- **`shadowed-builtin-call`** (FAIL) — a Dockerfile or workflow runs
  `pnpm rebuild`/`clean`/`setup`/`deploy` while a script of that name exists, so the
  call silently changed meaning in v11. Requires reading `package.json` and the
  Dockerfile together.
- **`unsupported-global-install`** (FAIL) — bare `pnpm install -g`, removed in v11.
- **`docker-missing-ci-env`** (WARN) — the project gates dependency build scripts but
  the image never sets `ENV CI=true`, so v11 prompts and hangs the build.
- **`--ignore <rules>`** CLI flag and `ignore` Action input, so one noisy rule cannot
  force a team to drop the whole tool.
- `ignored` / `suppressed` in the JSON payload.

### Changed

- README now leads with the codemod relationship and tells users to run the codemod.
- `docker-missing-ci-env` requires the project to actually gate build scripts
  (`allowBuilds` / `onlyBuiltDependencies` / … in `package.json#pnpm` or
  `pnpm-workspace.yaml`). Measured unconditionally it fired on **14 of 14** real
  Dockerfiles; gated, it fires on 9 genuine cases.
- pnpm invocations are now parsed rather than regex-matched, so `pnpm import`,
  `pnpm run install-deps`, `corepack pnpm i` and `--mount=…` prefixes are all
  classified correctly.

### Removed

- **`shadowed-builtin-script`** — reporting a script merely *named* `clean`/`rebuild`
  produced 40 findings across 15 real repos, 33 of them a `clean` script in a single
  monorepo, and it is harmless until something calls it. The declaration is now only
  used to qualify `shadowed-builtin-call`.

## [1.0.0] — 2026-07-27

First release.

### Added

- **Detection 1** — `ENV`/`ARG npm_config_*` in Dockerfiles (`WARN`), reported with
  the exact physical line and the `pnpm_config_*` rename. Understands backslash
  continuations, multiple assignments per instruction, the legacy `ENV KEY value`
  form, `# escape=` parser directives and upper-case `NPM_CONFIG_*`.
- **Detection 2** — `env.npm_config_*` in `.github/workflows/*.yml` (`WARN`), walked
  at workflow root, job and step level, naming the job or step in the message.
- **Detection 3** — a top-level `pnpm` field in `package.json` (`FAIL`), listing the
  keys found. Checks workspace package manifests as well as the root, and tracks
  brace depth so a `"pnpm"` devDependency is not mistaken for the field.
- **Detection 4** — a Dockerfile that runs `pnpm install`/`pnpm i` without copying
  `pnpm-workspace.yaml` (`FAIL`), only when that file exists at the project root.
  A `COPY . .` or a multi-file COPY naming the file satisfies it, but only when it
  precedes the install.
- **Exemption** — `npm_config_//…` URL-scoped registry auth is never flagged; pnpm
  11.6+ still reads it.
- CLI: `npx pnpm11-ci-guard [--dir path] [--json] [--mode fail|warn] [--color] [--help] [--version]`.
- GitHub Action (`runs.using: node24`) with `root-dir` and `mode` inputs;
  `fail-count`, `warn-count`, `ok` and `json` outputs; inline file/line annotations
  and a job-summary table.
- Self-contained `dist/action.js` bundle (js-yaml inlined) built by
  `npm run build`, with a test asserting the committed copy is not stale.
- `examples/broken-project` and `examples/clean-project` for a before/after demo.

[1.0.0]: https://github.com/Booyaka101/pnpm11-ci-guard/releases/tag/v1.0.0
