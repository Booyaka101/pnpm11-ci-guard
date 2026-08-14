# Security Policy

## Supported versions

The latest version published to npm is the only one that gets fixes.

## Reporting a vulnerability

Please **don't** open a public issue for a security problem.

Use GitHub's [private vulnerability reporting](https://github.com/Booyaka101/pnpm11-ci-guard/security/advisories/new) instead. Expect a first response within a week.

Please include what you found, how to reproduce it, and what an attacker gets out of it.

## What this touches

Reads Dockerfiles and workflow YAML, and with `--fix` rewrites them in place. It never runs pnpm.

- **`--fix` rewrites files in place.** Run it on a clean tree so you can read the diff before committing. `--fix-dry-run` shows every edit and writes nothing.
- **It never executes pnpm** and never runs anything from your Dockerfile or workflow. It parses them.

## Scope

In scope: anything that leaks a credential, reads data belonging to someone else, or lets untrusted input reach code execution.

Out of scope: findings that require an attacker to already control the machine it runs on.
