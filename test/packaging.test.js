'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT } = require('./helpers/run.js');

const pkg = require('../package.json');

test('package.json carries everything npm needs to publish', () => {
  assert.equal(pkg.name, 'pnpm11-ci-guard');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.description.length > 40);
  assert.ok(pkg.author);
  assert.ok(pkg.repository && pkg.repository.url.includes('github.com'));
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length >= 5);
  assert.ok(pkg.homepage);
  assert.ok(pkg.bugs && pkg.bugs.url);
});

test('the bin entrypoint is wired and executable as a script', () => {
  assert.equal(pkg.bin['pnpm11-ci-guard'], 'bin/cli.js');
  const binPath = path.join(ROOT, 'bin', 'cli.js');
  assert.ok(fs.existsSync(binPath));
  assert.match(fs.readFileSync(binPath, 'utf8'), /^#!\/usr\/bin\/env node/);
});

test('the package main entrypoint loads and exposes the public API', () => {
  const api = require(path.join(ROOT, pkg.main));
  assert.equal(typeof api.scan, 'function');
  assert.equal(typeof api.formatText, 'function');
  assert.equal(typeof api.formatJson, 'function');
  assert.equal(typeof api.ScanError, 'function');
  assert.equal(api.VERSION, pkg.version);
});

test('every file listed in "files" exists', () => {
  for (const entry of pkg.files) {
    const target = path.join(ROOT, entry.replace(/\/$/, ''));
    assert.ok(fs.existsSync(target), `"files" lists ${entry}, which does not exist`);
  }
});

test('the shipped package declares exactly one runtime dependency', () => {
  assert.deepEqual(Object.keys(pkg.dependencies), ['js-yaml']);
  assert.equal(pkg.devDependencies, undefined, 'no devDependencies needed — tests use node:test');
});

test('LICENSE, README and CHANGELOG are present', () => {
  for (const name of ['LICENSE', 'README.md', 'CHANGELOG.md', '.gitignore']) {
    assert.ok(fs.existsSync(path.join(ROOT, name)), `${name} is missing`);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'), /MIT License/);
});

test('.gitignore ignores node_modules but NOT the committed action bundle', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const lines = ignore.split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('node_modules/'));
  assert.equal(lines.some((l) => l === 'dist' || l === 'dist/'), false);
});

test('the README documents install, usage and the JSON contract', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /npx pnpm11-ci-guard/);
  assert.match(readme, /uses: Booyaka101\/pnpm11-ci-guard/);
  assert.match(readme, /--json/);
  assert.match(readme, /Limitations/i);
  assert.match(readme, /pnpm\.io\/blog\/releases\/11\.0/);
});

test('--help lists exactly the rules that actually exist', () => {
  const { USAGE } = require('../src/cli-main.js');
  const { ALL_RULES } = require('../src/findings.js');

  for (const rule of ALL_RULES) {
    assert.ok(USAGE.includes(rule), `--help does not document the '${rule}' rule`);
  }
  // And nothing that was removed lingers in the help text.
  const documented = USAGE.match(/^\s{2}(?:FAIL|WARN)\s{2}([a-z-]+)/gm)
    .map((l) => l.trim().split(/\s+/)[1]);
  for (const rule of documented) {
    assert.ok(ALL_RULES.includes(rule), `--help documents '${rule}', which is not a real rule`);
  }
});

test('no source file ships a TODO, FIXME or "not implemented" marker', () => {
  const offenders = [];
  const scanDirs = ['src', 'bin', 'scripts'];

  for (const dir of scanDirs) {
    for (const file of fs.readdirSync(path.join(ROOT, dir))) {
      if (!file.endsWith('.js')) continue;
      const source = fs.readFileSync(path.join(ROOT, dir, file), 'utf8');
      if (/\b(TODO|FIXME|XXX|HACK|not implemented|coming soon)\b/i.test(source)) {
        offenders.push(`${dir}/${file}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
