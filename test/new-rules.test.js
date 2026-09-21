'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { scan, ScanError, RULES, ALL_RULES } = require('../src/index.js');
const {
  parsePnpmInvocation,
  findPnpmInvocations,
  isUnsupportedGlobalInstall,
  usesRemovedResolutionOnly,
  shadowedBuiltinCall,
} = require('../src/pnpm-commands.js');
const { httpsResolvedSshHost, readPnpmPin } = require('../src/check-package-json.js');
const {
  SNAPSHOT_DATE,
  isKnownSetting,
  isRefusedSetting,
  closestKnownSetting,
} = require('../src/pnpm-settings.js');
const { applyFixes } = require('../src/fix.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (name) => path.join(FIXTURES, name);
const byRule = (findings, rule) => findings.filter((f) => f.rule === rule);
const shorts = (findings) => findings.map((f) => f.short).join('\n');

// --- shell parsing --------------------------------------------------------

test('parsePnpmInvocation identifies the subcommand past flags', () => {
  assert.equal(parsePnpmInvocation('pnpm install --frozen-lockfile').subcommand, 'install');
  assert.equal(parsePnpmInvocation('pnpm --filter web rebuild').subcommand, 'rebuild');
  assert.equal(parsePnpmInvocation('corepack pnpm i').subcommand, 'i');
  assert.equal(parsePnpmInvocation('/usr/local/bin/pnpm run build').subcommand, 'run');
  assert.equal(
    parsePnpmInvocation('--mount=type=cache,target=/pnpm/store pnpm install -r').subcommand,
    'install'
  );
});

test('parsePnpmInvocation ignores programs that are not pnpm', () => {
  assert.equal(parsePnpmInvocation('npm install -g pnpm'), null);
  assert.equal(parsePnpmInvocation('echo pnpm install'), null);
  assert.equal(parsePnpmInvocation('yarn install'), null);
});

test('findPnpmInvocations splits on shell operators', () => {
  const found = findPnpmInvocations('corepack enable && pnpm install --prod; pnpm run build');
  assert.deepEqual(found.map((f) => f.subcommand), ['install', 'run']);
});

test('isUnsupportedGlobalInstall only matches `pnpm install -g` with no package', () => {
  assert.equal(isUnsupportedGlobalInstall(parsePnpmInvocation('pnpm install -g')), true);
  assert.equal(isUnsupportedGlobalInstall(parsePnpmInvocation('pnpm install --global')), true);
  assert.equal(isUnsupportedGlobalInstall(parsePnpmInvocation('pnpm install -g typescript')), false);
  assert.equal(isUnsupportedGlobalInstall(parsePnpmInvocation('pnpm add -g typescript')), false);
  assert.equal(isUnsupportedGlobalInstall(parsePnpmInvocation('pnpm install')), false);
});

test('shadowedBuiltinCall matches the four shadowable built-ins only', () => {
  assert.equal(shadowedBuiltinCall(parsePnpmInvocation('pnpm rebuild')), 'rebuild');
  assert.equal(shadowedBuiltinCall(parsePnpmInvocation('pnpm clean')), 'clean');
  assert.equal(shadowedBuiltinCall(parsePnpmInvocation('pnpm setup')), 'setup');
  assert.equal(shadowedBuiltinCall(parsePnpmInvocation('pnpm deploy')), 'deploy');
  assert.equal(shadowedBuiltinCall(parsePnpmInvocation('pnpm build')), null);
  assert.equal(shadowedBuiltinCall(parsePnpmInvocation('pnpm run rebuild')), null);
});

// --- DETECTION 5 ----------------------------------------------------------

test('DETECTION 5 — a shadowing script alone is NOT reported', () => {
  // Measured on 15 real repos: reporting the declaration produced 40 findings,
  // 33 of them a `clean` script in one monorepo. Only a real call site matters.
  const result = scan({ dir: fixture('clean-shadow-only') });
  assert.deepEqual(result.fail, []);
  assert.deepEqual(result.warn, [], shorts(result.warn));
});

test('DETECTION 5 — it fires as a FAIL where a call site actually uses it', () => {
  const result = scan({ dir: fixture('shadowed') });
  const fails = byRule(result.fail, RULES.SHADOWED_BUILTIN_CALL);

  // Dockerfile: `pnpm rebuild` and `pnpm --filter web rebuild`. Workflow: `pnpm clean`.
  assert.equal(fails.length, 3, shorts(fails));
  assert.deepEqual(fails.map((f) => f.key).sort(), ['clean', 'rebuild', 'rebuild']);
  assert.ok(fails.some((f) => f.file === 'Dockerfile'));
  assert.ok(fails.some((f) => f.file === '.github/workflows/ci.yml'));
  assert.match(fails[0].message, /silently runs that script instead/);
  assert.match(fails[0].message, /`pnpm pm \w+` for the built-in/);
});

test('DETECTION 5 — `pnpm run <name>` is never flagged as a call site', () => {
  const result = scan({ dir: fixture('shadowed') });
  const inDockerfile = byRule(result.fail, RULES.SHADOWED_BUILTIN_CALL)
    .filter((f) => f.file === 'Dockerfile');

  // Dockerfile lines 8 and 9 are `pnpm run rebuild` / `pnpm run clean` — explicit
  // script calls that meant the script all along, so they must not be flagged.
  assert.deepEqual(inDockerfile.map((f) => f.line).sort(), [6, 7], shorts(inDockerfile));
});

test('DETECTION 5 — a `pnpm rebuild` call with no matching script is not flagged', () => {
  // The call site only changed meaning if a script of that name exists.
  const result = scan({ dir: fixture('global-install') });
  assert.equal(byRule(result.fail, RULES.SHADOWED_BUILTIN_CALL).length, 0);
});

// --- DETECTION 6 ----------------------------------------------------------

test('DETECTION 6 — bare `pnpm install -g` is a FAIL, argument forms are not', () => {
  const result = scan({ dir: fixture('global-install') });
  const fails = byRule(result.fail, RULES.UNSUPPORTED_GLOBAL_INSTALL);

  assert.equal(fails.length, 1, shorts(result.fail));
  assert.equal(fails[0].line, 5, 'only the bare `pnpm install -g` on line 5');
  assert.match(fails[0].message, /use `pnpm add -g <pkg>`/);
});

test('DETECTION 6 — `npm install -g pnpm` is not a pnpm invocation', () => {
  const result = scan({ dir: fixture('global-install') });
  assert.equal(result.fail.filter((f) => f.line === 8).length, 0);
});

// --- DETECTION 7 ----------------------------------------------------------

test('DETECTION 7 — a pnpm install with no ENV CI=true warns about hanging', () => {
  const result = scan({ dir: fixture('ci-env') });
  const warns = byRule(result.warn, RULES.DOCKER_MISSING_CI_ENV);

  assert.deepEqual(warns.map((f) => f.file).sort(), ['Dockerfile.disabled', 'Dockerfile.missing']);
  assert.match(warns[0].message, /gates dependency build scripts/);
  assert.match(warns[0].message, /hangs the image build/);
});

test('DETECTION 7 — it stays silent when the project does not gate build scripts', () => {
  // Same Dockerfile shape, but no allowBuilds/onlyBuiltDependencies anywhere.
  const result = scan({ dir: fixture('no-workspace') });
  assert.equal(byRule(result.warn, RULES.DOCKER_MISSING_CI_ENV).length, 0, shorts(result.warn));
});

test('DETECTION 7 — ENV CI=true silences it', () => {
  const result = scan({ dir: fixture('ci-env') });
  const warns = byRule(result.warn, RULES.DOCKER_MISSING_CI_ENV);
  assert.equal(warns.some((f) => f.file === 'Dockerfile.ok'), false);
});

// --- --ignore -------------------------------------------------------------

test('--ignore suppresses a rule and records how many it dropped', () => {
  const before = scan({ dir: fixture('ci-env') });
  const after = scan({ dir: fixture('ci-env'), ignore: RULES.DOCKER_MISSING_CI_ENV });

  assert.ok(byRule(before.warn, RULES.DOCKER_MISSING_CI_ENV).length > 0);
  assert.equal(byRule(after.warn, RULES.DOCKER_MISSING_CI_ENV).length, 0);
  assert.equal(after.suppressed, byRule(before.warn, RULES.DOCKER_MISSING_CI_ENV).length);
  assert.deepEqual(after.ignored, [RULES.DOCKER_MISSING_CI_ENV]);
  assert.match(after.summary, /suppressed by --ignore/);
});

test('--ignore can flip a failing scan to a passing one', () => {
  const before = scan({ dir: fixture('global-install') });
  const after = scan({ dir: fixture('global-install'), ignore: RULES.UNSUPPORTED_GLOBAL_INSTALL });
  assert.equal(before.exitCode, 1);
  assert.equal(after.exitCode, 0);
});

test('--ignore accepts a comma-separated list and an array', () => {
  const csv = scan({ dir: fixture('shadowed'), ignore: 'shadowed-builtin-call,docker-missing-ci-env' });
  const arr = scan({ dir: fixture('shadowed'), ignore: ['shadowed-builtin-call', 'docker-missing-ci-env'] });
  assert.equal(csv.fail.length, arr.fail.length);
  assert.equal(byRule(csv.fail, RULES.SHADOWED_BUILTIN_CALL).length, 0);
});

test('an unknown rule id in --ignore fails fast and lists the valid ones', () => {
  assert.throws(() => scan({ dir: fixture('clean'), ignore: 'no-such-rule' }), (err) => {
    assert.ok(err instanceof ScanError);
    assert.equal(err.code, 'BAD_RULE');
    assert.match(err.message, /Unknown rule id in --ignore: no-such-rule/);
    assert.match(err.message, /Known rules:/);
    return true;
  });
});

test('every rule id a finding can carry is in ALL_RULES', () => {
  const dirs = ['full', 'shadowed', 'global-install', 'ci-env', 'malformed', 'copy-after-install'];
  const seen = new Set();
  for (const dir of dirs) {
    const result = scan({ dir: fixture(dir) });
    for (const f of [...result.fail, ...result.warn]) seen.add(f.rule);
  }
  assert.ok(seen.size >= 7, `expected most rules to be exercised, saw ${[...seen].join(', ')}`);
  for (const rule of seen) assert.ok(ALL_RULES.includes(rule), `${rule} missing from ALL_RULES`);
});

// --- pnpm v11 to v12 ------------------------------------------------------

test('usesRemovedResolutionOnly only matches an install carrying the flag', () => {
  const only = (cmd) => usesRemovedResolutionOnly(findPnpmInvocations(cmd)[0]);
  assert.equal(only('pnpm install --resolution-only'), true);
  assert.equal(only('pnpm i --frozen-lockfile --resolution-only'), true);
  assert.equal(only('pnpm install --frozen-lockfile'), false);
  assert.equal(only('pnpm peers check'), false);
  assert.equal(only('pnpm update --resolution-only'), false);
});

test('the worked example: a pinned project fails on the flag and on the typo', () => {
  const result = scan({ dir: fixture('v12-pinned') });

  assert.equal(result.exitCode, 1);
  assert.equal(result.fail.length, 2, shorts(result.fail));
  assert.equal(result.warn.length, 0, shorts(result.warn));

  const [flag] = byRule(result.fail, RULES.PNPM12_RESOLUTION_ONLY);
  assert.equal(flag.file, 'Dockerfile');
  assert.equal(flag.line, 6);
  assert.match(flag.message, /unexpected argument '--resolution-only' found/);
  assert.match(flag.message, /pnpm peers check/);
  assert.match(flag.message, /neither a re-resolution nor an install/);

  const [setting] = byRule(result.fail, RULES.PNPM12_UNKNOWN_WORKSPACE_SETTING);
  assert.equal(setting.file, 'pnpm-workspace.yaml');
  assert.equal(setting.line, 4);
  assert.match(setting.message, /ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS/);
  assert.match(setting.message, /minimumReleaseAge/);
  assert.match(setting.message, /packageManager \(pnpm@12\.5\.1\)/);
});

test('dropping the pnpm pin turns the same typo into a warning', () => {
  const result = scan({ dir: fixture('v12-unpinned') });

  assert.equal(byRule(result.fail, RULES.PNPM12_UNKNOWN_WORKSPACE_SETTING).length, 0);
  const [setting] = byRule(result.warn, RULES.PNPM12_UNKNOWN_WORKSPACE_SETTING);
  assert.equal(setting.severity, 'warn');
  assert.match(setting.message, /minimumReleaseAge/);
  assert.match(setting.message, /once package\.json pins pnpm/);

  // The removed flag still fails, so the exit code does not move.
  assert.equal(byRule(result.fail, RULES.PNPM12_RESOLUTION_ONLY).length, 1);
  assert.equal(result.exitCode, 1);
});

test('devEngines.packageManager counts as a pin, in object or list form', () => {
  const object = readPnpmPin({
    devEngines: { packageManager: { name: 'pnpm', version: '12.5.1' } },
  });
  assert.deepEqual(object, { source: 'devEngines.packageManager', spec: '12.5.1' });

  const list = readPnpmPin({ devEngines: { packageManager: [{ name: 'pnpm', version: '^12' }] } });
  assert.deepEqual(list, { source: 'devEngines.packageManager', spec: '^12' });

  assert.equal(readPnpmPin({ devEngines: { packageManager: { name: 'yarn' } } }), null);
  assert.equal(readPnpmPin({ packageManager: 'yarn@4.9.1' }), null);
  assert.deepEqual(readPnpmPin({ packageManager: 'pnpm@12.5.1' }), {
    source: 'packageManager',
    spec: '12.5.1',
  });
});

test('an unknown key that is not a near miss stays a warning even under a pin', () => {
  const result = scan({ dir: fixture('v12-git-ssh') });
  const [setting] = byRule(result.warn, RULES.PNPM12_UNKNOWN_WORKSPACE_SETTING);

  assert.equal(setting.key, 'quantumEntanglementMode');
  assert.equal(setting.severity, 'warn');
  assert.match(setting.message, /nowhere near a known setting/);
  assert.ok(setting.message.includes(SNAPSHOT_DATE));
  assert.equal(byRule(result.fail, RULES.PNPM12_UNKNOWN_WORKSPACE_SETTING).length, 0);
});

test('the removed flag is caught in a workflow run block too', () => {
  const result = scan({ dir: fixture('v12-git-ssh') });
  const [flag] = byRule(result.fail, RULES.PNPM12_RESOLUTION_ONLY);

  assert.equal(flag.file, '.github/workflows/ci.yml');
  assert.equal(flag.line, 10, 'points at the step carrying the flag, not the first pnpm install');
  assert.match(flag.context, /Check peers/);
});

test('ssh git dependencies are flagged only for the hosts pnpm 12 resolves over HTTPS', () => {
  const result = scan({ dir: fixture('v12-git-ssh') });
  const ssh = byRule(result.warn, RULES.PNPM12_SSH_GIT_DEPENDENCY);

  assert.deepEqual(ssh.map((f) => f.key).sort(), [
    'dependencies.design-tokens',
    'dependencies.internal-lib',
    'devDependencies.build-helpers',
  ]);
  for (const finding of ssh) assert.equal(finding.severity, 'warn');

  const github = ssh.find((f) => f.key === 'dependencies.internal-lib');
  assert.equal(
    github.fix,
    'git config --global url."git@github.com:".insteadOf https://github.com/'
  );
  const bitbucket = ssh.find((f) => f.key === 'devDependencies.build-helpers');
  assert.equal(
    bitbucket.fix,
    'git config --global url."git@bitbucket.org:".insteadOf https://bitbucket.org/'
  );
});

test('an ssh url with embedded credentials, an unknown host or https is left alone', () => {
  assert.equal(httpsResolvedSshHost('git+ssh://acme:s3cret@bitbucket.org/a/b.git'), null);
  assert.equal(httpsResolvedSshHost('git+ssh://git@git.acme.dev/a/b.git'), null);
  assert.equal(httpsResolvedSshHost('git+https://github.com/a/b.git'), null);
  assert.equal(httpsResolvedSshHost('github:kevva/is-positive'), null);
  assert.equal(httpsResolvedSshHost('^1.3.0'), null);
  assert.equal(httpsResolvedSshHost(null), null);
  assert.equal(httpsResolvedSshHost('git+ssh://git@GitHub.com/a/b.git'), 'github.com');
  assert.equal(httpsResolvedSshHost('git+ssh://git@github.com:a/b.git'), 'github.com');
  assert.equal(httpsResolvedSshHost('ssh://git@gitlab.com/a/b.git'), 'gitlab.com');
});

test('the settings snapshot follows what pnpm itself recognises', () => {
  assert.ok(isKnownSetting('minimumReleaseAge'));
  assert.ok(isKnownSetting('node-linker'), 'kebab-case spellings are recognised too');
  assert.ok(isKnownSetting('onlyBuiltDependencies'), 'still a setting in pnpm 12');
  assert.ok(!isKnownSetting('minimumReleasAge'));

  assert.ok(isRefusedSetting('packageManager'), 'pnpm warns about these instead of erroring');
  assert.ok(isRefusedSetting('globalBinDir'));

  assert.equal(closestKnownSetting('minimumReleasAge').name, 'minimumReleaseAge');
  assert.equal(closestKnownSetting('minimumReleasAge').distance, 1);
  assert.equal(closestKnownSetting('quantumEntanglementMode'), null);
});

test('a v12-ready project fires none of the three v11 to v12 rules', () => {
  for (const dir of ['v12-clean', 'clean']) {
    const result = scan({ dir: fixture(dir) });
    const v12 = [...result.fail, ...result.warn].filter((f) => f.rule.startsWith('pnpm12-'));
    assert.equal(v12.length, 0, `${dir}: ${shorts(v12)}`);
  }

  // A key with no value, a $schema directive and a kebab-case setting are all fine.
  const clean = scan({ dir: fixture('v12-clean') });
  assert.equal(clean.exitCode, 0);
  assert.equal(clean.ok, true);
});

test('the v11 to v12 rules can be suppressed like any other', () => {
  const result = scan({
    dir: fixture('v12-pinned'),
    ignore: 'pnpm12-resolution-only,pnpm12-unknown-workspace-setting',
  });

  assert.equal(result.fail.length, 0);
  assert.equal(result.exitCode, 0);
  assert.equal(result.suppressed, 2);
});

test('--fix never touches a v11 to v12 finding', () => {
  const result = scan({ dir: fixture('v12-pinned') });
  const fixResult = applyFixes(result, { rootDir: fixture('v12-pinned'), dryRun: true });

  assert.equal(fixResult.changed.length, 0);
  assert.deepEqual(fixResult.unfixable.map((f) => f.rule).sort(), [
    'pnpm12-resolution-only',
    'pnpm12-unknown-workspace-setting',
  ]);
});

test('a corepack pin carrying a sha512 hash is quoted by version alone', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm11-guard-pin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const hash = `sha512.${'a'.repeat(128)}`;
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'hashed', packageManager: `pnpm@12.5.1+${hash}` }, null, 2)}\n`
  );
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'minimumReleasAge: 1440\n');

  const [finding] = scan({ dir }).fail;
  assert.equal(finding.rule, RULES.PNPM12_UNKNOWN_WORKSPACE_SETTING);
  assert.match(finding.message, /packageManager \(pnpm@12\.5\.1\)/);
  assert.ok(!finding.message.includes(hash));
});
