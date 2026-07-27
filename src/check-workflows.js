'use strict';

const yaml = require('js-yaml');
const { readTextFile } = require('./walk.js');
const { isIgnoredNpmConfigKey, toPnpmConfigKey } = require('./npm-config.js');
const { RULES, makeFinding, relPath } = require('./findings.js');
const {
  findPnpmInvocations,
  isUnsupportedGlobalInstall,
  shadowedBuiltinCall,
} = require('./pnpm-commands.js');

const DOCS_V11 = 'https://pnpm.io/blog/releases/11.0';
const DOCS_MIGRATION = 'https://pnpm.io/migration';

/**
 * DETECTION 2 — `env:` entries named `npm_config_*` in GitHub Actions workflows.
 *
 * pnpm v11 no longer reads them, so a workflow that sets `npm_config_registry`
 * (or `npm_config_prefer_offline`, `npm_config_production`, …) keeps running green
 * while quietly doing something different from what the author intended.
 *
 * `env:` is walked at all three levels GitHub supports: workflow root, per job,
 * and per step.
 *
 * @param {Object} input
 * @param {string} input.rootDir
 * @param {string[]} input.workflows absolute paths
 * @returns {{findings: object[], builtinCalls: {file: string, line: number|null, name: string, segment: string}[]}}
 */
function checkWorkflows({ rootDir, workflows }) {
  const findings = [];
  const builtinCalls = [];

  for (const abs of workflows) {
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

    let doc;
    try {
      doc = yaml.load(source, { filename: abs, json: false });
    } catch (err) {
      const reason = describeYamlError(err);
      findings.push(
        makeFinding({
          severity: 'warn',
          rule: RULES.UNREADABLE_INPUT,
          file,
          line: err && err.mark && typeof err.mark.line === 'number' ? err.mark.line + 1 : null,
          message: `WARN: ${file}: not valid YAML (${reason}) — skipped`,
          short: `${file}: invalid YAML (${reason}), skipped`,
        })
      );
      continue;
    }

    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;

    const lines = source.split(/\r?\n/);

    collect(doc.env, 'workflow root', 'env');
    collect(doc.defaults && doc.defaults.env, 'workflow defaults', 'defaults.env');

    const jobs = doc.jobs;
    if (jobs && typeof jobs === 'object' && !Array.isArray(jobs)) {
      for (const jobId of Object.keys(jobs)) {
        const job = jobs[jobId];
        if (!job || typeof job !== 'object' || Array.isArray(job)) continue;

        collect(job.env, `job '${jobId}'`, `jobs.${jobId}.env`);

        const steps = job.steps;
        if (!Array.isArray(steps)) continue;
        for (let i = 0; i < steps.length; i += 1) {
          const step = steps[i];
          if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
          const label = describeStep(step, i);
          collect(step.env, `step ${label} in job '${jobId}'`, `jobs.${jobId}.steps[${i}].env`);
          inspectRun(step, `step ${label} in job '${jobId}'`);
        }
      }
    }

    /** DETECTION 6 + `pnpm <builtin>` call sites inside a step's `run:` script. */
    function inspectRun(step, context) {
      if (typeof step.run !== 'string' || step.run.trim() === '') return;

      for (const invocation of findPnpmInvocations(step.run)) {
        const line = locateRunSegmentLine(lines, invocation);

        if (isUnsupportedGlobalInstall(invocation)) {
          const where = line == null ? file : `${file}:${line}`;
          findings.push(
            makeFinding({
              severity: 'fail',
              rule: RULES.UNSUPPORTED_GLOBAL_INSTALL,
              file,
              line,
              context,
              message:
                `FAIL: ${file}: \`pnpm install -g\` with no arguments in ${context} is no longer ` +
                `supported in pnpm v11 — use \`pnpm add -g <pkg>\``,
              short: `${where}: \`pnpm install -g\` unsupported in v11 (use \`pnpm add -g <pkg>\`)`,
              fix: 'Replace with `pnpm add -g <pkg>`',
              docs: DOCS_MIGRATION,
            })
          );
        }

        const builtin = shadowedBuiltinCall(invocation);
        if (builtin) {
          builtinCalls.push({ file, line, name: builtin, segment: invocation.segment, context });
        }
      }
    }

    function collect(envObj, context, jsonPath) {
      if (!envObj || typeof envObj !== 'object' || Array.isArray(envObj)) return;
      for (const key of Object.keys(envObj)) {
        if (!isIgnoredNpmConfigKey(key)) continue;
        const renamed = toPnpmConfigKey(key);
        const line = locateEnvKeyLine(lines, key);
        const where = line == null ? file : `${file}:${line}`;
        findings.push(
          makeFinding({
            severity: 'warn',
            rule: RULES.WORKFLOW_NPM_CONFIG_ENV,
            file,
            line,
            key,
            context,
            message: `WARN: ${file}: env.${key} in ${context} is silently ignored by pnpm v11`,
            short: `${where}: env.${key} in ${context} — silently ignored (rename: ${renamed})`,
            fix: `Rename to ${renamed} (${jsonPath})`,
            docs: DOCS_V11,
          })
        );
      }
    }
  }

  return { findings, builtinCalls };
}

/** Locate the raw YAML line a `run:` segment came from. */
function locateRunSegmentLine(lines, invocation) {
  const needle = invocation.subcommand ? `pnpm ${invocation.subcommand}` : 'pnpm';
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return null;
}

/** Best-effort line lookup so the report can point at the offending YAML line. */
function locateEnvKeyLine(lines, key) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const idx = line.indexOf(key);
    if (idx === -1) continue;
    const before = line.slice(0, idx).trim();
    const after = line.slice(idx + key.length).trimStart();
    // A YAML mapping key: nothing but indent (or a quote) before it, a colon after.
    if ((before === '' || before === '"' || before === "'") && /^["']?\s*:/.test(after)) {
      return i + 1;
    }
  }
  return null;
}

function describeStep(step, index) {
  if (typeof step.name === 'string' && step.name.trim() !== '') return `'${step.name.trim()}'`;
  if (typeof step.uses === 'string' && step.uses.trim() !== '') return `'${step.uses.trim()}'`;
  if (typeof step.id === 'string' && step.id.trim() !== '') return `'${step.id.trim()}'`;
  if (typeof step.run === 'string') {
    const first = step.run.split(/\r?\n/).find((l) => l.trim() !== '') || '';
    const snippet = first.trim().slice(0, 40);
    if (snippet) return `#${index + 1} ('${snippet}')`;
  }
  return `#${index + 1}`;
}

function describeYamlError(err) {
  if (!err) return 'unknown parse error';
  const reason = err.reason || err.message || String(err);
  return String(reason).split('\n')[0].trim();
}

module.exports = { checkWorkflows, locateEnvKeyLine, describeStep };
