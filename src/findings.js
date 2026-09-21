'use strict';

const path = require('node:path');

/** Rule identifiers, stable across releases — safe to grep for or suppress on. */
const RULES = {
  DOCKER_NPM_CONFIG_ENV: 'docker-npm-config-env',
  WORKFLOW_NPM_CONFIG_ENV: 'workflow-npm-config-env',
  PACKAGE_JSON_PNPM_FIELD: 'package-json-pnpm-field',
  DOCKER_MISSING_WORKSPACE_COPY: 'docker-missing-workspace-copy',
  SHADOWED_BUILTIN_CALL: 'shadowed-builtin-call',
  UNSUPPORTED_GLOBAL_INSTALL: 'unsupported-global-install',
  DOCKER_MISSING_CI_ENV: 'docker-missing-ci-env',
  UNREADABLE_INPUT: 'unreadable-input',
  PNPM12_RESOLUTION_ONLY: 'pnpm12-resolution-only',
  PNPM12_UNKNOWN_WORKSPACE_SETTING: 'pnpm12-unknown-workspace-setting',
  PNPM12_SSH_GIT_DEPENDENCY: 'pnpm12-ssh-git-dependency',
};

/** Every rule id, for `--ignore` validation and `--help` output. */
const ALL_RULES = Object.values(RULES);

/**
 * @param {Object} spec
 * @param {'fail'|'warn'} spec.severity
 * @param {string} spec.rule
 * @param {string} spec.file repo-relative POSIX path
 * @param {number|null} [spec.line]
 * @param {string} spec.message full sentence, safe to print on its own
 * @param {string} spec.short compact form used in the grouped text report
 * @param {string|null} [spec.key]
 * @param {string|null} [spec.context]
 * @param {string|null} [spec.fix]
 * @param {string|null} [spec.docs]
 */
function makeFinding(spec) {
  return {
    severity: spec.severity,
    rule: spec.rule,
    file: spec.file,
    line: typeof spec.line === 'number' ? spec.line : null,
    key: spec.key || null,
    context: spec.context || null,
    message: spec.message,
    short: spec.short,
    fix: spec.fix || null,
    docs: spec.docs || null,
  };
}

/**
 * Every checker skips a file it cannot read, and they all say it the same way so the
 * rule reads identically whichever input type tripped it.
 */
function unreadableFileFinding(file) {
  return makeFinding({
    severity: 'warn',
    rule: RULES.UNREADABLE_INPUT,
    file,
    message: `WARN: ${file}: could not be read (permission denied or not valid UTF-8) — skipped`,
    short: `${file}: unreadable, skipped`,
  });
}

/** Same, for a file that is readable text but not parseable YAML. */
function invalidYamlFinding(file, err) {
  const raw = err ? err.reason || err.message || String(err) : null;
  const reason = raw ? String(raw).split(/\r?\n/)[0].trim() : 'unknown parse error';
  return makeFinding({
    severity: 'warn',
    rule: RULES.UNREADABLE_INPUT,
    file,
    line: err && err.mark && typeof err.mark.line === 'number' ? err.mark.line + 1 : null,
    message: `WARN: ${file}: not valid YAML (${reason}) — skipped`,
    short: `${file}: invalid YAML (${reason}), skipped`,
  });
}

/** Repo-relative, forward-slashed path — stable output across Windows/Linux. */
function relPath(rootDir, absPath) {
  const rel = path.relative(rootDir, absPath);
  if (rel === '') return path.basename(absPath);
  return rel.split(path.sep).join('/');
}

/** Deterministic ordering so CI diffs stay readable. */
function sortFindings(findings) {
  return findings.slice().sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    const al = a.line == null ? -1 : a.line;
    const bl = b.line == null ? -1 : b.line;
    if (al !== bl) return al - bl;
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    return a.short < b.short ? -1 : a.short > b.short ? 1 : 0;
  });
}

module.exports = {
  RULES,
  ALL_RULES,
  makeFinding,
  unreadableFileFinding,
  invalidYamlFinding,
  relPath,
  sortFindings,
};
