'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { scan, ScanError, RULES } = require('../src/index.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (name) => path.join(FIXTURES, name);

const rules = (findings) => findings.map((f) => f.rule);
const keys = (findings) => findings.map((f) => f.key);
const shorts = (findings) => findings.map((f) => f.short).join('\n');

test('DETECTION 3 — top-level pnpm field fires FAIL and lists the found keys', () => {
  const result = scan({ dir: fixture('full') });
  const finding = result.fail.find((f) => f.rule === RULES.PACKAGE_JSON_PNPM_FIELD);

  assert.ok(finding, 'expected a package-json-pnpm-field FAIL');
  assert.equal(finding.file, 'package.json');
  assert.match(finding.message, /Found keys: overrides, peerDependencyRules/);
  assert.match(finding.message, /move settings to pnpm-workspace\.yaml/);
});

test('DETECTION 3 — a nested "pnpm" devDependency is not mistaken for the field', () => {
  const result = scan({ dir: fixture('full') });
  const finding = result.fail.find((f) => f.rule === RULES.PACKAGE_JSON_PNPM_FIELD);
  // devDependencies."pnpm" sits on line 6; the real field starts on line 8.
  assert.equal(finding.line, 8);
});

test('DETECTION 3 — a project without the field produces no FAIL', () => {
  const result = scan({ dir: fixture('clean') });
  assert.deepEqual(rules(result.fail), []);
});

test('DETECTION 1 — ENV/ARG npm_config_* in a Dockerfile fires WARN with line numbers', () => {
  const result = scan({ dir: fixture('full') });
  const docker = result.warn.filter((f) => f.rule === RULES.DOCKER_NPM_CONFIG_ENV);

  assert.deepEqual(keys(docker), ['npm_config_prefer_offline', 'NPM_CONFIG_REGISTRY']);
  assert.deepEqual(docker.map((f) => f.line), [3, 5]);
  assert.match(docker[0].message, /rename to pnpm_config_prefer_offline/);
  assert.match(docker[1].message, /rename to PNPM_CONFIG_REGISTRY/);
});

test('DETECTION 1 — npm_config_//… scoped auth tokens are NOT flagged (pnpm 11.6+ still reads them)', () => {
  const result = scan({ dir: fixture('full') });
  const all = [...result.fail, ...result.warn];
  assert.equal(
    all.some((f) => f.key && f.key.includes('//registry.npmjs.org')),
    false,
    'URL-scoped auth token must never be reported'
  );
});

test('DETECTION 1 — unrelated ENV keys are left alone', () => {
  const result = scan({ dir: fixture('full') });
  assert.equal(result.warn.some((f) => f.key === 'UNRELATED'), false);
});

test('DETECTION 1 — backslash continuations report the physical line of each key', () => {
  const result = scan({ dir: fixture('continuation') });
  const docker = result.warn.filter((f) => f.rule === RULES.DOCKER_NPM_CONFIG_ENV);

  assert.deepEqual(keys(docker), ['npm_config_prefer_offline']);
  assert.equal(docker[0].line, 4, 'key is on the second physical line of the ENV instruction');
  assert.equal(docker[0].file, 'Dockerfile.build');
});

