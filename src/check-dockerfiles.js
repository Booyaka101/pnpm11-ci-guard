'use strict';

const { readTextFile } = require('./walk.js');
const { parseDockerfile, extractAssignedKeys } = require('./dockerfile-parse.js');
const { isIgnoredNpmConfigKey, toPnpmConfigKey } = require('./npm-config.js');
const { RULES, makeFinding, relPath } = require('./findings.js');
const {
  findPnpmInvocations,
  isInstall,
  isUnsupportedGlobalInstall,
  shadowedBuiltinCall,
} = require('./pnpm-commands.js');

const DOCS_V11 = 'https://pnpm.io/blog/releases/11.0';
const DOCS_MIGRATION = 'https://pnpm.io/migration';
const DOCS_PITFALLS = 'https://dev.classmethod.jp/en/articles/pnpm-v10-to-v11-migration-docker-ci/';

/**
 * DETECTION 1 — `ENV`/`ARG npm_config_*` in a Dockerfile (silently ignored by pnpm v11).
 * DETECTION 4 — a Dockerfile that installs pnpm deps but never copies pnpm-workspace.yaml.
 * DETECTION 6 — `pnpm install -g` with no package argument (unsupported in v11).
 * DETECTION 7 — a pnpm install in an image that never sets `ENV CI=true`.
 *
 * Also collects every `pnpm <subcommand>` call site so the caller can correlate
 * them with package.json scripts that shadow a built-in (DETECTION 5).
 *
 * @param {Object} input
 * @param {string} input.rootDir absolute project root
 * @param {string[]} input.dockerfiles absolute paths
 * @param {boolean} input.hasWorkspaceYaml whether pnpm-workspace.yaml exists at the root
 * @returns {{findings: object[], builtinCalls: {file: string, line: number, name: string, segment: string}[]}}
 */
function checkDockerfiles({ rootDir, dockerfiles, hasWorkspaceYaml, hasBuildApproval }) {
  const findings = [];
  const builtinCalls = [];

  for (const abs of dockerfiles) {
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

    const { instructions } = parseDockerfile(source);

    // ---- DETECTION 1 -------------------------------------------------------
    for (const instruction of instructions) {
      if (instruction.keyword !== 'ENV' && instruction.keyword !== 'ARG') continue;
      for (const { key, line } of extractAssignedKeys(instruction)) {
        if (!isIgnoredNpmConfigKey(key)) continue;
        const renamed = toPnpmConfigKey(key);
        findings.push(
          makeFinding({
            severity: 'warn',
            rule: RULES.DOCKER_NPM_CONFIG_ENV,
            file,
            line,
            key,
            context: instruction.keyword,
            message: `WARN: ${file}:${line}: ${key} is silently ignored by pnpm v11 — rename to ${renamed}`,
            short: `${file}:${line}: ${instruction.keyword} ${key} — silently ignored by pnpm v11 (rename: ${renamed})`,
            fix: `Rename to ${renamed}`,
            docs: DOCS_V11,
          })
        );
      }
    }

    // ---- DETECTION 6 + collect pnpm call sites -----------------------------
    let installInstruction = null;

    for (const instruction of instructions) {
      if (instruction.keyword !== 'RUN') continue;

      // Strip the RUN keyword so the parser sees the shell command itself.
      const shell = instruction.text.replace(/^[A-Za-z]+\s*/, '');

      for (const invocation of findPnpmInvocations(shell)) {
        const line = locateSegmentLine(instruction, invocation);

        if (isUnsupportedGlobalInstall(invocation)) {
          findings.push(
            makeFinding({
              severity: 'fail',
              rule: RULES.UNSUPPORTED_GLOBAL_INSTALL,
              file,
              line,
              context: 'RUN',
              message:
                `FAIL: ${file}:${line}: \`pnpm install -g\` with no arguments is no longer ` +
                `supported in pnpm v11 — use \`pnpm add -g <pkg>\``,
              short: `${file}:${line}: \`pnpm install -g\` unsupported in v11 (use \`pnpm add -g <pkg>\`)`,
              fix: 'Replace with `pnpm add -g <pkg>`',
              docs: DOCS_MIGRATION,
            })
          );
        }

        const builtin = shadowedBuiltinCall(invocation);
        if (builtin) builtinCalls.push({ file, line, name: builtin, segment: invocation.segment });

        if (!installInstruction && isInstall(invocation)) installInstruction = instruction;
      }
    }

    // ---- DETECTION 7 -------------------------------------------------------
    // Only meaningful when the project actually gates dependency build scripts.
    // Without that config pnpm has nothing to prompt about, and measuring on 15
    // real repos showed the unconditional form firing on 14 of 14 Dockerfiles —
    // a rule that hits everyone is a tax, not a signal.
    if (hasBuildApproval && installInstruction && !setsCiEnv(instructions)) {
      findings.push(
        makeFinding({
          severity: 'warn',
          rule: RULES.DOCKER_MISSING_CI_ENV,
          file,
          line: installInstruction.startLine,
          key: 'CI',
          context: 'RUN pnpm install',
          message:
            `WARN: ${file}:${installInstruction.startLine}: this project gates dependency build scripts, ` +
            `but the image never sets \`ENV CI=true\` — pnpm v11 prompts for build-script approval ` +
            `instead of following your config, which hangs the image build. Add \`ENV CI=true\`.`,
          short: `${file}:${installInstruction.startLine}: gates build scripts but no \`ENV CI=true\` — v11 may prompt and hang the build`,
          fix: 'Add `ENV CI=true` before the install',
          docs: DOCS_PITFALLS,
        })
      );
    }

    // ---- DETECTION 4 -------------------------------------------------------
    if (!hasWorkspaceYaml || !installInstruction) continue;

    // Only COPY/ADD instructions that run *before* the install can help it.
    if (copiesWorkspaceYaml(instructions, installInstruction.startLine)) continue;

    findings.push(
      makeFinding({
        severity: 'fail',
        rule: RULES.DOCKER_MISSING_WORKSPACE_COPY,
        file,
        line: installInstruction.startLine,
        context: 'RUN pnpm install',
        message:
          `FAIL: ${file}: installs pnpm deps but does not COPY pnpm-workspace.yaml ` +
          `(required by pnpm v11) — add: COPY pnpm-workspace.yaml .`,
        short: `${file}: missing COPY pnpm-workspace.yaml (pnpm install at line ${installInstruction.startLine})`,
        fix: 'Add `COPY pnpm-workspace.yaml .` before the pnpm install step',
        docs: DOCS_PITFALLS,
      })
    );
  }

  return { findings, builtinCalls };
}

