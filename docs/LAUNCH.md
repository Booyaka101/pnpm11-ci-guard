# pnpm11-ci-guard — Launch Material

**HOLD until pnpm/pnpm.io#845 is MERGED.** The whole opening claim — "I found and
fixed the gap in pnpm's own migration guide" — is only true at that point, and the
copy below states it as fact. Verify first:

    gh pr view 845 --repo pnpm/pnpm.io --json state,mergedAt

Tone follows the house precedent (cargo-witness, ghas-free-pack): factual,
limitations up front, every claim one the tool actually backs up.

---

## dev.to article

**Title:** pnpm's own docs taught the v11 Docker mistake. I fixed the docs — and shipped the linter for everyone who already copied them.

**Tags:** pnpm, docker, devops, cicd

**Body:**

pnpm v11 moved all configuration into `pnpm-workspace.yaml`. The [migration guide](https://pnpm.io/migration) is honest about the sharp edges — it lists the manual follow-ups, including renaming `npm_config_*` env vars *"wherever they are set (CI configs, shell profiles, Docker images)"*.

But until this week, pnpm's own Docker page showed this v11 recipe:

```dockerfile
FROM ghcr.io/pnpm/pnpm:11
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
```

Spot the problem? `pnpm-workspace.yaml` — the file that now holds `overrides`, `nodeLinker`, `allowBuilds`, everything — is never copied in. The install succeeds. The image builds. And every setting in that file is silently not applied. In a workspace it's worse: the file declares `packages`, so the install resolves the wrong project set.

I sent [a docs PR](https://github.com/pnpm/pnpm.io/pull/845) fixing the example and adding it to the migration guide's follow-up list, and it's now merged. But a docs fix doesn't help anyone who already copied the old recipe — and it doesn't cover the rest of the migration that lands in Dockerfiles and CI workflows, which pnpm's official `pnpm-v10-to-v11` codemod explicitly does not touch (its own stated limitation).

So: **pnpm11-ci-guard**. A GitHub Action and npx CLI that finds — and fixes — the parts of the v10 → v11 migration the codemod never sees.

```bash
npx pnpm11-ci-guard            # scan
npx pnpm11-ci-guard --fix      # apply the safe fixes, report the rest
```

```yaml
- uses: Booyaka101/pnpm11-ci-guard@v1
```

## What it catches

Eight rules. The four FAILs:

- **`docker-missing-workspace-copy`** — installs pnpm deps but never copies `pnpm-workspace.yaml` (the docs bug above, in your repo). Only fires when the file exists, and a `COPY . .` *before* the install counts.
- **`package-json-pnpm-field`** — a `pnpm` field the codemod should have moved; v11 ignores it wherever it appears.
- **`shadowed-builtin-call`** — `RUN pnpm rebuild` in a Dockerfile now runs your *script* named `rebuild`, not the built-in. Needs `package.json` and the Dockerfile read together; a single-file linter can't see it.
- **`unsupported-global-install`** — bare `pnpm install -g`, removed in v11.

Plus WARNs for `npm_config_*` env vars in Dockerfiles and workflow `env:` blocks (both autofixable via `--fix`), and a missing `ENV CI=true` where the project gates build scripts. URL-scoped auth (`npm_config_//registry.npmjs.org/:_authToken`) is never flagged — pnpm 11.6+ still reads it, and telling you to rename it would break working auth.

## Measured before shipped

Every rule ran against 15 real public repositories — 38 Dockerfiles, 55 workflow files, 127 manifests — before release: **9 FAIL + 12 WARN, every finding manually confirmed, zero false positives.** Real hits included a publish workflow setting `NPM_CONFIG_REGISTRY` (ignored under v11 — the release would go to the default registry) and an `ENV npm_config_build_from_source=true` above a `pnpm install` for a native better-sqlite3 build, where v11 silently installs a prebuilt binary instead.

The same corpus killed two of my own rules before they shipped. Flagging any script merely *named* `clean`/`rebuild` produced 40 findings — 33 of them one monorepo's `clean` script — so only actual call sites are findings. And warning on a missing `ENV CI=true` fired on 14 of 14 Dockerfiles until it was gated on the project actually declaring `allowBuilds`. A rule that fires on everyone is a tax, not a signal.

## Honest limitations

- Static analysis only: it reads files, never runs pnpm or Docker. Env vars injected by a runner or `--build-arg` are invisible to it.
- Dockerfile discovery is by filename (`Dockerfile`, `Dockerfile.*`, `*.dockerfile`, case-insensitive).
- Workflows must live under `.github/workflows/`; composite actions aren't scanned.
- `--fix` deliberately does **not** migrate the `pnpm` field — pnpm's codemod already does that properly, and it points you there instead.

MIT. Repo: https://github.com/Booyaka101/pnpm11-ci-guard

---

## X post

Single paragraph, plain ASCII — the composer mangles blank lines and emoji.
Post AFTER the dev.to article so the link can be added as a reply if wanted.

> pnpm v11 moved all config into pnpm-workspace.yaml - but pnpm's own Docker example never copied that file into the image, so every setting was silently ignored. My fix to their docs just merged. For everyone who already copied the old recipe: pnpm11-ci-guard, a GitHub Action + npx CLI that catches the whole v11 migration in Dockerfiles and CI workflows - the half pnpm's official codemod explicitly skips - and autofixes the safe parts. Measured on 15 real repos, zero false positives. https://github.com/Booyaka101/pnpm11-ci-guard
