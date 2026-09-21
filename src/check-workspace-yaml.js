'use strict';

const yaml = require('js-yaml');
const { readTextFile } = require('./walk.js');
const {
  RULES,
  makeFinding,
  unreadableFileFinding,
  invalidYamlFinding,
  relPath,
} = require('./findings.js');
const {
  SNAPSHOT_DATE,
  SNAPSHOT_PNPM_VERSION,
  SCHEMA_KEY,
  NEAR_MISS_DISTANCE,
  isKnownSetting,
  isRefusedSetting,
  closestKnownSetting,
} = require('./pnpm-settings.js');

const DOCS_V12 = 'https://pnpm.io/blog/releases/12.0';

/**
 * DETECTION 9 — a top-level key in pnpm-workspace.yaml that pnpm does not recognise.
 *
 * pnpm 11 ignores such a key without a word, so a misspelled `minimumReleaseAge` reads
 * as a policy that is in force while it has never applied. pnpm 12 reports it, and the
 * severity follows pnpm's own split: a project that pins pnpm gets
 * ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS and a stopped command, everyone else gets a
 * warning and the command goes ahead.
 *
 * A key that is nowhere near a known setting stays a warning even under a pin, because
 * the settings list here is a snapshot and a future pnpm will add names it does not have.
 *
 * @param {Object} input
 * @param {string} input.rootDir
 * @param {string|null} input.workspaceYaml absolute path, or null when there is none
 * @param {{source: string, spec: string|null}|null} input.pnpmPin
 * @returns {{findings: object[]}}
 */
function checkWorkspaceYaml({ rootDir, workspaceYaml, pnpmPin }) {
  if (!workspaceYaml) return { findings: [] };

  const file = relPath(rootDir, workspaceYaml);
  const source = readTextFile(workspaceYaml);

  if (source === null) return { findings: [unreadableFileFinding(file)] };

  let doc;
  try {
    doc = yaml.load(source);
  } catch (err) {
    return { findings: [invalidYamlFinding(file, err)] };
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { findings: [] };

  const lines = source.split(/\r?\n/);
  const findings = [];

  for (const [key, value] of Object.entries(doc)) {
    if (key === SCHEMA_KEY) continue;
    // pnpm skips a key with no value, so `someSetting:` on its own never errors.
    if (value === null || value === undefined) continue;
    if (isKnownSetting(key) || isRefusedSetting(key)) continue;

    findings.push(unknownSettingFinding({ file, lines, key, pnpmPin }));
  }

  return { findings };
}

function unknownSettingFinding({ file, lines, key, pnpmPin }) {
  const line = locateTopLevelYamlKey(lines, key);
  const where = line == null ? file : `${file}:${line}`;
  const suggestion = closestKnownSetting(key);
  const nearMiss = suggestion !== null && suggestion.distance <= NEAR_MISS_DISTANCE;
  const severity = pnpmPin && nearMiss ? 'fail' : 'warn';

  const named = suggestion
    ? `'${key}' is not a pnpm setting. Did you mean '${suggestion.name}'? pnpm 11 ignored ` +
      'the key silently, so the setting has never applied.'
    : `'${key}' is not a setting pnpm recognised as of ${SNAPSHOT_DATE} ` +
      `(pnpm ${SNAPSHOT_PNPM_VERSION}), and pnpm 11 ignored it silently.`;

  const pinned = pnpmPin
    ? `package.json pins pnpm through ${describePin(pnpmPin)}, so pnpm 12 stops the command ` +
      'with ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS rather than ignoring the key.'
    : 'pnpm 12 reports the key and carries on. It fails the command with ' +
      'ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS once package.json pins pnpm.';

  const held =
    severity === 'warn' && pnpmPin
      ? ' Kept at a warning because the key is nowhere near a known setting, so it may be one a newer pnpm added.'
      : '';

  return makeFinding({
    severity,
    rule: RULES.PNPM12_UNKNOWN_WORKSPACE_SETTING,
    file,
    line,
    key,
    context: 'top-level setting',
    message: `${severity.toUpperCase()}: ${where}: ${named} ${pinned}${held}`,
    short:
      `${where}: '${key}' is not a pnpm setting` +
      (suggestion ? ` (did you mean '${suggestion.name}'?)` : '') +
      (severity === 'fail' ? ', ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS under the pnpm pin' : ''),
    fix: nearMiss
      ? `Rename '${key}' to '${suggestion.name}'`
      : `Remove '${key}', unless a newer pnpm than ${SNAPSHOT_PNPM_VERSION} introduced it`,
    docs: DOCS_V12,
  });
}

function describePin(pnpmPin) {
  if (!pnpmPin.spec) return pnpmPin.source;
  // Corepack pins often carry a 128-character +sha512 hash. The version is the useful half.
  const version = pnpmPin.spec.split('+')[0];
  return `${pnpmPin.source} (pnpm@${version})`;
}

/** Line of an unindented `key:`, quoted or not. Comments and nested keys are skipped. */
function locateTopLevelYamlKey(lines, key) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === '' || /^[\s#-]/.test(line)) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    if (unquote(line.slice(0, colon).trim()) === key) return i + 1;
  }
  return null;
}

function unquote(value) {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

module.exports = { checkWorkspaceYaml };
