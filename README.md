# pnpm11-ci-guard

**pnpm's codemod migrates your config files. Nothing migrates your Dockerfile or your CI workflow — and pnpm's own guide says to do those by hand.**

`pnpm11-ci-guard` is a GitHub Action and an `npx` CLI that finds — and fixes — the
parts of a pnpm v10 → v11 migration that land in Dockerfiles and GitHub Actions
workflows, where the official `pnpm-v10-to-v11` codemod never looks.

None of these throw. `pnpm install` exits 0, the image builds, the workflow goes
green, and your configuration is silently not being used.

Since 1.3.0 it also checks the [v11 → v12 hop](#the-v11--v12-hop), including the one
change in pnpm 12 that stops a build outright.

```
=== FAIL ===
  Dockerfile: missing COPY pnpm-workspace.yaml (pnpm install at line 17)
  Dockerfile:23: `pnpm rebuild` now runs the 'rebuild' script from package.json, not the built-in (use `pnpm pm rebuild`)
  package.json: 'pnpm' field ignored by pnpm v11 — move to pnpm-workspace.yaml (found: overrides, peerDependencyRules, onlyBuiltDependencies)
=== WARN ===
  .github/workflows/ci.yml:9: env.npm_config_prefer_offline in workflow root — silently ignored (rename: pnpm_config_prefer_offline)
  Dockerfile:9: ENV npm_config_prefer_offline — silently ignored by pnpm v11 (rename: pnpm_config_prefer_offline)
  Dockerfile:18: gates build scripts but no `ENV CI=true` — v11 may prompt and hang the build
```

## Why this exists

pnpm ships an official codemod for the v11 migration, and **you should run it**:

```bash
pnpx codemod run pnpm-v10-to-v11
```

It rewrites `package.json`, `.npmrc` and `pnpm-workspace.yaml`. It does not open a
single Dockerfile or workflow file. From its own stated limitations, it "will **NOT**
do automatically" the `npm_config_*` → `pnpm_config_*` rename — while pnpm's
[migration guide](https://pnpm.io/migration) tells you to do exactly that:

> "`npm_config_*` environment variables are no longer read. Rename them to
> `pnpm_config_*` **wherever they are set (CI configs, shell profiles, Docker
> images)**."

That is the gap. Worse, running the codemod *creates* one: it writes a
`pnpm-workspace.yaml` where you had none, and pnpm v11 requires that file — so a
Dockerfile that only ever copied `package.json` and `pnpm-lock.yaml` now installs
with the wrong config, silently.

| Change | Source | Codemod covers it? |
| --- | --- | --- |
| `npm_config_*` env vars no longer read | [v11.0 notes](https://pnpm.io/blog/releases/11.0) | ❌ explicitly excluded |
| Dockerfile must `COPY pnpm-workspace.yaml` | [migration pitfalls](https://dev.classmethod.jp/en/articles/pnpm-v10-to-v11-migration-docker-ci/) | ❌ not mentioned anywhere |
| `pnpm <name>` now runs your script, not the built-in | [migration guide](https://pnpm.io/migration) | ❌ listed as a manual follow-up |
| `pnpm install -g` (no args) removed | [migration guide](https://pnpm.io/migration) | ❌ listed as a manual follow-up |
| `pnpm` field in `package.json` ignored | [v11.0 notes](https://pnpm.io/blog/releases/11.0) | ✅ — this tool just verifies it happened |

## Install

```bash
npx pnpm11-ci-guard          # no install
npm install --save-dev pnpm11-ci-guard
pnpm add -D pnpm11-ci-guard
```

Node.js ≥ 18.17. One runtime dependency (`js-yaml`).

## Usage

### Fix what can be fixed

```bash
npx pnpm11-ci-guard --fix-dry-run    # show every edit, write nothing
npx pnpm11-ci-guard --fix            # apply them, then report what's left
```

`--fix` does the rename the codemod refuses to do, in both Dockerfiles and workflow
YAML, and inserts the missing `COPY pnpm-workspace.yaml`. Real output:

```
=== FIXED === (7 edit(s) across 2 file(s), changed)
  .github/workflows/ci.yml
    - 9: npm_config_prefer_offline: 'true'
    + 9: pnpm_config_prefer_offline: 'true'
  Dockerfile
    - 9: ENV npm_config_prefer_offline=true
    + 9: ENV pnpm_config_prefer_offline=true
    + 17: COPY pnpm-workspace.yaml .

=== NEEDS A HUMAN === (3)
  Dockerfile:23: `pnpm rebuild` now runs the 'rebuild' script from package.json, not the built-in
  package.json: 'pnpm' field ignored by pnpm v11 — move to pnpm-workspace.yaml

  The 'pnpm' field is migrated by pnpm's own codemod — run:
    pnpx codemod run pnpm-v10-to-v11
```

It only ever rewrites the key token — never the value, quoting, indentation or
layout — never touches URL-scoped auth, preserves CRLF, and is idempotent. It
re-scans afterwards so what it prints is the state on disk. Run it on a clean
working tree and read `git diff`.

### CLI reference

| Option | Default | |
| --- | --- | --- |
| `--dir <path>` | `.` | Project root. A bare positional path works too. |
| `--mode <fail\|warn>` | `fail` | `warn` reports everything and always exits 0. |
| `--fix` | off | Apply safe fixes, then report the remainder. |
| `--fix-dry-run` | off | Show what `--fix` would do, without writing. |
| `--ignore <rules>` | — | Comma-separated rule ids to suppress. |
| `--json` | off | `{ fail: [...], warn: [...] }` plus context. |
| `--no-color` / `--color` | auto | `NO_COLOR` honoured. |
| `-h`/`--help`, `-v`/`--version` | | |

Exit codes: **0** clean (or `--mode warn`), **1** a FAIL exists, **2** bad usage or
an unreadable directory.

### GitHub Action

```yaml
jobs:
  pnpm-v11-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: Booyaka101/pnpm11-ci-guard@v1
        with:
          root-dir: '.'                    # optional
          mode: fail                       # optional
          ignore: docker-missing-ci-env    # optional
```

Findings become inline file+line annotations on the PR diff, plus a job-summary
table. Outputs: `fail-count`, `warn-count`, `ok`, `json`. It runs on `node24` from a
committed, self-contained `dist/action.js` — no install step, no network at runtime.
The Action never writes to your files; use the CLI for `--fix`.

## Rules

| Rule id | Sev | What it catches |
| --- | --- | --- |
| `package-json-pnpm-field` | FAIL | A `pnpm` field the codemod should have moved. Checked in the root **and** every workspace manifest. |
| `docker-missing-workspace-copy` | FAIL | Installs pnpm deps but never copies `pnpm-workspace.yaml`. Only when that file exists. |
| `shadowed-builtin-call` | FAIL | A Dockerfile or workflow runs `pnpm rebuild`/`clean`/`setup`/`deploy` **and** a script of that name exists. |
| `unsupported-global-install` | FAIL | Bare `pnpm install -g`, removed in v11. |
| `docker-npm-config-env` | WARN | `ENV`/`ARG npm_config_*` — no longer read. **Autofixable.** |
| `workflow-npm-config-env` | WARN | `env.npm_config_*` at workflow, job or step level. **Autofixable.** |
| `docker-missing-ci-env` | WARN | Project gates build scripts but the image never sets `ENV CI=true`, so v11 prompts and hangs. |
| `unreadable-input` | WARN | Malformed YAML/JSON, unreadable file — reported, never fatal. |

And for the v11 → v12 hop:

| Rule id | Sev | What it catches |
| --- | --- | --- |
| `pnpm12-resolution-only` | FAIL | `pnpm install --resolution-only` in a `RUN` line or a workflow `run:` block. pnpm 12 rejects the flag. |
| `pnpm12-unknown-workspace-setting` | FAIL / WARN | A top-level key in `pnpm-workspace.yaml` that is not a pnpm setting. FAIL when package.json pins pnpm. |
| `pnpm12-ssh-git-dependency` | WARN | A dependency reached over `git+ssh://` on GitHub, GitLab or Bitbucket. pnpm 12 resolves it over HTTPS. |

Suppress any of them with `--ignore <rule-id>`.

### `shadowed-builtin-call`, the one nothing else can find

pnpm's migration guide:

> "If your `package.json` defines a script named `clean`, `setup`, `deploy`, or
> `rebuild`, `pnpm <name>` now runs the script instead of the built-in command."

So a Dockerfile line that has rebuilt native modules for years:

```dockerfile
RUN pnpm rebuild
```

now silently runs your `rebuild` script instead. Nothing errors; the native module
is just never rebuilt, and you find out in production. Catching it needs
`package.json` and the Dockerfile read *together* — a single-file linter cannot.

Declaring such a script is **not** reported on its own. Measured across 15 real
repositories that produced 40 findings, 33 of them a `clean` script in one monorepo,
and it is harmless until something actually calls it. Only the call site is a finding.

### Never flagged: URL-scoped registry auth

```yaml
env:
  npm_config_//registry.npmjs.org/:_authToken: ${{ secrets.NPM_TOKEN }}
```

pnpm **11.6** deliberately re-added this shape. Renaming it would break working
authentication, so it is exempt everywhere, and `--fix` will not touch it.

## The v11 → v12 hop

pnpm 12 is a rewrite in Rust and keeps the commands, flags, settings and lockfile
format of pnpm 11. Seven things differ, and three of them are visible in a Dockerfile,
a workflow or a manifest.

### `pnpm install --resolution-only` is gone

```dockerfile
RUN pnpm install --resolution-only
```

pnpm 12 does not implement the flag and rejects the whole command:

```
error: unexpected argument '--resolution-only' found
```

The step exits non-zero, so this is the one pnpm 12 change that stops a build instead
of quietly changing a result. `pnpm peers check` replaces it: it reads the peer
dependency issues out of the lockfile, so it needs neither a re-resolution nor an
install.

### An unrecognized `pnpm-workspace.yaml` setting is now reported

```yaml
minimumReleasAge: 1440
```

pnpm 11 ignored a key it did not recognise without a word, so that typo reads as a
supply-chain delay policy while it has never applied once. pnpm 12 reports it, and
the severity here follows pnpm's own split:

- **FAIL** when package.json pins pnpm through `packageManager` or
  `devEngines.packageManager`. pnpm 12 stops the command with
  `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`.
- **WARN** otherwise, because pnpm 12 reports the key and carries on.

A key within edit distance 2 of a real setting is named in the message, which is the
case worth failing over. A key that is nowhere near one stays a warning **even under a
pin**, so a setting introduced by a pnpm newer than this tool never hard-fails a green
pipeline. The known-setting list lives in `src/pnpm-settings.js` and carries the date
it was taken.

Kebab-case spellings (`node-linker`) are recognised, a key with no value is skipped,
and `$schema` is exempt, all matching what pnpm does.

### A `git+ssh://` dependency resolves over HTTPS

```json
"@acme/design-tokens": "git+ssh://git@github.com/acme/design-tokens.git"
```

For GitHub, GitLab and Bitbucket, a pnpm 12 specifier says which repository you want,
not how to reach it. Every form resolves through the host's HTTPS URL and the lockfile
never records an SSH one, so an image or runner holding only an SSH deploy key loses
access. Keep SSH transport by telling git to rewrite the URL:

```bash
git config --global url."git@github.com:".insteadOf https://github.com/
```

Hosts pnpm does not recognise keep their exact URL, and a URL carrying embedded
credentials is kept as written, so neither is flagged.

### `--fix` is deliberately not extended to these

`--fix` still repairs only the three v10 → v11 rules it always did. Rewriting
`--resolution-only` into a separate `pnpm peers check` step changes what the pipeline
does, not just how it is spelled, and inserting a `git config` line into someone's
image is not a mechanical edit. Both are reported under **NEEDS A HUMAN** with the
exact replacement to paste.

## JSON output

```bash
npx pnpm11-ci-guard --json
```

```jsonc
{
  "ok": false,
  "version": "1.1.0",
  "tool": "pnpm11-ci-guard",
  "mode": "fail",
  "ignored": [],
  "suppressed": 0,
  "hasWorkspaceYaml": true,
  "scanned": { "dockerfiles": 1, "workflows": 1, "packageJsons": 1 },
  "summary": "3 fail, 7 warn — scanned 1 Dockerfile(s), 1 workflow(s), 1 package.json file(s) (pnpm-workspace.yaml present).",
  "fail": [
    {
      "severity": "fail",
      "rule": "docker-missing-workspace-copy",
      "file": "Dockerfile",
      "line": 17,
      "context": "RUN pnpm install",
      "message": "FAIL: Dockerfile: installs pnpm deps but does not COPY pnpm-workspace.yaml (required by pnpm v11) — add: COPY pnpm-workspace.yaml .",
      "short": "Dockerfile: missing COPY pnpm-workspace.yaml (pnpm install at line 17)",
      "fix": "Add `COPY pnpm-workspace.yaml .` before the pnpm install step",
      "docs": "https://dev.classmethod.jp/en/articles/pnpm-v10-to-v11-migration-docker-ci/"
    }
  ],
  "warn": [ /* … */ ],
  "exitCode": 1
}
```

With `--fix`, a `fixed` object is added listing every edit and anything skipped.

## Programmatic API

```js
const { scan, formatText } = require('pnpm11-ci-guard');

const result = scan({ dir: './my-app', mode: 'warn', ignore: ['docker-missing-ci-env'] });
console.log(result.fail.length, result.warn.length);
```

`scan` throws a `ScanError` (`.code` of `NO_DIR`, `NOT_A_DIR`, `NO_ACCESS`,
`BAD_MODE`, `BAD_RULE`) for unusable input, and never throws for unusable *content*
— a malformed file becomes an `unreadable-input` WARN.

## Validated against real repositories

No rule ships without being measured on real public repositories. The v10 to v11
rules were measured on 15 of them (38 Dockerfiles, 55 workflow files, 127
`package.json` manifests): **9 FAIL + 12 WARN, every finding manually confirmed
against the source, zero false positives.** Real bugs found:

- a `publish` step setting `NPM_CONFIG_REGISTRY` — that release publishes to the
  default registry under v11;
- `ENV npm_config_build_from_source=true` directly above `RUN pnpm install` in a
  project with a native `better-sqlite3` dependency — under v11 the flag is ignored,
  a prebuilt binary is installed instead of one compiled against musl, and nothing
  fails until runtime;
- three projects that install pnpm deps without copying `pnpm-workspace.yaml`;
- eight projects that gate build scripts but never set `ENV CI=true` in the image.

That corpus is also what shaped the rules. Three design choices survived it:
treating `COPY . .` as satisfying the workspace requirement (avoided 3 false
positives) **but only when it precedes the install** (preserved 2 true positives);
case-insensitive filename and key matching (caught lowercase `dockerfile.prod` and
upper-case `NPM_CONFIG_REGISTRY`); and requiring build-script gating before warning
about `ENV CI=true` (cut that rule from firing on 14 of 14 Dockerfiles down to 9
genuine cases). Two candidate rules were measured and then cut or narrowed for
noise — see [CHANGELOG.md](CHANGELOG.md).

### The v11 to v12 rules

Those three were measured on a larger corpus for 1.3.0: 20 repositories that all use
pnpm (vite, vue core, nuxt, astro, SvelteKit, vitest, unocss, vueuse, element-plus,
slidev, prisma, TanStack query, storybook, shadcn/ui, pnpm itself, nitro, n8n,
directus, immich, nocodb), covering 26 Dockerfiles, 377 workflow files and 588
manifests. **They fire zero times there.** That measures noise, not usefulness: these
are well-maintained projects and nine of them are already on pnpm 12. What the corpus
does establish:

- 19 `pnpm-workspace.yaml` files between them use 64 distinct top-level settings, and
  the snapshot in `src/pnpm-settings.js` recognises all 64. No false alarms.
- 18 of the 20 pin pnpm through `packageManager`, so the hard-failing branch of
  `pnpm12-unknown-workspace-setting` is the common case in the wild, not the corner.
- The one `git+ssh://git@github.com:…` URL in the corpus is nocodb's `repository.url`.
  It is correctly left alone, because the rule reads the dependency maps rather than
  grepping the file.

Since none of the twenty carry the patterns, each rule was also measured against
repositories that do, found through code search:

- `--resolution-only` in a Dockerfile: `paperclipai/paperclip` has it in
  `docker/daytona-runner/Dockerfile`, halfway through a five-line `RUN … \` chain.
  Run unmodified against that repo's real files, the tool reports `Dockerfile:32`.
- `git+ssh://git@github.com` in a `package.json`: 97 real manifests that all contain
  that string were scanned. Three have it in a dependency map (7 dependencies across
  them, all correctly flagged). In the other 94 it sits in `repository.url` or `bugs`,
  where pnpm never resolves it, and none of the 94 are reported. A file-wide regex
  would have produced 94 false positives.

## Try it

```bash
npx pnpm11-ci-guard --dir examples/broken-project   # 3 fail, 7 warn → exit 1
npx pnpm11-ci-guard --dir examples/clean-project    # clean          → exit 0
npx pnpm11-ci-guard --dir examples/v12-project      # 3 fail, 1 warn → exit 1
```

## Limitations

- **Static analysis only.** It reads files; it never runs pnpm, Docker, or your
  workflow. It cannot see env vars injected by a runner, an org secret, a
  `docker build --build-arg`, or an `.npmrc`.
- **Discovery is by filename** (`Dockerfile`, `Dockerfile.*`, `*.dockerfile`,
  case-insensitive). A Dockerfile named something else is missed.
- **Workflows must live under `.github/workflows/`.** Composite actions and
  reusable-workflow `env:` blocks elsewhere are not scanned.
- **`docker-missing-workspace-copy` is per-file, not per-build-stage.** A COPY in an
  earlier stage that precedes the install counts. This favours false negatives.
- **`shadowed-builtin-call` only sees literal call sites.** `pnpm $CMD` or a script
  that shells out indirectly is invisible to it.
- **Only the top-level keys of `pnpm-workspace.yaml` are checked.** Their values are
  not validated, and nested keys are not looked at.
- **The known-setting list is a snapshot**, taken on 2026-09-21 against pnpm 12.5.1.
  A setting added by a later pnpm is unknown to this tool, which is exactly why a key
  that is not a near-miss of a known one is never more than a warning.
- **`--fix` does not migrate the `pnpm` field.** pnpm's codemod already does that
  properly, including `.npmrc` and workspace packages; duplicating it would be worse.

## Development

```bash
npm install
npm run build     # regenerate the self-contained dist/action.js
npm test          # node --test — 108 tests, no test-framework dependency
```

`dist/action.js` is a committed build artifact. A test asserts it is byte-identical
to a fresh build, so a stale bundle fails CI.

## Related

[**npm-script-lens**](https://github.com/Booyaka101/npm-script-lens) audits what a
dependency's install scripts actually *do* (exec / network / filesystem) before you
approve them, and writes the approved set into `pnpm-workspace.yaml` as `allowBuilds`.

The two hand off directly: once you have an `allowBuilds` allowlist, a `pnpm install`
inside Docker will prompt for approval and hang the build unless the image sets
`ENV CI=true` — which is exactly what this tool's `docker-missing-ci-env` rule
catches. Use lens to decide *what may build*, and this to make sure your image and CI
still work once you have decided.

## License

MIT © Booyaka101

## References

- [pnpm v10 → v11 migration guide](https://pnpm.io/migration) — the manual follow-ups this tool automates
- [pnpm v11.0 release notes](https://pnpm.io/blog/releases/11.0) — the breaking changes
- [pnpm 11.6 release notes](https://pnpm.io/blog/releases/11.6) — URL-scoped registry auth env vars
- [`pnpm-v10-to-v11` codemod](https://app.codemod.com/registry/pnpm-v10-to-v11) — run this too; it covers what this tool does not
- [What's different in pnpm 12](https://pnpm.io/blog/whats-different-in-pnpm-12) — the removed flag and the git dependency change
- [pnpm v12.0 release notes](https://pnpm.io/blog/releases/12.0) — unrecognized workspace settings
- [4 pitfalls migrating pnpm v10 → v11 in Docker/CI](https://dev.classmethod.jp/en/articles/pnpm-v10-to-v11-migration-docker-ci/)
