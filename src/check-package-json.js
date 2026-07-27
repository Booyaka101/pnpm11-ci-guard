'use strict';

const { readTextFile } = require('./walk.js');
const { RULES, makeFinding, relPath } = require('./findings.js');
const { SHADOWABLE_BUILTINS } = require('./pnpm-commands.js');

const DOCS_V11 = 'https://pnpm.io/blog/releases/11.0';
const DOCS_MIGRATION = 'https://pnpm.io/migration';

/**
 * DETECTION 3 — a top-level `pnpm` field in package.json.
 *
 * pnpm v11 release notes: "pnpm no longer reads the `pnpm` field in `package.json`".
 * Everything that used to live there (overrides, peerDependencyRules,
 * onlyBuiltDependencies, patchedDependencies, …) must move to pnpm-workspace.yaml.
 * Left in place it does not error — the settings simply stop applying, which is how
 * an overridden transitive dependency quietly comes back.
 *
 * The root package.json is always checked; workspace package manifests are checked
 * too, because the field is ignored wherever it appears.
 *
 * @param {Object} input
 * @param {string} input.rootDir
 * @param {string[]} input.packageJsons absolute paths
 * @returns {{findings: object[], shadowedScripts: {file: string, name: string, line: number|null}[]}}
 */
function checkPackageJson({ rootDir, packageJsons }) {
  const findings = [];
  const shadowedScripts = [];
  let buildApprovalConfig = false;

  for (const abs of packageJsons) {
    const file = relPath(rootDir, abs);
    const source = readTextFile(abs);

    if (source === null) {
      findings.push(
        makeFinding({
          severity: 'warn',
          rule: RULES.UNREADABLE_INPUT,
          file,
          message: `WARN: ${file}: could not be read (permission denied or not valid UTF-8) — skipped`,
          short: `${file}: unreadable, skipped`,
        })
      );
      continue;
    }

    let pkg;
    try {
      pkg = JSON.parse(source);
    } catch (err) {
      findings.push(
        makeFinding({
          severity: 'warn',
          rule: RULES.UNREADABLE_INPUT,
          file,
          message: `WARN: ${file}: not valid JSON (${shortJsonError(err)}) — skipped`,
          short: `${file}: invalid JSON (${shortJsonError(err)}), skipped`,
        })
      );
      continue;
    }

    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) continue;

    // ---- DETECTION 5 (half of it) ------------------------------------------
    // Record scripts that shadow a v11 built-in, but do NOT report them here.
    // Measured on 15 real repos, reporting the declaration alone produced 40
    // findings — 33 of them a `clean` script in one monorepo — because nearly
    // every package defines one and it is harmless until something actually
    // calls `pnpm clean`. The caller pairs these with real call sites instead.
    const scripts = pkg.scripts;
    if (scripts && typeof scripts === 'object' && !Array.isArray(scripts)) {
      for (const name of SHADOWABLE_BUILTINS) {
        if (!Object.prototype.hasOwnProperty.call(scripts, name)) continue;
        shadowedScripts.push({ file, name, line: locateKeyLineInObject(source, 'scripts', name) });
      }
    }

    // Build-script approval config decides whether pnpm can prompt during a
    // Docker build (see docker-missing-ci-env).
    if (hasBuildApprovalConfig(pkg.pnpm)) buildApprovalConfig = true;

    if (!Object.prototype.hasOwnProperty.call(pkg, 'pnpm')) continue;

    const value = pkg.pnpm;
    const keys =
      value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
    const foundKeys = keys.length > 0 ? keys.join(', ') : '(empty)';
    const line = locateTopLevelKeyLine(source, 'pnpm');

    findings.push(
      makeFinding({
        severity: 'fail',
        rule: RULES.PACKAGE_JSON_PNPM_FIELD,
        file,
        line,
        key: 'pnpm',
        context: 'top-level field',
        message:
          `FAIL: 'pnpm' field in ${file} is ignored by pnpm v11 — ` +
          `move settings to pnpm-workspace.yaml. Found keys: ${foundKeys}`,
        short: `${file}: 'pnpm' field ignored by pnpm v11 — move to pnpm-workspace.yaml (found: ${foundKeys})`,
        fix: 'Move these settings into pnpm-workspace.yaml',
        docs: DOCS_V11,
      })
    );
  }

  return { findings, shadowedScripts, buildApprovalConfig };
}

/** Keys that mean "this project gates dependency build scripts". */
const BUILD_APPROVAL_KEYS = [
  'allowBuilds',
  'onlyBuiltDependencies',
  'neverBuiltDependencies',
  'ignoredBuiltDependencies',
  'onlyBuiltDependenciesFile',
];

function hasBuildApprovalConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return BUILD_APPROVAL_KEYS.some((k) => Object.prototype.hasOwnProperty.call(value, k));
}

/** Find the line of `<parent>.<key>` — used for `scripts.rebuild` and friends. */
function locateKeyLineInObject(source, parent, key) {
  const lines = source.split(/\r?\n/);
  let inParent = false;
  let parentIndent = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (!inParent) {
      if (new RegExp(`^"${parent}"\\s*:\\s*\\{`).test(trimmed)) {
        inParent = true;
        parentIndent = indent;
      }
      continue;
    }
    if (trimmed.startsWith('}') && indent <= parentIndent) return null; // parent closed
    if (new RegExp(`^"${escapeRe(key)}"\\s*:`).test(trimmed)) return i + 1;
  }
  return null;
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the line of a *top-level* JSON key by tracking brace depth, so a nested
 * `"pnpm": "^11.0.0"` inside devDependencies is not mistaken for the real field.
 */
function locateTopLevelKeyLine(source, key) {
  let depth = 0;
  let line = 1;
  let inString = false;
  let escaped = false;
  let stringStart = -1;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\n') line += 1;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        if (depth === 1) {
          const literal = source.slice(stringStart + 1, i);
          const after = source.slice(i + 1, i + 40);
          if (literal === key && /^\s*:/.test(after)) return line;
        }
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      stringStart = i;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
    }
  }
  return null;
}

function shortJsonError(err) {
  const msg = (err && err.message) || String(err);
  return msg.split('\n')[0].trim();
}

module.exports = {
  checkPackageJson,
  locateTopLevelKeyLine,
  locateKeyLineInObject,
  hasBuildApprovalConfig,
  BUILD_APPROVAL_KEYS,
};
