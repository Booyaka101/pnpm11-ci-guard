# PROGRESS — pnpm11-ci-guard

**Status: v1.2.2 SHIPPED — fully distributed.** Last updated: 2026-07-27.

| Channel | State |
| --- | --- |
| npm | **live** — https://www.npmjs.com/package/pnpm11-ci-guard @ **1.2.2** (`npx pnpm11-ci-guard` verified from the registry) |
| GitHub | **live** — https://github.com/Booyaka101/pnpm11-ci-guard (`v1.2.2` + moving `v1`) |
| Release | **live** — https://github.com/Booyaka101/pnpm11-ci-guard/releases/tag/v1.2.2 |
| Actions Marketplace | **listed** (owner confirmed) |
| CI | **green** — 10/10 matrix (ubuntu+windows × node 18/20/22/24/26), plus the dogfood job and the Guards job |
| Docs PR to pnpm | **APPROVED, awaiting merge** — https://github.com/pnpm/pnpm.io/pull/845 |
| Launch post | **held deliberately** until the pnpm PR merges — see below |

The pnpm PR was reviewed (CodeRabbit), one real contradiction found and fixed —
`migration.md` said Docker images "must" copy the file while `docker.md` said it
could be omitted — and it is now approved. Its only red check is Vercel's preview
deploy, which a pnpm team member has to authorize for outside contributors.

### Marketplace publishing: what actually blocked it

Worth recording, because the error is not discoverable until you try:

- **`action.yml` `description` must be under 125 characters.** Ours was 209 and
  GitHub refused with *"Your action.yml needs changes before it can be published"*.
  Fixed in 1.2.1/1.2.2 (now 106). ghas-free-pack hit the same wall at 264.
- **GitHub caches that validation.** After fixing and re-tagging, the checkbox still
  refused to tick until a hard reload (`Page.reload {ignoreCache:true}`).
- The release form's Marketplace section is **hidden at phone-width viewports**
  (~390px), which is its own source of "I can't find the checkbox".

### Launch: held on purpose

pnpm11-ci-guard has **not** been announced. That is deliberate: the strongest
opening is "I found and fixed the gap in pnpm's own migration guide", which needs
PR #845 merged first. Copy is ready to adapt from `ghas-free-pack/docs/LAUNCH.md`.

---

## Phase 0 — external resource verification (all PASS, nothing BLOCKED)

| Claim | Source | Result |
| --- | --- | --- |
| `npm_config_*` env vars dropped in v11 | https://pnpm.io/blog/releases/11.0 | PASS — *"pnpm no longer reads `npm_config_*` environment variables. Use `pnpm_config_*` instead"* |
| `pnpm` field in package.json ignored | https://pnpm.io/blog/releases/11.0 | PASS — *"pnpm no longer reads the `pnpm` field in `package.json`"* |
| `pnpm-workspace.yaml` now required | https://dev.classmethod.jp/en/articles/pnpm-v10-to-v11-migration-docker-ci/ | PASS — Pitfall 2 |
| `npm_config_//…` auth still read (11.6+) | https://pnpm.io/blog/releases/11.6 | PASS — justifies the exemption |
| `runs.using: node24` valid | docs.github.com metadata-syntax | PASS |
| Cost | — | PASS — Node + js-yaml. No key, account or hosting. $0. |

### Phase 0b — the "already solved" audit (added for v1.1.0)

Run because LESSONS.md #30 says this check kills more ideas than anything else and
is free. It found something material:

- **An official `pnpm-v10-to-v11` codemod exists** and covers `package.json`,
  `.npmrc` and `pnpm-workspace.yaml` — including moving the `pnpm` field.
- **It explicitly does NOT do** the `npm_config_*` → `pnpm_config_*` rename
  (stated limitation), while the migration guide says to do it *"wherever they are
  set (CI configs, shell profiles, Docker images)"*.
- It never opens a Dockerfile or a workflow file.
- It has **no guidance at all** about `COPY pnpm-workspace.yaml` in Docker — and by
  creating `pnpm-workspace.yaml` where none existed, running it *arms* that problem.
- The guide's manual follow-up list also yielded two more real rules: shadowed
  built-in commands and bare `pnpm install -g`.
- No competing npm package (`pnpm11-ci-guard` and four variants all 404).

**Conclusion: not already solved — the vendor documents the gap and declines to
fill it.** The product was repositioned around exactly that, and `--fix` was added
to close it.

---

## What is VERIFIED working

