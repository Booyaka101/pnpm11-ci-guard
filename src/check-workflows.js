'use strict';

const yaml = require('js-yaml');
const { yamlSource } = require('./yaml-source.js');
const { readTextFile } = require('./walk.js');
const { isIgnoredNpmConfigKey, toPnpmConfigKey } = require('./npm-config.js');
const {
  RULES,
  makeFinding,
  unreadableFileFinding,
  invalidYamlFinding,
  relPath,
} = require('./findings.js');
const {
  findPnpmInvocations,
  isUnsupportedGlobalInstall,
  usesRemovedResolutionOnly,
  resolutionOnlyFinding,
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
 * and per step. Local composite actions share the per-step checks.
 *
 * @param {Object} input
 * @param {string} input.rootDir
 * @param {string[]} input.workflows absolute paths
 * @param {string[]} [input.actions] local action manifest paths
 * @returns {{findings: object[], builtinCalls: {file: string, line: number|null, name: string, segment: string}[]}}
 */
function checkWorkflows({ rootDir, workflows, actions = [] }) {
  const findings = [];
  const builtinCalls = [];

  const actionPaths = new Set(actions);
  for (const abs of [...workflows, ...actions]) {
    const file = relPath(rootDir, abs);
    const source = readTextFile(abs);

    if (source === null) {
      findings.push(unreadableFileFinding(file));
      continue;
    }

    let doc;
    try {
      doc = yaml.load(source, { filename: abs, json: false });
    } catch (err) {
      findings.push(invalidYamlFinding(file, err));
      continue;
    }

    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) continue;

    const locations = yamlSource(source);

    if (actionPaths.has(abs)) {
      if (doc.runs && doc.runs.using === 'composite') {
        inspectSteps(doc.runs.steps, 'composite action', ['runs', 'steps']);
      }
      continue;
    }

    collect(doc.env, 'workflow root', ['env']);
    collect(doc.defaults && doc.defaults.env, 'workflow defaults', ['defaults', 'env']);

    const jobs = doc.jobs;
    if (jobs && typeof jobs === 'object' && !Array.isArray(jobs)) {
      for (const jobId of Object.keys(jobs)) {
        const job = jobs[jobId];
        if (!job || typeof job !== 'object' || Array.isArray(job)) continue;

        collect(job.env, `job '${jobId}'`, ['jobs', jobId, 'env']);

        inspectSteps(job.steps, `job '${jobId}'`, ['jobs', jobId, 'steps']);
      }
    }

    function inspectSteps(steps, parent, jsonPath) {
      if (!Array.isArray(steps)) return;
      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
        const context = `step ${describeStep(step, i)} in ${parent}`;
        collect(step.env, context, [...jsonPath, i, 'env']);
        inspectRun(step, context, [...jsonPath, i, 'run']);
      }
    }

    /** DETECTION 6 + `pnpm <builtin>` call sites inside a step's `run:` script. */
    function inspectRun(step, context, sourcePath) {
      if (typeof step.run !== 'string' || step.run.trim() === '') return;

      for (const invocation of findPnpmInvocations(step.run)) {
        const line = locations.runLine(sourcePath, invocation);

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

        if (usesRemovedResolutionOnly(invocation)) {
          findings.push(resolutionOnlyFinding({ file, line, context }));
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
        const collision = Object.keys(envObj).some((name) => name.toLowerCase() === renamed.toLowerCase());
        const line = collision ? null : locations.envKeyLine(jsonPath, key);
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
            fix: collision ? `Resolve existing ${renamed} before renaming ${key}` :
              `Rename to ${renamed} (${formatPath(jsonPath)})`,
            docs: DOCS_V11,
          })
        );
      }
    }
  }

  return { findings, builtinCalls };
}

function formatPath(parts) {
  return parts.map((part, i) => typeof part === 'number' ? `[${part}]` : `${i ? '.' : ''}${part}`).join('');
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

module.exports = { checkWorkflows, describeStep };
