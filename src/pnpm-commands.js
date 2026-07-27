'use strict';

/**
 * Shared shell-ish parsing for "how is pnpm actually being invoked here".
 *
 * Used by both the Dockerfile checker (RUN lines) and the workflow checker
 * (step `run:` blocks) so a `pnpm rebuild` is recognised identically in each.
 */

/**
 * pnpm v11 built-in commands that a same-named package.json script now shadows.
 *
 * pnpm migration guide, verbatim: "If your `package.json` defines a script named
 * `clean`, `setup`, `deploy`, or `rebuild`, `pnpm <name>` now runs the script
 * instead of the built-in command. Use `pnpm pm <name>` to force the built-in."
 */
const SHADOWABLE_BUILTINS = ['clean', 'setup', 'deploy', 'rebuild'];

/** Flags that consume the following token, so it is not the subcommand. */
const VALUE_FLAGS = new Set([
  '--filter',
  '--filter-prod',
  '-F',
  '--dir',
  '-C',
  '--workspace-concurrency',
  '--reporter',
  '--config',
  '--store-dir',
  '--virtual-store-dir',
  '--package-import-method',
  '--use-node-version',
  '--registry',
]);

/** Split a shell command into independently-executed segments. */
function splitSegments(command) {
  return String(command)
    .split(/&&|\|\||[;\n|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse one shell segment into a pnpm invocation, or null when pnpm is not the
 * program being run. Recognises `pnpm`, `pnpm.cjs`, `/usr/local/bin/pnpm`,
 * `corepack pnpm` and a leading `RUN --mount=...` style prefix.
 *
 * @param {string} segment
 * @returns {{subcommand: string|null, args: string[], flags: string[]}|null}
 */
function parsePnpmInvocation(segment) {
  const tokens = String(segment).trim().split(/\s+/).filter(Boolean);
  let i = 0;

  // Skip Docker RUN-level flags such as --mount=type=cache,...
  while (i < tokens.length && tokens[i].startsWith('--mount')) i += 1;
  // Skip `corepack` / `npx` style prefixes.
  if (tokens[i] === 'corepack') i += 1;

  const program = tokens[i];
  if (!program) return null;
  const base = program.split(/[\\/]/).pop();
  if (base !== 'pnpm' && base !== 'pnpm.cjs' && base !== 'pnpm.exe') return null;
  i += 1;

  const flags = [];
  const args = [];
  let subcommand = null;

  for (; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith('-')) {
      flags.push(token);
      const name = token.split('=')[0];
      if (!token.includes('=') && VALUE_FLAGS.has(name)) i += 1;
      continue;
    }
    if (subcommand === null) {
      subcommand = token;
      continue;
    }
    args.push(token);
  }

  return { subcommand, args, flags };
}

/**
 * Every pnpm invocation inside a shell command, with the segment it came from.
 *
 * @param {string} command
 * @returns {{subcommand: string|null, args: string[], flags: string[], segment: string}[]}
 */
function findPnpmInvocations(command) {
  const found = [];
  for (const segment of splitSegments(command)) {
    const parsed = parsePnpmInvocation(segment);
    if (parsed) found.push({ ...parsed, segment });
  }
  return found;
}

/** Does this invocation install dependencies (`pnpm install` / `pnpm i`)? */
function isInstall(invocation) {
  return invocation.subcommand === 'install' || invocation.subcommand === 'i';
}

/**
 * `pnpm install -g` with NO package argument.
 *
 * pnpm migration guide, verbatim: "`pnpm install -g` (with no arguments) is no
 * longer supported. Use `pnpm add -g <pkg>` instead."
 */
function isUnsupportedGlobalInstall(invocation) {
  if (!isInstall(invocation)) return false;
  const isGlobal = invocation.flags.some((f) => f === '-g' || f === '--global');
  return isGlobal && invocation.args.length === 0;
}

/**
 * A bare `pnpm <name>` where <name> is a shadowable built-in. `pnpm run <name>`
 * is unambiguous and always meant the script, so it is never flagged.
 */
function shadowedBuiltinCall(invocation) {
  if (!invocation.subcommand) return null;
  if (!SHADOWABLE_BUILTINS.includes(invocation.subcommand)) return null;
  return invocation.subcommand;
}

module.exports = {
  SHADOWABLE_BUILTINS,
  splitSegments,
  parsePnpmInvocation,
  findPnpmInvocations,
  isInstall,
  isUnsupportedGlobalInstall,
  shadowedBuiltinCall,
};