test('DETECTION 2 — env.npm_config_* fires at workflow root, job and step level', () => {
  const result = scan({ dir: fixture('full') });
  const wf = result.warn.filter((f) => f.rule === RULES.WORKFLOW_NPM_CONFIG_ENV);

  assert.deepEqual(keys(wf), [
    'npm_config_prefer_offline',
    'npm_config_registry',
    'NPM_CONFIG_FUND',
    'npm_config_loglevel',
  ]);

  const contexts = wf.map((f) => f.context);
  assert.equal(contexts[0], 'workflow root');
  assert.equal(contexts[1], "job 'build'");
  assert.equal(contexts[2], "step 'Install' in job 'build'");
  assert.match(contexts[3], /^step #1 \('pnpm lint'\) in job 'lint'$/);

  for (const f of wf) {
    assert.equal(f.file, '.github/workflows/ci.yml');
    assert.match(f.message, /is silently ignored by pnpm v11$/);
  }
});

test('DETECTION 2 — step env auth token is exempt while its sibling key is flagged', () => {
  const result = scan({ dir: fixture('full') });
  const stepFindings = result.warn.filter((f) => f.context && f.context.startsWith("step 'Install'"));
  assert.deepEqual(keys(stepFindings), ['NPM_CONFIG_FUND']);
});

test('DETECTION 4 — pnpm install without COPY pnpm-workspace.yaml fires FAIL', () => {
  const result = scan({ dir: fixture('full') });
  const finding = result.fail.find((f) => f.rule === RULES.DOCKER_MISSING_WORKSPACE_COPY);

  assert.ok(finding, 'expected a docker-missing-workspace-copy FAIL');
  assert.equal(finding.file, 'Dockerfile');
  assert.match(finding.message, /add: COPY pnpm-workspace\.yaml \./);
});

test('DETECTION 4 — does not fire when the project has no pnpm-workspace.yaml', () => {
  const result = scan({ dir: fixture('no-workspace') });
  assert.equal(result.hasWorkspaceYaml, false);
  assert.deepEqual(rules(result.fail), []);
});

test('DETECTION 4 — `COPY . .` before the install satisfies the requirement', () => {
  const result = scan({ dir: fixture('copy-context') });
  assert.deepEqual(rules(result.fail), [], shorts(result.fail));
});

test('DETECTION 4 — a `COPY . .` placed AFTER the install does not satisfy it', () => {
  const result = scan({ dir: fixture('copy-after-install') });
  assert.deepEqual(rules(result.fail), [RULES.DOCKER_MISSING_WORKSPACE_COPY]);
});

test('DETECTION 4 — an explicit multi-source COPY that names the file satisfies it', () => {
  const result = scan({ dir: fixture('clean') });
  assert.deepEqual(rules(result.fail), []);
});

test('DETECTION 4 — `pnpm import` and `pnpm run install-deps` are not installs', () => {
  const result = scan({ dir: fixture('continuation') });
  assert.deepEqual(rules(result.fail), [], shorts(result.fail));
});

test('a fully migrated project reports nothing at all', () => {
  const result = scan({ dir: fixture('clean') });
  assert.equal(result.ok, true);
  assert.equal(result.fail.length, 0);
  assert.equal(result.warn.length, 0);
  assert.equal(result.exitCode, 0);
  assert.match(result.summary, /^No pnpm v11 issues found/);
});

test('malformed JSON and YAML degrade to a WARN instead of throwing', () => {
  const result = scan({ dir: fixture('malformed') });
  const bad = result.warn.filter((f) => f.rule === RULES.UNREADABLE_INPUT);

  assert.equal(bad.length, 2, shorts(result.warn));
  assert.ok(bad.some((f) => f.file === 'package.json' && /not valid JSON/.test(f.message)));
  assert.ok(bad.some((f) => f.file.endsWith('broken.yml') && /not valid YAML/.test(f.message)));
  assert.equal(result.exitCode, 0, 'unreadable input is a warning, never a hard failure');
});

test('mode: warn keeps the findings but exits 0', () => {
  const strict = scan({ dir: fixture('full'), mode: 'fail' });
  const lenient = scan({ dir: fixture('full'), mode: 'warn' });

  assert.equal(strict.exitCode, 1);
  assert.equal(lenient.exitCode, 0);
  assert.equal(lenient.fail.length, strict.fail.length);
  assert.ok(lenient.fail.length > 0);
});

test('an invalid mode is rejected with a clear ScanError', () => {
  assert.throws(() => scan({ dir: fixture('clean'), mode: 'explode' }), (err) => {
    assert.ok(err instanceof ScanError);
    assert.equal(err.code, 'BAD_MODE');
    assert.match(err.message, /Expected 'fail' or 'warn'/);
    return true;
  });
});

test('a missing directory is reported, not thrown as a stack trace', () => {
  assert.throws(() => scan({ dir: fixture('definitely-not-here') }), (err) => {
    assert.ok(err instanceof ScanError);
    assert.equal(err.code, 'NO_DIR');
    assert.match(err.message, /Directory not found/);
    return true;
  });
});

test('pointing at a file instead of a directory is reported clearly', () => {
  assert.throws(() => scan({ dir: path.join(fixture('clean'), 'package.json') }), (err) => {
    assert.ok(err instanceof ScanError);
    assert.equal(err.code, 'NOT_A_DIR');
    return true;
  });
});

test('an empty directory scans successfully and reports nothing', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm11-guard-empty-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = scan({ dir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.scanned, { dockerfiles: 0, workflows: 0, packageJsons: 0 });
});

test('findings are sorted deterministically by file then line', () => {
  const a = scan({ dir: fixture('full') });
  const b = scan({ dir: fixture('full') });
  assert.deepEqual(shorts(a.warn), shorts(b.warn));

  const files = a.warn.map((f) => f.file);
  assert.deepEqual(files, files.slice().sort());
});

test('node_modules is never scanned', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm11-guard-nm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, 'node_modules', 'evil'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'node_modules', 'evil', 'package.json'),
    JSON.stringify({ name: 'evil', pnpm: { overrides: {} } })
  );

  const result = scan({ dir });
  assert.equal(result.fail.length, 0);
  assert.equal(result.scanned.packageJsons, 0);
});
