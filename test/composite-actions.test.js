'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scan, RULES } = require('../src/index.js');
const { applyFixes } = require('../src/fix.js');
const { runNode, ROOT } = require('./helpers/run.js');

function sandbox(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm11-guard-composite-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return dir;
}

const action = `name: Install
runs:
  using: composite
  steps:
    - name: Install
      shell: bash
      env:
        npm_config_registry: 'https://registry.example' # keep
      run: |
        pnpm install -g
        pnpm install --resolution-only
        pnpm rebuild
`;

for (const name of ['.github/actions/install/action.yml', 'tools/install/action.yaml']) {
  test(`composite steps reuse migration checks in ${name}`, (t) => {
    const dir = sandbox(t, {
      [name]: action,
      'package.json': JSON.stringify({ scripts: { rebuild: 'echo local' } }),
    });
    const result = scan({ dir });
    assert.equal(result.scanned.actions, 1);
    assert.equal(result.scanned.workflows, 0);
    assert.match(result.summary, /1 action manifest\(s\)/);
    const findings = [...result.fail, ...result.warn].filter((f) => f.file === name);
    assert.equal(findings.length, 4);
    assert.ok(findings.every((f) => f.context.includes('composite action')));
    assert.equal(findings.find((f) => f.rule === RULES.WORKFLOW_NPM_CONFIG_ENV).line, 8);
    assert.equal(findings.find((f) => f.rule === RULES.UNSUPPORTED_GLOBAL_INSTALL).line, 10);
    assert.ok(findings.some((f) => f.rule === RULES.SHADOWED_BUILTIN_CALL));
    assert.ok(findings.some((f) => f.line === 11));
  });
}

test('composite env fixes preserve values and layout, support dry-run and are idempotent', (t) => {
  const name = 'local/action.yml';
  const dir = sandbox(t, { [name]: action.replace(/\n/g, '\r\n') });
  const file = path.join(dir, name);
  const before = fs.readFileSync(file, 'utf8');
  const result = scan({ dir });
  const dry = applyFixes(result, { rootDir: dir, dryRun: true });
  assert.equal(dry.changed.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  applyFixes(result, { rootDir: dir });
  assert.equal(fs.readFileSync(file, 'utf8'), before.replace('npm_config_registry:', 'pnpm_config_registry:'));
  assert.equal(applyFixes(scan({ dir }), { rootDir: dir }).changed.length, 0);
});

test('CLI JSON and rule suppression include composite findings', async (t) => {
  const dir = sandbox(t, { 'local/action.yml': action });
  const cli = path.join(ROOT, 'bin', 'cli.js');
  const result = await runNode(cli, ['--dir', dir, '--json']);
  assert.equal(result.code, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.scanned.actions, 1);
  const ignored = await runNode(cli, ['--dir', dir, '--json', '--ignore',
    [...new Set([...payload.fail, ...payload.warn].map((f) => f.rule))].join(',')]);
  assert.equal(ignored.code, 0);
  assert.equal(JSON.parse(ignored.stdout).suppressed, 3);
});

test('non-composite action metadata and unrelated YAML are not interpreted as steps', (t) => {
  const dir = sandbox(t, {
    'node/action.yml': action.replace('using: composite', 'using: node24'),
    'docker/action.yaml': action.replace('using: composite', 'using: docker'),
    'other/config.yml': action,
  });
  const result = scan({ dir });
  assert.equal(result.scanned.actions, 2);
  assert.deepEqual([...result.fail, ...result.warn], []);
});

test('composite metadata outside runs.steps is not an environment or command', (t) => {
  const dir = sandbox(t, { 'action.yml': `name: Example
env:
  npm_config_registry: ignored-root
inputs:
  example:
    default: pnpm install -g
runs:
  using: composite
  steps:
    - uses: owner/action@v1
      with:
        npm_config_registry: input-not-env
` });
  assert.deepEqual(scan({ dir }).warn, []);
  assert.deepEqual(scan({ dir }).fail, []);
});

test('composite discovery respects dependency/build exclusions', (t) => {
  const dir = sandbox(t, {
    'node_modules/pkg/action.yml': action,
    'dist/action.yaml': action,
    'vendor/action.yml': action,
  });
  assert.equal(scan({ dir }).scanned.actions, 0);
});

test('repeated composite keys report findings without fixing the wrong step or metadata', (t) => {
  const source = action.replace('runs:', 'inputs:\n  npm_config_registry:\n    default: example\nruns:');
  const dir = sandbox(t, { 'action.yml': source });
  const result = scan({ dir });
  const warning = result.warn.find((f) => f.rule === RULES.WORKFLOW_NPM_CONFIG_ENV);
  assert.equal(warning.line, null);
  const fixed = applyFixes(result, { rootDir: dir });
  assert.equal(fixed.changed.length, 0);
  assert.equal(fixed.skipped.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'action.yml'), 'utf8'), source);
});

test('malformed action YAML is reported rather than silently skipped', (t) => {
  const dir = sandbox(t, { 'action.yaml': 'runs: [broken' });
  const result = scan({ dir });
  assert.equal(result.warn.length, 1);
  assert.equal(result.warn[0].file, 'action.yaml');
});

test('malformed composite steps are tolerated and scoped auth remains supported', (t) => {
  const dir = sandbox(t, { 'action.yml': `runs:
  using: composite
  steps:
    - null
    - invalid
    - run: 42
      env: invalid
    - shell: bash
      run: pnpm install
      env:
        npm_config_//registry.npmjs.org/:_authToken: token
` });
  assert.deepEqual([...scan({ dir }).fail, ...scan({ dir }).warn], []);
});

test('reusable workflow job and step environments are already scanned', (t) => {
  const dir = sandbox(t, { '.github/workflows/reusable.yaml': `on:
  workflow_call:
jobs:
  install:
    runs-on: ubuntu-latest
    env:
      npm_config_registry: example
    steps:
      - run: pnpm install --resolution-only
        env:
          npm_config_fund: 'false'
` });
  const result = scan({ dir });
  assert.equal(result.scanned.workflows, 1);
  assert.equal(result.scanned.actions, 0);
  assert.equal(result.warn.filter((f) => f.rule === RULES.WORKFLOW_NPM_CONFIG_ENV).length, 2);
  assert.equal(result.fail.length, 1);
});

test('a workflow named action.yml remains a workflow, not an action manifest', (t) => {
  const dir = sandbox(t, { '.github/workflows/action.yml': `jobs:
  install:
    steps:
      - run: pnpm install -g
` });
  const result = scan({ dir });
  assert.equal(result.scanned.workflows, 1);
  assert.equal(result.scanned.actions, 0);
  assert.equal(result.fail.length, 1);
});