/** Find the physical line a shell segment sits on within a multi-line RUN. */
function locateSegmentLine(instruction, invocation) {
  const needle = invocation.subcommand
    ? `pnpm ${invocation.subcommand}`
    : 'pnpm';
  for (const part of instruction.physicalLines) {
    if (part.text.includes(needle)) return part.line;
  }
  for (const part of instruction.physicalLines) {
    if (part.text.includes('pnpm')) return part.line;
  }
  return instruction.startLine;
}

/**
 * Does the image set a truthy `CI` env var? `ENV CI=true` puts pnpm v11 into
 * non-interactive mode so it follows `allowBuilds` instead of prompting.
 */
function setsCiEnv(instructions) {
  for (const instruction of instructions) {
    if (instruction.keyword !== 'ENV' && instruction.keyword !== 'ARG') continue;
    const match = /(?:^|\s)CI\s*=\s*("[^"]*"|'[^']*'|\S+)/.exec(instruction.text);
    if (!match) continue;
    const value = match[1].replace(/^["']|["']$/g, '').toLowerCase();
    if (value === 'false' || value === '0' || value === '') continue;
    return true;
  }
  return false;
}

/**
 * A Dockerfile satisfies the workspace requirement if any COPY/ADD names
 * pnpm-workspace.yaml explicitly, or copies the whole build context (`COPY . .`),
 * which brings the file along with everything else.
 */
function copiesWorkspaceYaml(instructions, beforeLine = Infinity) {
  for (const instruction of instructions) {
    if (instruction.startLine >= beforeLine) continue;
    if (instruction.keyword !== 'COPY' && instruction.keyword !== 'ADD') continue;
    if (instruction.text.includes('pnpm-workspace.yaml')) return true;
    if (copiesWholeContext(instruction)) return true;
  }
  return false;
}

function copiesWholeContext(instruction) {
  const args = instruction.text
    .replace(/^[A-Za-z]+\s*/, '')
    .split(/\s+/)
    .filter((a) => a && !a.startsWith('--'));
  if (args.length < 2) return false;
  // Everything except the last arg is a source path.
  const sources = args.slice(0, -1).map((s) => s.replace(/^["']|["']$/g, ''));
  return sources.some((s) => s === '.' || s === './' || s === '*' || s === './*');
}

module.exports = { checkDockerfiles, copiesWorkspaceYaml, setsCiEnv };