- **8 rules**, all measured on real repositories before shipping.
- **`--fix`**, verified on a real third-party repo (`pboersma/hypersolid-raffle`),
  producing a minimal correct 2-line diff. Renames only the key token, never
  URL-scoped auth, preserves CRLF, idempotent, re-scans afterwards.
- **Real-world corpus (15 public repos, 38 Dockerfiles, 55 workflows, 127
  manifests): 9 FAIL + 12 WARN, every finding hand-confirmed, zero false
  positives.**
- **Rules cut/narrowed by that measurement** (this is the important part):
  - `shadowed-builtin-script` **removed** — 40 findings, 33 of them a `clean` script
    in one monorepo. The declaration is now only used to qualify the call-site rule.
  - `docker-missing-ci-env` **gated** on the project actually declaring
    `allowBuilds`/`onlyBuiltDependencies` — was firing on 14 of 14 Dockerfiles,
    now 9 genuine cases (verified: TypeWords and verdaccio both declare
    `allowBuilds:` and set no `CI` env).
- **CLI**: `--dir`, positional dir, `--json`, `--mode`, `--fix`, `--fix-dry-run`,
  `--ignore`, `--color`/`--no-color`/`NO_COLOR`, `--help`, `--version`. Exit 0/1/2.
- **GitHub Action**: `root-dir`, `mode`, `ignore` inputs; `fail-count`, `warn-count`,
  `ok`, `json` outputs; `::error`/`::warning` annotations with file+line; job-summary
  table; exits 1. Driven with real GitHub env vars. The Action never writes files.
- **Self-contained bundle**: js-yaml inlined; a test asserts the committed
  `dist/action.js` is byte-identical to a fresh build.
- **Clean-path install** (verified at 1.1.0 and again at 1.2.x): `npm pack` → fresh folder → relative tarball →
  `--version`, `require()` and `--fix` all verified. Root manifest unpolluted.
- **Tests**: 93, `npm test`, all passing, no test-framework dependency.
- **Reality handling**: missing dir → exit 2 with a message; malformed JSON/YAML →
  WARN and continue; unreadable dirs, broken symlinks, symlink loops, BOMs,
  unwritable `GITHUB_OUTPUT`, empty dirs, `node_modules` exclusion.

---

## The 8-point bar

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Feature-complete; no TODO/FIXME on any user path | **MET** — asserted by a test |
| 2 | No mocks/placeholders/fake data | **MET** — fixtures only in `test/fixtures/`, samples only in labelled `examples/` |
| 3 | Real end-to-end run on real input | **MET** — 15 real repos scanned; `--fix` applied to a real repo and diffed |
| 4 | Handles reality | **MET** — no network calls exist, so no rate-limit path |
| 5 | Tests + command | **MET** — `npm test`, 93 passing |
| 6 | Publish-ready packaging | **MET** — clean-path install verified; Marketplace-legal `action.yml` |
| 7 | README a stranger can follow | **MET** — leads with the codemod relationship |
| 8 | Coherent release | **MET** — 1.2.2 + CHANGELOG documenting what was cut and why |

**Nothing is unmet.**

---

## Shipped 2026-07-27 — full day's record

This project shipped alongside a portfolio-wide pass. Recorded here because the
portfolio work was driven from this repo and several findings came out of it.

### npm — every package in sync with its repo (verified against the registry)

| Package | Version | What shipped today |
| --- | --- | --- |
| `pnpm11-ci-guard` | **1.2.2** | new product; `--fix`; 4 new rules; Marketplace-legal description |
| `ghas-free-pack` | **v1.0.0** (Action, no npm pkg) | new product, first publish |
| `npm-script-lens` | **1.4.0** | MCP dual-era handshake fix |
| `@booyaka/mcp-vet` | **0.8.0** | Windows libuv crash fix; chalk dropped; `engines >=22` |
| `ts7-compat-guard` | **2.2.0** | two new rules found by real upgrades |
| `cargo-witness` | **1.2.1** | ESM-only `node-fetch` removed (−40 packages) |
| `grok-loop-kit` | **1.1.0** | `engines >=20` corrected |
| `mcp-app-debug` | **0.2.0** | released work stranded on main since 0.1.0 |
| `grokscope` / `gemcatch` | 1.3.0 / 0.3.0 | unchanged, CI + deps refreshed |

### Other channels

- **VS Code Marketplace** — `Booyaka101.npm-script-lens` **1.3.0** live. Note the
  publisher resolves with a capital **B**. Verified via `vsce show` and the gallery
  API (VSIX asset present), *not* by trusting `vsce`'s `DONE` line — see below.
