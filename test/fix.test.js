'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const { runNode, ROOT } = require('./helpers/run.js');
const { renameKeyOnLine } = require('../src/fix.js');

const CLI = path.join(ROOT, 'bin', 'cli.js');
const SOURCE = path.join(ROOT, 'examples', 'broken-project');

/** A disposable copy of the broken example, so fixes never touch the repo. */
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm11-guard-fix-'));
  fs.cpSync(SOURCE, dir, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel.split('/').join(path.sep)), 'utf8');

test('renameKeyOnLine rewrites only the key token', () => {
  assert.equal(
    renameKeyOnLine('ENV npm_config_registry=https://npm_config_registry.example', 'npm_config_registry'),
    'ENV pnpm_config_registry=https://npm_config_registry.example'
  );
  assert.equal(
    renameKeyOnLine('  NPM_CONFIG_FUND: "false"  # keep', 'NPM_CONFIG_FUND'),
    '  PNPM_CONFIG_FUND: "false"  # keep'
  );
});

test('renameKeyOnLine refuses when the key is part of a longer identifier', () => {
  assert.equal(renameKeyOnLine('ENV MY_npm_config_registry=1', 'npm_config_registry'), null);
  assert.equal(renameKeyOnLine('ENV SOMETHING_ELSE=1', 'npm_config_registry'), null);
});

test('--fix-dry-run reports the edits but writes nothing', async (t) => {
  const dir = sandbox(t);
  const before = read(dir, 'Dockerfile');

  const { code, stdout } = await runNode(CLI, ['--dir', dir, '--fix-dry-run']);

  assert.equal(code, 1, 'unfixable FAILs remain, so it still exits 1');
  assert.match(stdout, /=== FIXED === \(7 edit\(s\) across 2 file\(s\), would change\)/);
  assert.equal(read(dir, 'Dockerfile'), before, 'dry run must not touch the file');
});

test('--fix renames npm_config_* in both Dockerfiles and workflows', async (t) => {
  const dir = sandbox(t);
  const { stdout } = await runNode(CLI, ['--dir', dir, '--fix']);

  assert.match(stdout, /=== FIXED ===/);

  const dockerfile = read(dir, 'Dockerfile');
  assert.match(dockerfile, /^ENV pnpm_config_prefer_offline=true$/m);
  assert.match(dockerfile, /^ENV pnpm_config_registry=/m);
  assert.match(dockerfile, /^ARG pnpm_config_network_concurrency=8$/m);

  const workflow = read(dir, '.github/workflows/ci.yml');
  assert.match(workflow, /pnpm_config_prefer_offline:/);
  assert.match(workflow, /pnpm_config_registry:/);
  assert.match(workflow, /pnpm_config_fund:/);
});

test('--fix never touches URL-scoped auth tokens', async (t) => {
  const dir = sandbox(t);
  await runNode(CLI, ['--dir', dir, '--fix']);

  assert.match(read(dir, 'Dockerfile'), /^ARG npm_config_\/\/registry\.npmjs\.org\/:_authToken$/m);
  assert.match(read(dir, '.github/workflows/ci.yml'), /npm_config_\/\/registry\.npmjs\.org\/:_authToken:/);
});

test('--fix inserts COPY pnpm-workspace.yaml immediately before the install', async (t) => {
  const dir = sandbox(t);
  await runNode(CLI, ['--dir', dir, '--fix']);

  const lines = read(dir, 'Dockerfile').split(/\r?\n/);
  const copyIndex = lines.findIndex((l) => l.trim() === 'COPY pnpm-workspace.yaml .');
  const installIndex = lines.findIndex((l) => /RUN pnpm install/.test(l));

  assert.ok(copyIndex !== -1, 'the COPY must be inserted');
  assert.equal(copyIndex + 1, installIndex, 'and sit directly above the install');
});

