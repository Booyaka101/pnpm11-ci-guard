'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const { runNode, ROOT } = require('./helpers/run.js');

const BUNDLE = path.join(ROOT, 'dist', 'action.js');
const ACTION_YML = path.join(ROOT, 'action.yml');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm11-guard-action-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('action.yml declares runs.using node24 and dist/action.js', () => {
  const doc = yaml.load(fs.readFileSync(ACTION_YML, 'utf8'));
  assert.equal(doc.runs.using, 'node24');
  assert.equal(doc.runs.main, 'dist/action.js');
  assert.equal(doc.name, 'pnpm11-ci-guard');
  assert.equal(doc.inputs['root-dir'].default, '.');
  assert.equal(doc.inputs.mode.default, 'fail');
  assert.ok(typeof doc.description === 'string' && doc.description.length > 20);
});

test('the bundle referenced by action.yml exists on disk', () => {
  const doc = yaml.load(fs.readFileSync(ACTION_YML, 'utf8'));
  assert.ok(fs.existsSync(path.join(ROOT, doc.runs.main)), `${doc.runs.main} must be committed`);
});

test('the bundle is self-contained — it requires only node builtins', () => {
  const source = fs.readFileSync(BUNDLE, 'utf8');
  const external = new Set();
  const re = /\brequire\((['"])([^'"]+)\1\)/g;
  let m;
  while ((m = re.exec(source)) !== null) external.add(m[2]);

  for (const id of external) {
    const isBuiltin = id.startsWith('node:');
    const isInternal = id.startsWith('./') || id.startsWith('../') || id === 'js-yaml';
    assert.ok(isBuiltin || isInternal, `bundle must not require '${id}' at runtime`);
  }
  assert.ok(source.includes('js-yaml'), 'js-yaml must be inlined into the bundle');
});

test('the action reports findings, sets outputs, writes a summary and exits 1', async (t) => {
  const dir = tempDir(t);
  const outputFile = path.join(dir, 'output.txt');
  const summaryFile = path.join(dir, 'summary.md');

  const { code, stdout } = await runNode(BUNDLE, [], {
    env: {
      'INPUT_ROOT-DIR': path.join(ROOT, 'examples', 'broken-project'),
      INPUT_MODE: 'fail',
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    },
  });

  assert.equal(code, 1);
  assert.match(stdout, /^::error file=package\.json,line=\d+,title=/m);
  assert.match(stdout, /^::warning file=\.github\/workflows\/ci\.yml,line=\d+,title=/m);
  assert.match(stdout, /=== FAIL ===/);

  const outputs = fs.readFileSync(outputFile, 'utf8');
  assert.match(outputs, /^fail-count=3$/m);
  assert.match(outputs, /^warn-count=7$/m);
  assert.match(outputs, /^ok=false$/m);
  assert.match(outputs, /^json<<ghadelimiter_json_\d+$/m);

  const summary = fs.readFileSync(summaryFile, 'utf8');
  assert.match(summary, /## pnpm11-ci-guard/);
  assert.match(summary, /\| Severity \| File \| Line \| Issue \|/);
});

test('the action exits 0 on a clean project', async (t) => {
  const dir = tempDir(t);
  const outputFile = path.join(dir, 'output.txt');

  const { code, stdout } = await runNode(BUNDLE, [], {
    env: {
      'INPUT_ROOT-DIR': path.join(ROOT, 'examples', 'clean-project'),
      INPUT_MODE: 'fail',
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
    },
  });

  assert.equal(code, 0);
  assert.match(stdout, /=== OK ===/);
  assert.match(fs.readFileSync(outputFile, 'utf8'), /^ok=true$/m);
});

test('action.yml documents the ignore input, and the action honours it', async (t) => {
  const doc = yaml.load(fs.readFileSync(ACTION_YML, 'utf8'));
  assert.equal(doc.inputs.ignore.default, '');

  const dir = tempDir(t);
  const outputFile = path.join(dir, 'output.txt');

  const { code } = await runNode(BUNDLE, [], {
    env: {
      'INPUT_ROOT-DIR': path.join(ROOT, 'examples', 'broken-project'),
      INPUT_IGNORE:
        'package-json-pnpm-field,docker-missing-workspace-copy,shadowed-builtin-call',
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
    },
  });

  assert.equal(code, 0, 'suppressing every FAIL rule should pass the job');
  assert.match(fs.readFileSync(outputFile, 'utf8'), /^fail-count=0$/m);
});

test('the action rejects an unknown ignore rule with an ::error annotation', async (t) => {
  const dir = tempDir(t);
  const { code, stdout } = await runNode(BUNDLE, [], {
    env: {
      'INPUT_ROOT-DIR': path.join(ROOT, 'examples', 'clean-project'),
      INPUT_IGNORE: 'not-a-real-rule',
      GITHUB_OUTPUT: path.join(dir, 'output.txt'),
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
    },
  });

  assert.equal(code, 1);
  assert.match(stdout, /^::error title=pnpm11-ci-guard::Unknown rule id in --ignore: not-a-real-rule/m);
});

test('the action honours mode: warn', async (t) => {
  const dir = tempDir(t);
  const { code } = await runNode(BUNDLE, [], {
    env: {
      'INPUT_ROOT-DIR': path.join(ROOT, 'examples', 'broken-project'),
      INPUT_MODE: 'warn',
      GITHUB_OUTPUT: path.join(dir, 'output.txt'),
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
    },
  });
  assert.equal(code, 0);
});

test('the action defaults root-dir to the working directory when no input is set', async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', pnpm: { overrides: {} } }));

  const { code, stdout } = await runNode(BUNDLE, [], {
    cwd: dir,
    env: {
      GITHUB_OUTPUT: path.join(dir, 'output.txt'),
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
    },
  });

  assert.equal(code, 1);
  assert.match(stdout, /'pnpm' field ignored by pnpm v11/);
});

test('a bad root-dir produces an ::error annotation, not a crash', async (t) => {
  const dir = tempDir(t);
  const { code, stdout, stderr } = await runNode(BUNDLE, [], {
    env: {
      'INPUT_ROOT-DIR': path.join(dir, 'nowhere'),
      GITHUB_OUTPUT: path.join(dir, 'output.txt'),
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
    },
  });

  assert.equal(code, 1);
  assert.match(stdout, /^::error title=pnpm11-ci-guard::Directory not found/m);
  assert.equal(stderr, '');
});

test('the action survives an unwritable GITHUB_OUTPUT target', async (t) => {
  const dir = tempDir(t);
  const { code, stdout } = await runNode(BUNDLE, [], {
    env: {
      'INPUT_ROOT-DIR': path.join(ROOT, 'examples', 'clean-project'),
      // A directory can never be appended to as a file.
      GITHUB_OUTPUT: dir,
      GITHUB_STEP_SUMMARY: dir,
    },
  });

  assert.equal(code, 0);
  assert.match(stdout, /::warning::pnpm11-ci-guard could not write GITHUB_OUTPUT/);
});

test('the committed bundle is byte-identical to a fresh build', async () => {
  const before = fs.readFileSync(BUNDLE);
  const { code } = await runNode(path.join(ROOT, 'scripts', 'build-action.js'));
  assert.equal(code, 0);
  const after = fs.readFileSync(BUNDLE);
  assert.ok(before.equals(after), 'dist/action.js is stale — run `npm run build` and commit it');
});
