'use strict';

/**
 * GitHub Actions entrypoint. Bundled to dist/action.js by `npm run build`.
 *
 * Reads the documented action inputs from the environment (GitHub exports each
 * input as INPUT_<NAME> with the name upper-cased and spaces turned into `_`),
 * prints annotations, writes a job summary, sets outputs, and exits 1 when a
 * FAIL finding exists in `mode: fail`.
 */

const fs = require('node:fs');
const os = require('node:os');

const { scan, ScanError } = require('./index.js');
const { formatText, formatJson, formatAnnotations, formatMarkdown } = require('./report.js');

function getInput(name, fallback) {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed === '' ? fallback : trimmed;
}

/** Append to a GitHub file command target (GITHUB_OUTPUT / GITHUB_STEP_SUMMARY). */
function appendToFileCommand(envVar, content) {
  const target = process.env[envVar];
  if (!target) return false;
  try {
    fs.appendFileSync(target, content, 'utf8');
    return true;
  } catch (err) {
    process.stdout.write(
      `::warning::pnpm11-ci-guard could not write ${envVar}: ${(err && err.message) || err}\n`
    );
    return false;
  }
}

function setOutput(name, value) {
  const str = String(value);
  if (str.includes('\n')) {
    const delimiter = `ghadelimiter_${name}_${str.length}`;
    appendToFileCommand('GITHUB_OUTPUT', `${name}<<${delimiter}${os.EOL}${str}${os.EOL}${delimiter}${os.EOL}`);
  } else {
    appendToFileCommand('GITHUB_OUTPUT', `${name}=${str}${os.EOL}`);
  }
}

function run() {
  const rootDir = getInput('root-dir', '.');
  const mode = getInput('mode', 'fail');
  const ignore = getInput('ignore', '');

  let result;
  try {
    result = scan({ dir: rootDir, mode, ignore });
  } catch (err) {
    const message = err instanceof ScanError ? err.message : `unexpected error: ${(err && err.message) || err}`;
    process.stdout.write(`::error title=pnpm11-ci-guard::${message.replace(/\r?\n/g, ' ')}\n`);
    process.exitCode = 1;
    return;
  }

  for (const line of formatAnnotations(result)) {
    process.stdout.write(`${line}\n`);
  }

  process.stdout.write(`${formatText(result, { color: false })}\n`);

  appendToFileCommand('GITHUB_STEP_SUMMARY', `${formatMarkdown(result)}${os.EOL}`);

  setOutput('fail-count', result.fail.length);
  setOutput('warn-count', result.warn.length);
  setOutput('ok', String(result.ok));
  setOutput('json', formatJson(result));

  process.exitCode = result.exitCode;
}

run();

module.exports = { getInput, setOutput };
