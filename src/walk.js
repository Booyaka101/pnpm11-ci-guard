'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Directories that never contain project-authored CI config, and that make a
 * naive recursive walk unusably slow (or produce findings for code you do not own).
 */
const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.pnpm',
  '.pnpm-store',
  '.yarn',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
]);

const MAX_DEPTH = 24;

/** `Dockerfile`, `Dockerfile.<anything>`, `<anything>.dockerfile` — case-insensitive. */
function isDockerfileName(name) {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return true;
  if (lower.startsWith('dockerfile.')) return true;
  if (lower.endsWith('.dockerfile')) return true;
  return false;
}

function isYamlName(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.yml') || lower.endsWith('.yaml');
}

/** True when `dir` is (or is inside) a `.github/workflows` directory. */
function isWorkflowsDir(relDir) {
  const parts = relDir.split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i] === '.github' && parts[i + 1] === 'workflows') return true;
  }
  return false;
}

/**
 * One pass over the tree. Returns absolute paths grouped by what each checker needs.
 *
 * @param {string} rootDir absolute path to scan
 * @param {{ignoreDirs?: Set<string>}} [opts]
 * @returns {{dockerfiles: string[], workflows: string[], packageJsons: string[], errors: {path: string, message: string}[]}}
 */
function walkProject(rootDir, opts = {}) {
  const ignored = opts.ignoreDirs || DEFAULT_IGNORED_DIRS;
  const dockerfiles = [];
  const workflows = [];
  const packageJsons = [];
  const errors = [];

  /** @type {{abs: string, depth: number}[]} */
  const queue = [{ abs: rootDir, depth: 0 }];
  const seen = new Set();

  while (queue.length > 0) {
    const { abs, depth } = queue.shift();
    let real;
    try {
      real = fs.realpathSync(abs);
    } catch {
      real = abs;
    }
    if (seen.has(real)) continue; // symlink loop guard
    seen.add(real);

    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      errors.push({ path: abs, message: describeFsError(err) });
      continue;
    }

    const relDir = path.relative(rootDir, abs);

    for (const entry of entries) {
      const childAbs = path.join(abs, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const st = fs.statSync(childAbs);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue; // broken symlink — nothing to read
        }
      }

      if (isDir) {
        if (ignored.has(entry.name)) continue;
        if (depth + 1 > MAX_DEPTH) continue;
        queue.push({ abs: childAbs, depth: depth + 1 });
        continue;
      }
      if (!isFile) continue;

      if (isDockerfileName(entry.name)) {
        dockerfiles.push(childAbs);
      } else if (entry.name === 'package.json') {
        packageJsons.push(childAbs);
      } else if (isYamlName(entry.name) && isWorkflowsDir(path.join(relDir, entry.name))) {
        workflows.push(childAbs);
      }
    }
  }

  dockerfiles.sort();
  workflows.sort();
  packageJsons.sort();
  return { dockerfiles, workflows, packageJsons, errors };
}

function describeFsError(err) {
  if (!err || typeof err !== 'object') return String(err);
  switch (err.code) {
    case 'EACCES':
    case 'EPERM':
      return 'permission denied';
    case 'ENOENT':
      return 'no such file or directory';
    case 'ENOTDIR':
      return 'not a directory';
    case 'EMFILE':
    case 'ENFILE':
      return 'too many open files';
    case 'ELOOP':
      return 'symbolic link loop';
    default:
      return err.message || String(err);
  }
}

/** Read a UTF-8 text file, returning `null` (never throwing) when unreadable. */
function readTextFile(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    // Strip a UTF-8 BOM so `^ENV` style anchors still match on the first line.
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      return buf.subarray(3).toString('utf8');
    }
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_IGNORED_DIRS,
  isDockerfileName,
  isYamlName,
  isWorkflowsDir,
  walkProject,
  readTextFile,
  describeFsError,
};
