'use strict';

const { scan, ScanError, VERSION } = require('./index.js');
const { formatText, formatJson } = require('./report.js');
const { applyFixes, formatFixReport } = require('./fix.js');
const { ALL_RULES } = require('./findings.js');

const USAGE = `pnpm11-ci-guard v${VERSION}

  Catch the pnpm v11 migration in the two places pnpm's own codemod does not
  reach: your Dockerfiles and your CI workflows. These changes keep the build
  green while quietly ignoring your configuration.

USAGE
  npx pnpm11-ci-guard [options]

OPTIONS
  --dir <path>        Project root to scan (default: current directory)
  --mode <fail|warn>  fail = exit 1 when a FAIL finding exists (default)
                      warn = report everything, always exit 0
  --fix               Rewrite what can be fixed safely, then report the rest
  --fix-dry-run       Show exactly what --fix would change, without writing
  --ignore <rules>    Comma-separated rule ids to suppress
  --json              Print machine-readable JSON: { fail: [...], warn: [...] }
  --no-color          Disable ANSI colour (also honours NO_COLOR)
  -h, --help          Show this help
  -v, --version       Print the version

CHECKS
  FAIL  package-json-pnpm-field       'pnpm' field is ignored by v11 (run pnpm's codemod)
  FAIL  docker-missing-workspace-copy installs pnpm deps, never COPYs pnpm-workspace.yaml
  FAIL  shadowed-builtin-call         \`pnpm rebuild\` now runs your script, not the built-in
  FAIL  unsupported-global-install    \`pnpm install -g\` with no args is gone in v11
  WARN  docker-npm-config-env         ENV/ARG npm_config_* is no longer read
  WARN  workflow-npm-config-env       env.npm_config_* is no longer read
  WARN  docker-missing-ci-env         gates build scripts but sets no \`ENV CI=true\`
  WARN  unreadable-input              malformed YAML/JSON — reported, never fatal

  URL-scoped auth (npm_config_//registry.example.com/:_authToken) is NEVER flagged —
  pnpm 11.6+ still reads it.

AUTOFIXABLE
  docker-npm-config-env, workflow-npm-config-env, docker-missing-workspace-copy.
  The 'pnpm' field is migrated by pnpm's own codemod: pnpx codemod run pnpm-v10-to-v11

EXIT CODES
  0  no FAIL findings (or --mode warn)
  1  at least one FAIL finding in --mode fail
  2  bad usage / unreadable target directory

EXAMPLES
  npx pnpm11-ci-guard
  npx pnpm11-ci-guard --fix-dry-run
  npx pnpm11-ci-guard --fix && git diff
  npx pnpm11-ci-guard --dir ./services/api --ignore docker-missing-ci-env
  npx pnpm11-ci-guard --json | jq '.fail[].message'

Docs: https://pnpm.io/migration
`;

const KNOWN_FLAGS = new Set([
  '--dir',
  '--mode',
  '--ignore',
  '--fix',
  '--fix-dry-run',
  '--json',
  '--no-color',
  '--color',
  '-h',
  '--help',
  '-v',
  '--version',
]);

/** Flags that take a value, mapped to their key on the options object. */
const VALUE_FLAG_KEYS = {
  '--dir': 'dir',
  '--mode': 'mode',
  '--ignore': 'ignore',
};

/**
 * @param {string[]} argv
 * @returns {{dir: string, mode: string, ignore: string, fix: boolean, fixDryRun: boolean,
 *            json: boolean, color: boolean|null, help: boolean, version: boolean}}
 */
