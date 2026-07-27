'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { runNode, ROOT } = require('./helpers/run.js');

const CLI = path.join(ROOT, 'bin', 'cli.js');
const BROKEN = path.join(ROOT, 'examples', 'broken-project');
const CLEAN = path.join(ROOT, 'examples', 'clean-project');

test('--help prints usage and exits 0', async () => {
  const { code, stdout } = await runNode(CLI, ['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /USAGE/);
  assert.match(stdout, /npx pnpm11-ci-guard \[options\]/);
  assert.match(stdout, /--dir <path>/);
  assert.match(stdout, /--mode <fail\|warn>/);
  assert.match(stdout, /--json/);
  assert.match(stdout, /EXIT CODES/);
});

test('-h is the same as --help', async () => {
  const long = await runNode(CLI, ['--help']);
  const short = await runNode(CLI, ['-h']);
  assert.equal(short.stdout, long.stdout);
});

test('--version prints just the version', async () => {
  const pkg = require('../package.json');
  const { code, stdout } = await runNode(CLI, ['--version']);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test('a project with FAIL findings exits 1 and prints the grouped report', async () => {
  const { code, stdout } = await runNode(CLI, ['--dir', BROKEN]);
  assert.equal(code, 1);
  assert.match(stdout, /^=== FAIL ===$/m);
  assert.match(stdout, /^=== WARN ===$/m);
  assert.match(stdout, /'pnpm' field ignored by pnpm v11/);
  assert.match(stdout, /missing COPY pnpm-workspace\.yaml/);
  assert.match(stdout, /Dockerfile:9: ENV npm_config_prefer_offline/);
  assert.match(stdout, /env\.npm_config_registry in job 'build'/);
});

test('a migrated project exits 0 with an OK block', async () => {
  const { code, stdout } = await runNode(CLI, ['--dir', CLEAN]);
  assert.equal(code, 0);
  assert.match(stdout, /=== OK ===/);
  assert.match(stdout, /No pnpm v11 issues found/);
  assert.doesNotMatch(stdout, /=== FAIL ===/);
});

test('--json emits parseable JSON with fail and warn arrays', async () => {
  const { code, stdout } = await runNode(CLI, ['--dir', BROKEN, '--json']);
  assert.equal(code, 1);

  const parsed = JSON.parse(stdout);
  assert.ok(Array.isArray(parsed.fail));
  assert.ok(Array.isArray(parsed.warn));
  assert.equal(parsed.fail.length, 3);
  assert.equal(parsed.warn.length, 7);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.exitCode, 1);
  assert.equal(parsed.tool, 'pnpm11-ci-guard');

  for (const finding of [...parsed.fail, ...parsed.warn]) {
    assert.equal(typeof finding.rule, 'string');
    assert.equal(typeof finding.file, 'string');
    assert.equal(typeof finding.message, 'string');
    assert.ok(finding.severity === 'fail' || finding.severity === 'warn');
  }
});

test('--json on a clean project is still valid JSON with empty arrays', async () => {
  const { code, stdout } = await runNode(CLI, ['--dir', CLEAN, '--json']);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(parsed.fail, []);
  assert.deepEqual(parsed.warn, []);
  assert.equal(parsed.ok, true);
});

test('--mode warn reports the same findings but exits 0', async () => {
  const { code, stdout } = await runNode(CLI, ['--dir', BROKEN, '--mode', 'warn', '--json']);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.fail.length, 3);
  assert.equal(parsed.mode, 'warn');
  assert.equal(parsed.exitCode, 0);
  assert.equal(stdout.includes('"exitCode": 0'), true);
});

test('--dir=path and a bare positional path both work', async () => {
  const eq = await runNode(CLI, [`--dir=${CLEAN}`]);
  const positional = await runNode(CLI, [CLEAN]);
  assert.equal(eq.code, 0);
  assert.equal(positional.code, 0);
  assert.equal(positional.stdout, eq.stdout);
});

test('a missing directory exits 2 with a message, not a stack trace', async () => {
  const { code, stdout, stderr } = await runNode(CLI, ['--dir', path.join(ROOT, 'nope-not-here')]);
  assert.equal(code, 2);
  assert.equal(stdout, '');
  assert.match(stderr, /Directory not found/);
  assert.doesNotMatch(stderr, /at .*\.js:\d+/, 'no stack trace should leak');
});

test('an unknown flag exits 2 and points at --help', async () => {
  const { code, stderr } = await runNode(CLI, ['--wat']);
  assert.equal(code, 2);
  assert.match(stderr, /Unknown option '--wat'/);
  assert.match(stderr, /--help/);
});

test('a flag missing its value exits 2 with a clear message', async () => {
  const { code, stderr } = await runNode(CLI, ['--dir']);
  assert.equal(code, 2);
  assert.match(stderr, /Missing value for --dir/);
});

test('an invalid --mode exits 2 with the accepted values', async () => {
  const { code, stderr } = await runNode(CLI, ['--mode', 'yolo']);
  assert.equal(code, 2);
  assert.match(stderr, /Expected 'fail' or 'warn'/);
});

test('NO_COLOR keeps the output free of ANSI escapes', async () => {
  const { stdout } = await runNode(CLI, ['--dir', BROKEN], { env: { NO_COLOR: '1' } });
  assert.doesNotMatch(stdout, new RegExp(String.fromCharCode(27) + '\\['));
});

test('--color forces ANSI escapes even when stdout is a pipe', async () => {
  const { stdout } = await runNode(CLI, ['--dir', BROKEN, '--color'], { env: { NO_COLOR: '' } });
  assert.match(stdout, new RegExp(String.fromCharCode(27) + '\\[31m'));
});