- **GitHub Actions Marketplace** — 6 actions listed.
- **dev.to** — ghas-free-pack article published.
- **X** — ghas-free-pack announce, read back verbatim from the permalink.

### Portfolio-wide engineering

- **11 repos green**, zero open Dependabot PRs.
- **Dependabot on every repo**, `minor`+`patch` grouped and **majors isolated** —
  the original `patterns:['*']` grouping mixed breaking majors with safe patches so
  one bad upgrade reddened the whole batch and nothing was mergeable.
- **Guards workflow everywhere**: pnpm11-ci-guard on all, npm-script-lens where a
  lockfile exists, ts7-compat-guard where a tsconfig exists, mcp-vet on the two
  repos that ship MCP servers, ghas-free-pack where Shell/Docker/TF/PHP exist.
- **Actions on latest**: `checkout` v4→**v7**, `setup-node` v4→**v7**, plus
  setup-python/cache/upload-artifact/deploy-pages/codeql-action; node 26 added.
- **star-watch fixed** — it watched only grokscope (0 stars) while 4 other repos
  quietly collected 5. Now enumerates all 33 repos from one place.

### npm v12 allowScripts decisions recorded (4 repos)

npm v12 does not run dependency install scripts unless `allowScripts` lists them,
so a repo with a native dependency and no allowlist installs "successfully" and
then fails at `require` time. Four repos were in that state. Each HIGH package was
reviewed on its behaviour *and* its publisher signals before approval:

| Repo | Approved | Why it was safe to approve |
| --- | --- | --- |
| gemi-research-daemon | `better-sqlite3@12.11.1` | 8.8M dl/wk, provenance ✓ — `node-gyp rebuild` is its job |
| cargo-witness | `better-sqlite3@13.0.1` | same, but ⚠️ published 6 days ago — recency flagged, provenance ✓ |
| ts7-compat-guard | `esbuild@0.28.1` | 261M dl/wk, provenance ✓ |
| grok-loop-kit | `esbuild@0.27.7` (via tsup) | same |

Version-pinned deliberately: approval does not carry to a version nobody has
looked at, which is exactly what a hijacked release exploits. `npm-script-lens
review` now reports **nothing pending** in all four, and `sync --check` passes.

**Enforcement added**: every Guards workflow now runs
`npm-script-lens sync --path . --check`, which exits 1 when a dependency gains an
install script nobody approved. An allowlist nothing enforces is decoration.

### Bugs found by dogfooding our own tools

- `mcp-vet` on **our own** MCP server → BREAKING: `initialize` handler removed in the
  2026-07-28 spec. Fixed as **dual-era** (both revisions work) rather than deleting
  the handler, which would have satisfied the linter and broken every live client.
- `ts7-compat-guard` reported three repos clean that then failed to build on TS 7.
  Both causes are now rules in it: missing tsconfig `types` and `tsup`'s Compiler-API
  declaration emit.
- TypeScript 7 upgrades for `mcp-vet` and `grok-loop-kit` are **blocked upstream**
  (`ts-morph`, `tsup`). Closed with reasons + a Dependabot `ignore` on that major.

### Committed action bundles — coupling audit (all 3 repos)

`ts7-compat-guard` went red three times in one day, always on `bundle-drift`:
the tsconfig-types rule, the allowScripts commit, and the drift-gate commit. I
rebuilt `dist/` reactively each time before noticing three occurrences is a cause,
not three incidents.

**Cause**: `src/action.js` had `require('../package.json').version`, and **esbuild
inlines the entire manifest** when it sees that. So an `allowScripts` entry — which
has nothing to do with the Action — changed `dist/action.js`. Fixed by injecting the
version via esbuild's `define` (`scripts/build.mjs`), making the bundle a pure
function of the source.

Only three repos commit a build artifact. Each was then probed the same way — add a
throwaway `package.json` field, rebuild, byte-compare `dist/` — which works
regardless of bundler:

| Repo | Bundler | Result |
| --- | --- | --- |
| `ts7-compat-guard` | esbuild | **was coupled — fixed**, verified byte-identical after the probe |
| `pnpm11-ci-guard` | hand-rolled | decoupled; inlines only `{name, version}` by design |
| `cargo-witness` | ncc | decoupled; source never requires the manifest |

A version bump *does* still change these bundles, which is correct — that is real
coupling, not accidental.

**Two of my own mistakes surfaced here, both worth not repeating:**

- An earlier "cargo-witness dist is clean" check was **invalid**: I ran `npm run
  build`, but that repo's script is `build:action`. npm errored, nothing rebuilt, and
  I read the silence as a pass.