function parseArgs(argv) {
  const opts = {
    dir: '.',
    mode: 'fail',
    ignore: '',
    fix: false,
    fixDryRun: false,
    json: false,
    color: null,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '-v' || arg === '--version') {
      opts.version = true;
      continue;
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--fix') {
      opts.fix = true;
      continue;
    }
    if (arg === '--fix-dry-run') {
      opts.fix = true;
      opts.fixDryRun = true;
      continue;
    }
    if (arg === '--no-color') {
      opts.color = false;
      continue;
    }
    if (arg === '--color') {
      opts.color = true;
      continue;
    }

    // --dir=path / --mode=warn / --ignore=a,b
    const eq = /^(--dir|--mode|--ignore)=(.*)$/.exec(arg);
    if (eq) {
      if (eq[2] === '') throw new UsageError(`Missing value for ${eq[1]}`);
      opts[VALUE_FLAG_KEYS[eq[1]]] = eq[2];
      continue;
    }

    if (VALUE_FLAG_KEYS[arg]) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new UsageError(`Missing value for ${arg}`);
      }
      opts[VALUE_FLAG_KEYS[arg]] = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      const hint = nearestFlag(arg);
      throw new UsageError(`Unknown option '${arg}'${hint ? ` (did you mean ${hint}?)` : ''}`);
    }

    // Bare positional: treat as the directory, so `npx pnpm11-ci-guard ./app` works.
    opts.dir = arg;
  }

  return opts;
}

function nearestFlag(arg) {
  const base = arg.replace(/=.*$/, '');
  for (const flag of KNOWN_FLAGS) {
    if (flag.startsWith(base) || base.startsWith(flag)) return flag;
  }
  return null;
}

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

function shouldUseColor(explicit, stream) {
  if (explicit === false) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false;
  if (explicit === true) return true;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream && stream.isTTY);
}

/**
 * @param {string[]} argv
 * @param {{stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream, exit?: (code:number)=>void}} [io]
 */
function runCli(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const exit = io.exit || ((code) => { process.exitCode = code; });

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr.write(`pnpm11-ci-guard: ${err.message}\n\nRun 'pnpm11-ci-guard --help' for usage.\n`);
    return exit(2);
  }

  if (opts.help) {
    stdout.write(USAGE);
    return exit(0);
  }
  if (opts.version) {
    stdout.write(`${VERSION}\n`);
    return exit(0);
  }

  const scanOptions = { dir: opts.dir, mode: opts.mode, ignore: opts.ignore };

  let result;
  try {
    result = scan(scanOptions);
  } catch (err) {
    if (err instanceof ScanError) {
      stderr.write(`pnpm11-ci-guard: ${err.message}\n`);
      return exit(2);
    }
    stderr.write(`pnpm11-ci-guard: unexpected error: ${(err && err.message) || err}\n`);
    return exit(2);
  }

  let fixResult = null;
  if (opts.fix) {
    try {
      fixResult = applyFixes(result, { rootDir: result.root, dryRun: opts.fixDryRun });
    } catch (err) {
      stderr.write(`pnpm11-ci-guard: could not apply fixes: ${(err && err.message) || err}\n`);
      return exit(2);
    }
    // Re-scan so the reported state is the state on disk, not the pre-fix state.
    if (!opts.fixDryRun && fixResult.changed.length > 0) {
      try {
        result = scan(scanOptions);
      } catch (err) {
        stderr.write(`pnpm11-ci-guard: re-scan after fixing failed: ${(err && err.message) || err}\n`);
        return exit(2);
      }
    }
  }

  if (opts.json) {
    const payload = JSON.parse(formatJson(result));
    if (fixResult) {
      payload.fixed = {
        dryRun: opts.fixDryRun,
        files: fixResult.changed,
        skipped: fixResult.skipped.map((s) => ({
          file: s.finding.file,
          line: s.finding.line,
          rule: s.finding.rule,
          reason: s.reason,
        })),
      };
    }
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    if (fixResult) {
      stdout.write(`${formatFixReport(fixResult, { dryRun: opts.fixDryRun })}\n\n`);
    }
    stdout.write(`${formatText(result, { color: shouldUseColor(opts.color, stdout) })}\n`);
  }

  return exit(result.exitCode);
}

module.exports = { runCli, parseArgs, USAGE, UsageError };
