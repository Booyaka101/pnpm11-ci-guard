'use strict';

/**
 * Autofix — the half of the migration the official codemod explicitly declines.
 *
 * pnpm's migration guide: "`npm_config_*` environment variables are no longer read.
 * Rename them to `pnpm_config_*` wherever they are set (CI configs, shell profiles,
 * Docker images)." The `pnpm-v10-to-v11` codemod's own limitations say it will NOT
 * do that renaming. This does — in Dockerfiles and workflow YAML — plus inserts the
 * missing `COPY pnpm-workspace.yaml`.
 *
 * Deliberately conservative:
 *   - only ever rewrites the key token itself, never the value, quoting or layout;
 *   - never touches `npm_config_//…` URL-scoped auth (pnpm 11.6+ still reads it);
 *   - operates on the exact line a finding points at, so it cannot drift;
 *   - re-scans afterwards and reports anything it could not fix.
 */

const fs = require('node:fs');
const path = require('node:path');

const { RULES } = require('./findings.js');
const { toPnpmConfigKey } = require('./npm-config.js');

/** Rules this module knows how to repair automatically. */
const FIXABLE_RULES = [
  RULES.DOCKER_NPM_CONFIG_ENV,
  RULES.WORKFLOW_NPM_CONFIG_ENV,
  RULES.DOCKER_MISSING_WORKSPACE_COPY,
];

/**
 * @param {object} result a value returned by `scan()`
 * @param {{rootDir: string, dryRun?: boolean}} opts
 * @returns {{changed: {file: string, edits: {line: number, before: string, after: string, rule: string}[]}[],
 *            unfixable: object[], skipped: object[]}}
 */
function applyFixes(result, opts) {
  const rootDir = opts.rootDir;
  const dryRun = Boolean(opts.dryRun);

  const all = [...result.fail, ...result.warn];
  const fixable = all.filter((f) => FIXABLE_RULES.includes(f.rule) && f.line);
  const unfixable = all.filter((f) => !FIXABLE_RULES.includes(f.rule));
  const skipped = [];

  /** @type {Map<string, object[]>} */
  const byFile = new Map();
  for (const finding of fixable) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, []);
    byFile.get(finding.file).push(finding);
  }

  const changed = [];

  for (const [file, findings] of byFile) {
    const abs = path.join(rootDir, file.split('/').join(path.sep));

    let original;
    try {
      original = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      for (const f of findings) skipped.push({ finding: f, reason: describe(err) });
      continue;
    }

    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original.split(/\r?\n/);
    const edits = [];

    // Renames first — they are line-local and do not shift line numbers.
    for (const finding of findings) {
      if (
        finding.rule !== RULES.DOCKER_NPM_CONFIG_ENV &&
        finding.rule !== RULES.WORKFLOW_NPM_CONFIG_ENV
      ) {
        continue;
      }
      const index = finding.line - 1;
      const before = lines[index];
      if (before === undefined) {
        skipped.push({ finding, reason: 'line no longer exists' });
        continue;
      }
      const after = renameKeyOnLine(before, finding.key);
      if (after === null) {
        skipped.push({ finding, reason: `could not locate '${finding.key}' on that line` });
        continue;
      }
      lines[index] = after;
      edits.push({ line: finding.line, before, after, rule: finding.rule });
    }

    // Then insertions, applied bottom-up so earlier line numbers stay valid.
    const insertions = findings
      .filter((f) => f.rule === RULES.DOCKER_MISSING_WORKSPACE_COPY)
      .sort((a, b) => b.line - a.line);

    for (const finding of insertions) {
      const index = finding.line - 1;
      const anchor = lines[index];
      if (anchor === undefined) {
        skipped.push({ finding, reason: 'line no longer exists' });
        continue;
      }
      const indent = /^\s*/.exec(anchor)[0];
      const inserted = `${indent}COPY pnpm-workspace.yaml .`;
      lines.splice(index, 0, inserted);
      edits.push({
        line: finding.line,
        before: '(nothing)',
        after: inserted,
        rule: finding.rule,
        inserted: true,
      });
    }

    if (edits.length === 0) continue;

    const updated = lines.join(newline);
    if (!dryRun) {
      try {
        fs.writeFileSync(abs, updated, 'utf8');
      } catch (err) {
        for (const f of findings) skipped.push({ finding: f, reason: describe(err) });
        continue;
      }
    }
    edits.sort((a, b) => a.line - b.line);
    changed.push({ file, edits });
  }

  changed.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { changed, unfixable, skipped };
}

/**
 * Replace exactly one `npm_config_*` key token on a line, leaving everything else
 * — indentation, quoting, the value, trailing comments, `\` continuations — alone.
 */
function renameKeyOnLine(line, key) {
  if (!key) return null;
  const index = line.indexOf(key);
  if (index === -1) return null;

  // Guard against matching a substring of a longer identifier.
  const preceding = index === 0 ? '' : line[index - 1];
  if (/[A-Za-z0-9_]/.test(preceding)) return null;

  const renamed = toPnpmConfigKey(key);
  if (renamed === key) return null;

  return line.slice(0, index) + renamed + line.slice(index + key.length);
}

function describe(err) {
  if (!err) return 'unknown error';
  if (err.code === 'EACCES' || err.code === 'EPERM') return 'permission denied';
  if (err.code === 'ENOENT') return 'file no longer exists';
  return err.message || String(err);
}

/** Human-readable summary of what `--fix` did. */
function formatFixReport(fixResult, { dryRun = false } = {}) {
  const out = [];
  const verb = dryRun ? 'would change' : 'changed';

  if (fixResult.changed.length === 0) {
    out.push(dryRun ? 'Nothing to fix automatically.' : 'No automatic fixes applied.');
  } else {
    const total = fixResult.changed.reduce((n, c) => n + c.edits.length, 0);
    out.push(`=== FIXED === (${total} edit(s) across ${fixResult.changed.length} file(s), ${verb})`);
    for (const { file, edits } of fixResult.changed) {
      out.push(`  ${file}`);
      for (const edit of edits) {
        if (edit.inserted) {
          out.push(`    + ${edit.line}: ${edit.after.trim()}`);
        } else {
          out.push(`    - ${edit.line}: ${edit.before.trim()}`);
          out.push(`    + ${edit.line}: ${edit.after.trim()}`);
        }
      }
    }
  }

  if (fixResult.skipped.length > 0) {
    out.push('');
    out.push(`=== COULD NOT FIX === (${fixResult.skipped.length})`);
    for (const { finding, reason } of fixResult.skipped) {
      out.push(`  ${finding.file}:${finding.line || '?'}: ${reason}`);
    }
  }

  if (fixResult.unfixable.length > 0) {
    out.push('');
    out.push(`=== NEEDS A HUMAN === (${fixResult.unfixable.length})`);
    for (const finding of fixResult.unfixable) {
      out.push(`  ${finding.short}`);
    }
    if (fixResult.unfixable.some((f) => f.rule === RULES.PACKAGE_JSON_PNPM_FIELD)) {
      out.push('');
      out.push("  The 'pnpm' field is migrated by pnpm's own codemod — run:");
      out.push('    pnpx codemod run pnpm-v10-to-v11');
    }
  }

  return out.join('\n');
}

module.exports = { applyFixes, formatFixReport, renameKeyOnLine, FIXABLE_RULES };