test('--fix leaves the fixed files structurally valid', async (t) => {
  const dir = sandbox(t);
  await runNode(CLI, ['--dir', dir, '--fix']);

  const doc = yaml.load(read(dir, '.github/workflows/ci.yml'));
  assert.equal(typeof doc.jobs.build, 'object');
  assert.deepEqual(Object.keys(doc.env), ['pnpm_config_prefer_offline', 'NODE_ENV']);

  // Every original Dockerfile instruction keyword survives, in order.
  const keywords = read(dir, 'Dockerfile')
    .split(/\r?\n/)
    .map((l) => /^([A-Z]+)\s/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => m[1]);
  assert.equal(keywords[0], 'FROM');
  assert.ok(keywords.includes('CMD'));
});

test('--fix is idempotent — a second run finds nothing left to fix', async (t) => {
  const dir = sandbox(t);
  await runNode(CLI, ['--dir', dir, '--fix']);
  const afterFirst = read(dir, 'Dockerfile');

  const { stdout } = await runNode(CLI, ['--dir', dir, '--fix']);
  assert.match(stdout, /No automatic fixes applied\./);
  assert.equal(read(dir, 'Dockerfile'), afterFirst, 'nothing should change on a second pass');
});

test('--fix clears every autofixable finding and reports the honest remainder', async (t) => {
  const dir = sandbox(t);
  const before = JSON.parse((await runNode(CLI, ['--dir', dir, '--json'])).stdout);
  await runNode(CLI, ['--dir', dir, '--fix']);
  const after = JSON.parse((await runNode(CLI, ['--dir', dir, '--json'])).stdout);

  const autofixable = ['docker-npm-config-env', 'workflow-npm-config-env', 'docker-missing-workspace-copy'];
  const remaining = [...after.fail, ...after.warn].filter((f) => autofixable.includes(f.rule));

  assert.equal(remaining.length, 0, `still fixable: ${remaining.map((f) => f.short).join('; ')}`);
  assert.ok(before.fail.length > after.fail.length);
  assert.ok(before.warn.length > after.warn.length);

  // What is left genuinely needs a human or pnpm's own codemod.
  const leftRules = new Set([...after.fail, ...after.warn].map((f) => f.rule));
  assert.deepEqual(
    [...leftRules].sort(),
    ['docker-missing-ci-env', 'package-json-pnpm-field', 'shadowed-builtin-call']
  );
});

test('--fix points users at pnpm\'s own codemod for the pnpm field', async (t) => {
  const dir = sandbox(t);
  const { stdout } = await runNode(CLI, ['--dir', dir, '--fix']);
  assert.match(stdout, /pnpx codemod run pnpm-v10-to-v11/);
});

test('--fix --json reports what changed in the payload', async (t) => {
  const dir = sandbox(t);
  const { stdout } = await runNode(CLI, ['--dir', dir, '--fix', '--json']);

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.fixed.dryRun, false);
  assert.equal(parsed.fixed.files.length, 2);
  assert.deepEqual(parsed.fixed.skipped, []);

  const dockerfile = parsed.fixed.files.find((f) => f.file === 'Dockerfile');
  assert.equal(dockerfile.edits.length, 4);
  assert.ok(dockerfile.edits.some((e) => e.inserted));
});

test('--fix on a clean project changes nothing and exits 0', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm11-guard-clean-'));
  fs.cpSync(path.join(ROOT, 'examples', 'clean-project'), dir, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const before = read(dir, 'Dockerfile');
  const { code, stdout } = await runNode(CLI, ['--dir', dir, '--fix']);

  assert.equal(code, 0);
  assert.match(stdout, /No automatic fixes applied\./);
  assert.equal(read(dir, 'Dockerfile'), before);
});

test('--fix preserves CRLF line endings', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm11-guard-crlf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'crlf' }));
  fs.writeFileSync(
    path.join(dir, 'Dockerfile'),
    ['FROM node:24-alpine', 'ENV npm_config_registry=https://example.com/', 'RUN echo hi'].join('\r\n')
  );

  await runNode(CLI, ['--dir', dir, '--fix']);
  const updated = read(dir, 'Dockerfile');

  assert.match(updated, /ENV pnpm_config_registry=/);
  assert.ok(updated.includes('\r\n'), 'CRLF must survive');
  assert.equal(/(?<!\r)\n/.test(updated), false, 'no bare LF should be introduced');
});
