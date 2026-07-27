'use strict';

/**
 * Rendering only — no I/O, no process access beyond the colour decision the
 * caller passes in. Keeps the output identical between the CLI and the Action.
 */

const ESCAPE = String.fromCharCode(27);

const COLORS = {
  reset: `${ESCAPE}[0m`,
  bold: `${ESCAPE}[1m`,
  dim: `${ESCAPE}[2m`,
  red: `${ESCAPE}[31m`,
  yellow: `${ESCAPE}[33m`,
  green: `${ESCAPE}[32m`,
};

function paint(text, color, useColor) {
  if (!useColor || !COLORS[color]) return text;
  return COLORS[color] + text + COLORS.reset;
}

/**
 * @param {ReturnType<import('./index.js').scan>} result
 * @param {{color?: boolean}} [opts]
 * @returns {string}
 */
function formatText(result, opts = {}) {
  const color = Boolean(opts.color);
  const out = [];

  if (result.fail.length > 0) {
    out.push(paint('=== FAIL ===', 'red', color));
    for (const f of result.fail) out.push(`  ${f.short}`);
  }

  if (result.warn.length > 0) {
    out.push(paint('=== WARN ===', 'yellow', color));
    for (const f of result.warn) out.push(`  ${f.short}`);
  }

  if (result.fail.length === 0 && result.warn.length === 0) {
    out.push(paint('=== OK ===', 'green', color));
    out.push(`  ${result.summary}`);
    return out.join('\n');
  }

  out.push('');
  out.push(paint(result.summary, 'bold', color));
  if (result.mode === 'warn' && result.fail.length > 0) {
    out.push(paint('  (mode=warn — exiting 0 despite FAIL findings)', 'dim', color));
  }
  out.push(paint('  Docs: https://pnpm.io/blog/releases/11.0', 'dim', color));

  return out.join('\n');
}

/**
 * `--json` payload. `fail` and `warn` are the contract; everything else is
 * additive context and safe to ignore.
 *
 * @param {ReturnType<import('./index.js').scan>} result
 * @returns {string}
 */
function formatJson(result) {
  return JSON.stringify(
    {
      ok: result.ok,
      version: result.version,
      tool: 'pnpm11-ci-guard',
      root: result.root,
      mode: result.mode,
      ignored: result.ignored,
      suppressed: result.suppressed,
      hasWorkspaceYaml: result.hasWorkspaceYaml,
      scanned: result.scanned,
      summary: result.summary,
      fail: result.fail,
      warn: result.warn,
      exitCode: result.exitCode,
    },
    null,
    2
  );
}

/** GitHub Actions annotation lines (`::error file=...,line=...::message`). */
function formatAnnotations(result) {
  const lines = [];
  for (const f of result.fail) lines.push(annotation('error', f));
  for (const f of result.warn) lines.push(annotation('warning', f));
  return lines;
}

function annotation(level, finding) {
  const props = [`file=${escapeProp(finding.file)}`];
  if (finding.line) props.push(`line=${finding.line}`);
  props.push(`title=${escapeProp('pnpm v11: ' + finding.rule)}`);
  return `::${level} ${props.join(',')}::${escapeData(finding.message)}`;
}

function escapeData(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProp(value) {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** Markdown for `$GITHUB_STEP_SUMMARY`. */
function formatMarkdown(result) {
  const md = [];
  md.push('## pnpm11-ci-guard');
  md.push('');
  md.push(result.summary);
  md.push('');

  if (result.fail.length === 0 && result.warn.length === 0) {
    md.push('No pnpm v11 silent-failure patterns detected.');
    return md.join('\n');
  }

  md.push('| Severity | File | Line | Issue |');
  md.push('| --- | --- | --- | --- |');
  for (const f of [...result.fail, ...result.warn]) {
    const sev = f.severity === 'fail' ? 'FAIL' : 'WARN';
    md.push(`| ${sev} | \`${f.file}\` | ${f.line || ''} | ${escapeCell(f.message)} |`);
  }
  md.push('');
  md.push('Reference: <https://pnpm.io/blog/releases/11.0>');
  return md.join('\n');
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

module.exports = { formatText, formatJson, formatAnnotations, formatMarkdown, COLORS };
