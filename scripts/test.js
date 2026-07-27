#!/usr/bin/env node
'use strict';

/**
 * Cross-version test runner.
 *
 * `node --test "test/*.test.js"` only works on Node 21+, where the test runner
 * learned to expand glob patterns itself. On Node 18 and 20 it fails with
 * "Could not find '.../test/*.test.js'", and on Windows the shell does not expand
 * the glob either. Passing explicit file paths works on every supported version
 * and on every platform, so that is what we do.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

const files = fs
  .readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(TEST_DIR, name));

if (files.length === 0) {
  process.stderr.write('No test files found in test/\n');
  process.exit(1);
}

const args = ['--test', ...process.argv.slice(2), ...files];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: ROOT });

child.on('error', (err) => {
  process.stderr.write(`Could not start the test runner: ${err.message}\n`);
  process.exit(1);
});
child.on('close', (code, signal) => {
  if (signal) {
    process.stderr.write(`Test runner terminated by ${signal}\n`);
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});