- I reported cargo-witness's drift warning "fires on every run". It never has —
  **zero warning annotations**. I was grepping the CI log for the warning text, but a
  workflow's `run:` command is echoed into the log, so I matched the
  `echo "::warning::…"` string in the command itself rather than its output. This is
  the same shape as GitHub's hidden pre-rendered error templates on the release page,
  which caught me earlier the same day. **Assert on emitted output or annotations,
  never on text that also appears in the source being executed.**

That correction unlocked the actual improvement: cargo-witness's bundle check was
warning-only on the assumption ncc output varies across platforms. Measured — a
Linux build (`docker node:24`, ncc 0.44.1 from the lockfile) is **byte-identical** to
the Windows-committed bundle. It is now a hard failure, matching the other two. The
originally-requested fix (move the build to Linux) turned out to be unnecessary.

### Process lessons worth keeping

- **A zero exit code is not evidence.** `vsce publish` printed `DONE Published` while
  the extension never reached the gallery. `scripts/preflight.mjs` in
  `npm-script-lens/editors/vscode` now checks the publisher resolves before a token is
  used, and publication is confirmed via `vsce show`, not the CLI's own success line.
- **Stale `node_modules` fakes a green test run.** cargo-witness passed locally only
  because a CommonJS `node-fetch@2` lingered while `package.json` declared ESM-only
  v3. Verify dependency fixes from a clean `rm -rf node_modules && npm ci`.
- **Read the exit code before theorising.** The mcp-vet Windows failure looked like a
  flaky test; `3221226505` (0xC0000409) showed it was a libuv assertion crash.
- **Never grep a CI log for the text of the command that produced it.** A workflow's
  `run:` block is echoed into the log verbatim, so searching for
  `echo "::warning::…"` matches the command, not the warning. Check annotations or
  step conclusions instead. Same trap as GitHub's hidden pre-rendered `.flash-error`
  templates — both cost time on 2026-07-27.
- **Three occurrences is a cause, not three incidents.** `bundle-drift` was rebuilt
  reactively three times before the shared root cause was looked for.
- **Verify a "clean" check actually ran.** `npm run build` on a repo whose script is
  `build:action` errors silently under `>/dev/null 2>&1` and looks like a pass.

**Open — pnpm/pnpm.io#845.** The PR fixes pnpm's own v11 Dockerfile example, which
copies `package.json` and `pnpm-lock.yaml` but not `pnpm-workspace.yaml` — so it
teaches the exact pattern this tool's `docker-missing-workspace-copy` rule flags. It
contains **no mention of this tool**; a docs PR that plugs the author's product gets
rejected and deserves to. If maintainers prefer a `pnpm-workspace.yaml*` glob so the
example stays copy-pasteable for projects without the file, that alternative is
already offered in the PR body.

## Next

**Nothing is blocked on engineering.** The one open thread is external:
**pnpm/pnpm.io#845** is approved and awaiting a maintainer merge. When it lands,
that is the cue to publish the pnpm11-ci-guard launch post — the "I fixed the gap in
pnpm's own migration guide" opening is worth waiting for.

### If you want a next release

- **SARIF output**, to match `ts7-compat-guard`, `cargo-witness` and `ghas-free-pack`.
  Deliberately deferred: it serves code-scanning dashboards, not the migrating dev who
  is the actual user. Do it when someone asks — that ask is the signal.
- `--fix` for `ENV CI=true` (changes build behaviour, so it stays a human call).
- Composite actions and reusable-workflow `env:` outside `.github/workflows/`.

### Watch for

- **TypeScript 7 unblocking.** When `ts-morph` and `tsup` support the native
  compiler, drop the `typescript` major `ignore` from mcp-vet's and grok-loop-kit's
  `dependabot.yml` and the upgrade PRs return on their own.
- **better-sqlite3 14+ Windows prebuilds.** gemi-research-daemon is held at 12
  because 13 fails `node-gyp` on `windows-latest`.
- **The first star ping.** star-watch's baseline is recorded; the next star on any of
  the 33 repos sends a Telegram message. If one arrives and nothing pings, that
  workflow is the thing to debug.

## Ideas deliberately left out

- `--fix` for `ENV CI=true` — it changes build behaviour, so it stays a human call.
- SARIF output for GitHub code scanning.
- Composite actions and reusable-workflow `env:` outside `.github/workflows/`.
- Per-build-stage `docker-missing-workspace-copy` (currently per-file; favours false
  negatives over false positives).
