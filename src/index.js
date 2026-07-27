'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { walkProject, readTextFile } = require('./walk.js');
const { checkDockerfiles } = require('./check-dockerfiles.js');
const { checkWorkflows } = require('./check-workflows.js');
const { checkPackageJson, BUILD_APPROVAL_KEYS } = require('./check-package-json.js');
const { RULES, ALL_RULES, makeFinding, sortFindings } = require('./findings.js');
const { formatText, formatJson } = require('./report.js');

const VERSION = require('../package.json').version;

class ScanError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ScanError';
    this.code = code || 'SCAN_ERROR';
  }
}

/**
 * Run every pnpm v11 check against a project directory.
 *
 * @param {Object} [options]
 * @param {string} [options.dir='.'] project root to scan
 * @param {'fail'|'warn'} [options.mode='fail'] whether FAIL findings should set a non-zero exit code
 * @returns {{
 *   ok: boolean,
 *   version: string,
 *   root: string,
 *   mode: 'fail'|'warn',
 *   hasWorkspaceYaml: boolean,
 *   scanned: {dockerfiles: number, workflows: number, packageJsons: number},
 *   fail: object[],
 *   warn: object[],
 *   summary: string,
 *   exitCode: number
 * }}
 */
function scan(options = {}) {
  const mode = normalizeMode(options.mode);
  const ignored = normalizeIgnore(options.ignore); // validate before doing any work
  const rootDir = resolveRoot(options.dir);

  const { dockerfiles, workflows, packageJsons, errors } = walkProject(rootDir);

  const hasWorkspaceYaml = fileExists(path.join(rootDir, 'pnpm-workspace.yaml'))
    || fileExists(path.join(rootDir, 'pnpm-workspace.yml'));

  const findings = [];

  for (const e of errors) {
    const rel = path.relative(rootDir, e.path).split(path.sep).join('/') || '.';
    findings.push(
      makeFinding({
        severity: 'warn',
        rule: RULES.UNREADABLE_INPUT,
        file: rel,
        message: `WARN: ${rel}: directory could not be read (${e.message}) — skipped`,
        short: `${rel}: directory unreadable (${e.message}), skipped`,
      })
    );
  }

  const pkgResult = checkPackageJson({ rootDir, packageJsons });
  const hasBuildApproval =
    pkgResult.buildApprovalConfig || workspaceGatesBuildScripts(rootDir);

  const dockerResult = checkDockerfiles({
    rootDir,
    dockerfiles,
    hasWorkspaceYaml,
    hasBuildApproval,
  });
  const workflowResult = checkWorkflows({ rootDir, workflows });

  findings.push(...pkgResult.findings, ...dockerResult.findings, ...workflowResult.findings);

  // ---- DETECTION 5 (correlated) --------------------------------------------
  // A shadowing script is only a WARN on its own. It becomes a FAIL once a
  // Dockerfile or workflow actually calls `pnpm <name>`, because that call site
  // silently changed meaning between v10 and v11.
  findings.push(
    ...correlateShadowedBuiltins({
      shadowedScripts: pkgResult.shadowedScripts,
      builtinCalls: [...dockerResult.builtinCalls, ...workflowResult.builtinCalls],
    })
  );

  const kept = findings.filter((f) => !ignored.has(f.rule));
  const suppressed = findings.length - kept.length;

  const fail = sortFindings(kept.filter((f) => f.severity === 'fail'));
  const warn = sortFindings(kept.filter((f) => f.severity === 'warn'));

  const scanned = {
    dockerfiles: dockerfiles.length,
    workflows: workflows.length,
    packageJsons: packageJsons.length,
  };

  return {
    ok: fail.length === 0 && warn.length === 0,
    version: VERSION,
    root: rootDir.split(path.sep).join('/'),
    mode,
    ignored: [...ignored].sort(),
    suppressed,
    hasWorkspaceYaml,
    scanned,
    fail,
    warn,
    summary: buildSummary({ fail, warn, scanned, hasWorkspaceYaml, suppressed }),
    exitCode: mode === 'fail' && fail.length > 0 ? 1 : 0,
  };
}

/**
 * Turn "package.json defines a script named `rebuild`" plus "a Dockerfile runs
 * `pnpm rebuild`" into one high-confidence FAIL naming both ends.
 */
