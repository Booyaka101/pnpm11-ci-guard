'use strict';

/**
 * A deliberately small Dockerfile reader. It does not try to be a full parser —
 * it only needs to answer three questions reliably:
 *
 *   1. which physical lines belong to which instruction (backslash continuations),
 *   2. what the instruction keyword is (ENV / ARG / RUN / COPY / ADD / FROM ...),
 *   3. what the raw text of the whole instruction is.
 *
 * Docker treats instruction keywords case-insensitively, and honours the
 * `# escape=` parser directive, so we do too.
 */

/**
 * @typedef {Object} Instruction
 * @property {string} keyword uppercased instruction keyword, e.g. "ENV"
 * @property {string} text full logical text with continuations joined by a space
 * @property {number} startLine 1-based physical line where the instruction begins
 * @property {number} endLine 1-based physical line where the instruction ends
 * @property {{line: number, text: string}[]} physicalLines contributing lines, comments removed
 */

/**
 * @param {string} source raw Dockerfile contents
 * @returns {{instructions: Instruction[], lines: string[]}}
 */
function parseDockerfile(source) {
  const lines = String(source).split(/\r?\n/);
  const escapeChar = detectEscapeChar(lines);

  /** @type {Instruction[]} */
  const instructions = [];
  /** @type {null | {parts: {line: number, text: string}[], startLine: number}} */
  let pending = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();

    // Comments and blank lines never terminate a continuation in Docker's parser;
    // they are simply skipped.
    if (trimmed === '' || trimmed.startsWith('#')) {
      if (pending && trimmed === '') {
        // A truly empty line inside a continuation is allowed; keep collecting.
        continue;
      }
      continue;
    }

    const continues = endsWithEscape(trimmed, escapeChar);
    const body = continues ? trimmed.slice(0, -1).trimEnd() : trimmed;

    if (pending) {
      pending.parts.push({ line: lineNo, text: body });
    } else {
      pending = { parts: [{ line: lineNo, text: body }], startLine: lineNo };
    }

    if (!continues) {
      instructions.push(finalize(pending));
      pending = null;
    }
  }

  if (pending) instructions.push(finalize(pending));

  return { instructions, lines };
}

function finalize(pending) {
  const parts = pending.parts;
  const text = parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
  const keywordMatch = /^([A-Za-z]+)\b/.exec(text);
  return {
    keyword: keywordMatch ? keywordMatch[1].toUpperCase() : '',
    text,
    startLine: pending.startLine,
    endLine: parts[parts.length - 1].line,
    physicalLines: parts,
  };
}

function detectEscapeChar(lines) {
  // Parser directives must appear before any builder instruction or comment prose.
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('#')) break;
    const m = /^#\s*escape\s*=\s*(\S)\s*$/i.exec(trimmed);
    if (m) return m[1];
  }
  return '\\';
}

function endsWithEscape(text, escapeChar) {
  if (!text.endsWith(escapeChar)) return false;
  // An escaped escape ("\\\\") does not continue the line.
  let count = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === escapeChar; i -= 1) count += 1;
  return count % 2 === 1;
}

/**
 * Extract `key=value` style assignments plus the legacy `ENV key value` form.
 * Keys are captured with a permissive charset so that URL-scoped names such as
 * `npm_config_//registry.npmjs.org/:_authToken` survive intact.
 *
 * @param {Instruction} instruction
 * @returns {{key: string, line: number}[]}
 */
function extractAssignedKeys(instruction) {
  /** @type {{key: string, line: number}[]} */
  const found = [];
  const seen = new Set();

  const afterKeyword = instruction.text.replace(/^[A-Za-z]+\s*/, '');

  // `KEY=value` (possibly several per instruction).
  const assignRe = /(?:^|\s)([^\s=]+?)\s*=/g;
  let m;
  while ((m = assignRe.exec(afterKeyword)) !== null) {
    addKey(m[1]);
  }

  // Legacy space-separated single-variable form: `ENV KEY value`.
  if (found.length === 0 && instruction.keyword === 'ENV') {
    const legacy = /^(\S+)\s+\S/.exec(afterKeyword);
    if (legacy) addKey(legacy[1]);
  }

  // `ARG KEY` with no default value.
  if (found.length === 0 && instruction.keyword === 'ARG') {
    const bare = /^(\S+)\s*$/.exec(afterKeyword);
    if (bare) addKey(bare[1]);
  }

  return found;

  function addKey(rawKey) {
    const key = stripQuotes(rawKey);
    if (!key || key.startsWith('-')) return; // flags like --mount / --chown
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ key, line: locateKeyLine(instruction, key) });
  }
}

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Find the physical line a key token actually appears on (matters for continuations). */
function locateKeyLine(instruction, key) {
  for (const part of instruction.physicalLines) {
    if (part.text.includes(key)) return part.line;
  }
  return instruction.startLine;
}

module.exports = {
  parseDockerfile,
  extractAssignedKeys,
  detectEscapeChar,
};
