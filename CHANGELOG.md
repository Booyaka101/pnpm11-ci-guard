# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-09-22

### Added

- **Three rules for the v11 to v12 hop.** pnpm 12.0 landed on 2026-08-26, after the
  last release here. The v10 to v11 rules are unchanged.
- **`pnpm12-resolution-only` (FAIL).** A Dockerfile `RUN` line or a workflow `run:`
  block calling `pnpm install --resolution-only`. pnpm 12 does not implement the flag
  and rejects the command with `error: unexpected argument '--resolution-only' found`,
  so the step exits non-zero. The replacement is `pnpm peers check`, which reads the
  peer dependency issues out of the lockfile and needs neither a re-resolution nor an
  install. This is the only change in pnpm 12 that stops a build rather than changing
  a result.
- **`pnpm12-unknown-workspace-setting` (FAIL or WARN).** A top-level key in
  `pnpm-workspace.yaml` that is not a pnpm setting. pnpm 11 ignored such a key without
  a word, so a misspelled `minimumReleaseAge` reads as a policy in force while it has
  never applied. Severity follows pnpm's own split: FAIL when package.json pins pnpm
  through `packageManager` or `devEngines.packageManager`, because pnpm 12 then stops
  the command with `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`, and WARN otherwise. A
  key within edit distance 2 of a real setting is named in the message. A key that is
  nowhere near one stays a warning even under a pin, so a setting introduced by a
  future pnpm never hard-fails a green pipeline.
- **`pnpm12-ssh-git-dependency` (WARN).** A dependency specified as
  `git+ssh://git@github.com/...` (or gitlab.com, or bitbucket.org). pnpm 12 resolves
  every specifier for those three hosts through the HTTPS URL and never records an SSH
  one, so an image or runner holding only an SSH deploy key loses access. The fix is
  `git config --global url."git@github.com:".insteadOf https://github.com/`. Hosts pnpm
  does not recognise keep their exact URL, and a URL carrying embedded credentials is
  left alone, so neither is flagged.
- **`src/pnpm-settings.js`**, a snapshot of the 288 settings pnpm recognises, read from
  pnpm's own recognizer on 2026-09-21 against pnpm 12.5.1, with the 30 keys pnpm
  refuses from a workspace file rather than erroring on.

### Changed

- `--help` splits its rule list into v10 to v11 and v11 to v12 sections.
- A workflow `run:` finding now points at the step that carries the command instead of
  the first line mentioning the same subcommand. This also corrects the line on a v11
  finding when one workflow runs the same pnpm subcommand twice: two `pnpm rebuild`
  steps used to be reported at the first step's line, twice.
- The clean-run summary and the job summary mention v12.
- A `packageManager` pin carrying a corepack `+sha512` hash is quoted by version alone.
- Annotation titles read `pnpm11-ci-guard: <rule>` instead of `pnpm v11: <rule>`, which was
  wrong on a v12 finding and inconsistent with the tool's own error annotations.
- The `unreadable-input` finding for a file that cannot be read or does not parse as YAML
  now comes from one builder in `src/findings.js` instead of a copy per checker. Output is
  byte-identical, verified against a recorded baseline over every fixture in both modes.

### Fixed

- **A backslash in a finding message no longer breaks the job summary table.** The cell
  escaper handled `|` but not `\`, so a message containing `\|` produced an escaped
  backslash followed by a live column break. Caught by CodeQL on the release PR.

### Not changed

- **`--fix` does not touch the new rules, deliberately.** Rewriting
  `--resolution-only` into a separate `pnpm peers check` step changes what the pipeline
  does, and inserting a git config line into someone's image is not a mechanical edit.

## [1.2.3] — 2026-08-10

### Fixed

- **`dist/action.js` rebuilt for js-yaml 5.2.3.** Dependabot bumped the dependency
  but does not regenerate the committed bundle, so the published action still
  embedded 5.2.2. Consumers pinning `@v1` were running the older parser.

## [1.2.2] — 2026-07-27

### Changed

- **`action.yml` description shortened to 125 characters** to satisfy the GitHub
  Marketplace limit (it was 209, which blocked publishing). No behaviour change.

## [1.2.1] — 2026-07-27

### Fixed

- **README action snippet moved off `actions/checkout@v4`**, three majors behind
  current. That README ships in the npm tarball, so the package page was handing
  out a stale action to anyone copying it. No code change.

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