function correlateShadowedBuiltins({ shadowedScripts, builtinCalls }) {
  if (shadowedScripts.length === 0 || builtinCalls.length === 0) return [];

  const shadowed = new Set(shadowedScripts.map((s) => s.name));
  const findings = [];

  for (const call of builtinCalls) {
    if (!shadowed.has(call.name)) continue;
    const declaredIn = shadowedScripts.find((s) => s.name === call.name);
    const where = call.line == null ? call.file : `${call.file}:${call.line}`;

    findings.push(
      makeFinding({
        severity: 'fail',
        rule: RULES.SHADOWED_BUILTIN_CALL,
        file: call.file,
        line: call.line,
        key: call.name,
        context: call.context || 'RUN',
        message:
          `FAIL: ${where}: \`pnpm ${call.name}\` used to run the built-in command, but ` +
          `${declaredIn.file} defines a script named '${call.name}' — under pnpm v11 this now ` +
          `silently runs that script instead. Use \`pnpm pm ${call.name}\` for the built-in, ` +
          `or \`pnpm run ${call.name}\` if the script is what you want.`,
        short:
          `${where}: \`pnpm ${call.name}\` now runs the '${call.name}' script from ${declaredIn.file}, ` +
          `not the built-in (use \`pnpm pm ${call.name}\`)`,
        fix: `Replace with \`pnpm pm ${call.name}\` (built-in) or \`pnpm run ${call.name}\` (script)`,
        docs: 'https://pnpm.io/migration',
      })
    );
  }

  return findings;
}

/**
 * `--ignore docker-missing-ci-env,shadowed-builtin-script` — the escape hatch that
 * stops a team ripping the whole tool out over one noisy rule.
 */
function normalizeIgnore(ignore) {
  if (ignore === undefined || ignore === null || ignore === '') return new Set();

  const raw = Array.isArray(ignore) ? ignore : String(ignore).split(',');
  const rules = raw.map((r) => String(r).trim()).filter(Boolean);
  const unknown = rules.filter((r) => !ALL_RULES.includes(r));

  if (unknown.length > 0) {
    throw new ScanError(
      `Unknown rule id${unknown.length > 1 ? 's' : ''} in --ignore: ${unknown.join(', ')}.\n` +
        `Known rules: ${ALL_RULES.join(', ')}`,
      'BAD_RULE'
    );
  }
  return new Set(rules);
}

function buildSummary({ fail, warn, scanned, hasWorkspaceYaml, suppressed }) {
  const scannedText =
    `scanned ${scanned.dockerfiles} Dockerfile(s), ` +
    `${scanned.workflows} workflow(s), ` +
    `${scanned.packageJsons} package.json file(s)`;
  const wsText = hasWorkspaceYaml
    ? 'pnpm-workspace.yaml present'
    : 'no pnpm-workspace.yaml at root';
  const suppressedText = suppressed > 0 ? `, ${suppressed} suppressed by --ignore` : '';
  if (fail.length === 0 && warn.length === 0) {
    return `No pnpm v11 issues found — ${scannedText} (${wsText})${suppressedText}.`;
  }
  return `${fail.length} fail, ${warn.length} warn${suppressedText} — ${scannedText} (${wsText}).`;
}

function normalizeMode(mode) {
  if (mode === undefined || mode === null || mode === '') return 'fail';
  const value = String(mode).trim().toLowerCase();
  if (value !== 'fail' && value !== 'warn') {
    throw new ScanError(`Invalid mode '${mode}'. Expected 'fail' or 'warn'.`, 'BAD_MODE');
  }
  return value;
}

function resolveRoot(dir) {
  const target = dir === undefined || dir === null || dir === '' ? '.' : String(dir);
  const abs = path.resolve(target);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new ScanError(`Directory not found: ${abs}`, 'NO_DIR');
    }
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
      throw new ScanError(`Permission denied reading: ${abs}`, 'NO_ACCESS');
    }
    throw new ScanError(`Cannot read ${abs}: ${(err && err.message) || err}`, 'NO_DIR');
  }
  if (!stat.isDirectory()) {
    throw new ScanError(`Not a directory: ${abs}`, 'NOT_A_DIR');
  }
  return abs;
}

/**
 * Does pnpm-workspace.yaml gate dependency build scripts? Read as plain text —
 * a top-level key is all we need, and this must never throw on malformed YAML.
 */
function workspaceGatesBuildScripts(rootDir) {
  for (const name of ['pnpm-workspace.yaml', 'pnpm-workspace.yml']) {
    const text = readTextFile(path.join(rootDir, name));
    if (text === null) continue;
    for (const key of BUILD_APPROVAL_KEYS) {
      if (new RegExp(`^${key}\\s*:`, 'm').test(text)) return true;
    }
  }
  return false;
}

function fileExists(absPath) {
  try {
    return fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

module.exports = {
  scan,
  formatText,
  formatJson,
  ScanError,
  RULES,
  ALL_RULES,
  VERSION,
  readTextFile,
};
