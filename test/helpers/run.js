'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Run a Node script as a child process and resolve with its result.
 * Always async `spawn` — never `spawnSync` — so nothing can deadlock the runner.
 *
 * @param {string} script absolute path to the script to run
 * @param {string[]} args
 * @param {{env?: Record<string,string>, cwd?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{code: number|null, signal: string|null, stdout: string, stderr: string}>}
 */
function runNode(script, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, NO_COLOR: '1', ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out after ${opts.timeoutMs || 30000}ms: ${script} ${args.join(' ')}`));
    }, opts.timeoutMs || 30000);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

module.exports = { runNode, ROOT };
