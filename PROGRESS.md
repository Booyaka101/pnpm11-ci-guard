# PROGRESS — pnpm11-ci-guard

**Status: v1.1.0 SHIPPED.** Last updated: 2026-07-27.

| Channel | State |
| --- | --- |
| npm | **live** — https://www.npmjs.com/package/pnpm11-ci-guard (`npx pnpm11-ci-guard` verified from the registry) |
| GitHub | **live** — https://github.com/Booyaka101/pnpm11-ci-guard (`v1.1.0` + moving `v1`) |
| Release | **live** — https://github.com/Booyaka101/pnpm11-ci-guard/releases/tag/v1.1.0 |
| CI | **green** — 8/8 matrix (ubuntu+windows × node 18/20/22/24) plus the dogfood job that runs the Action against both examples |
| Docs PR to pnpm | **open** — https://github.com/pnpm/pnpm.io/pull/845 |
| Marketplace | **NOT DONE — needs the web UI**, see below |

### The one remaining step (owner, ~60 seconds, phone is fine)

GitHub has no API for Marketplace publishing; it is a checkbox in the release editor.

1. Open https://github.com/Booyaka101/pnpm11-ci-guard/releases/tag/v1.1.0
2. **Edit release** → tick **"Publish this Action to the GitHub Marketplace"**
3. Accept the developer agreement if prompted, pick categories
   (*Continuous integration* + *Dependency management*), **Update release**.

`action.yml` already carries the required `name`, `description`, `author` and
`branding`, so the checkbox will not be blocked.

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
- **Clean-path install of 1.1.0**: `npm pack` → fresh folder → relative tarball →
  `--version`, `require()` and `--fix` all verified. Root manifest unpolluted.
- **Tests**: 92, `npm test`, all passing, no test-framework dependency.
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
| 5 | Tests + command | **MET** — `npm test`, 92 passing |
| 6 | Publish-ready packaging | **MET** — clean-path install of the 1.1.0 tarball verified |
| 7 | README a stranger can follow | **MET** — leads with the codemod relationship |
| 8 | Coherent release | **MET** — 1.1.0 + CHANGELOG documenting what was cut and why |

**Nothing is unmet.**

---

## What shipped, and what is still open

Done: git repo + tags, GitHub repo, release, npm publish (verified via `npx` from the
public registry), CI green on 8 platform/version combinations, cross-links between
this and npm-script-lens, and the pnpm docs PR.

**Open — Marketplace checkbox** (see the top of this file). That is the last step and
it cannot be automated.

**Open — pnpm/pnpm.io#845.** The PR fixes pnpm's own v11 Dockerfile example, which
copies `package.json` and `pnpm-lock.yaml` but not `pnpm-workspace.yaml` — so it
teaches the exact pattern this tool's `docker-missing-workspace-copy` rule flags. It
contains **no mention of this tool**; a docs PR that plugs the author's product gets
rejected and deserves to. If maintainers prefer a `pnpm-workspace.yaml*` glob so the
example stays copy-pasteable for projects without the file, that alternative is
already offered in the PR body.

### Known cosmetic drift

The npm tarball for 1.1.0 carries the pre-fix `"test"` script
(`node --test "test/*.test.js"`) because the CI fix landed after publish. Harmless —
neither `test/` nor `scripts/` is in `files`, so no published script path changed.
Left alone deliberately rather than burning a 1.1.1 on a non-shipped field; it
corrects itself on the next real release.

## If you want a next release

- **SARIF output**, to match `ts7-compat-guard`, `cargo-witness` and `ghas-free-pack`.
  Deliberately deferred: it serves code-scanning dashboards, not the migrating dev who
  is the actual user. Do it when someone asks — that ask is the signal.
- `--fix` for `ENV CI=true` (changes build behaviour, so it stays a human call).
- Composite actions and reusable-workflow `env:` outside `.github/workflows/`.

## Ideas deliberately left out

- `--fix` for `ENV CI=true` — it changes build behaviour, so it stays a human call.
- SARIF output for GitHub code scanning.
- Composite actions and reusable-workflow `env:` outside `.github/workflows/`.
- Per-build-stage `docker-missing-workspace-copy` (currently per-file; favours false
  negatives over false positives).
