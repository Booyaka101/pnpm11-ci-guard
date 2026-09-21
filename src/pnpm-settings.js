'use strict';

// Snapshot of the settings pnpm recognises in pnpm-workspace.yaml, read from pnpm's own
// recognizer on 2026-09-21 against pnpm 12.5.1: the three key lists and the WorkspaceSettings
// serde fields in pnpm/crates/config/src/known_settings.rs, unioned with the type tables in
// pnpm/crates/config/src/config_types.rs. pnpm matches on the camelCase spelling, so kebab-case
// spellings of these same names are known too (pnpm warns about those separately).
// A setting added to pnpm after this date is absent here, which is why an unknown key that is
// not a near-miss of a known one never escalates past a warning.

const SNAPSHOT_DATE = '2026-09-21';
const SNAPSHOT_PNPM_VERSION = '12.5.1';

const KNOWN_SETTINGS = [
  'access', 'aggregateOutput', 'allowBuilds', 'allowNew', 'allowSameVersion',
  'allowUnusedPatches', 'allowedDeprecatedVersions', 'audit', 'auditConfig', 'auditIgnorePrune',
  'auditLevel', 'auth', 'authConfig', 'autoConfirmAllPrompts', 'autoInstallPeers',
  'autoInstallPeersFromHighestMatch', 'bail', 'bin', 'binLinks', 'blockExoticSubdeps', 'ca',
  'cacheDir', 'cafile', 'cargo', 'catalog', 'catalogMode', 'catalogPrune', 'catalogs', 'cert',
  'changedFilesIgnorePattern', 'childConcurrency', 'ci', 'cleanupUnusedCatalogs', 'color',
  'commitHooks', 'concurrencyGroups', 'configByUri', 'configDependencies', 'configDir', 'cpu',
  'dangerouslyAllowAllBuilds', 'dedupeDirectDeps', 'dedupeInjectedDeps', 'dedupePeerDependents',
  'dedupePeers', 'deployAllFiles', 'depth', 'description', 'dev', 'dir',
  'disallowWorkspaceCycles', 'dlxCacheMaxAge', 'dryRun', 'embedReadme',
  'enableGlobalVirtualStore', 'enableModulesDir', 'enablePnp', 'enablePrePostScripts',
  'engineStrict', 'excludeLinksFromLockfile', 'executionEnv', 'extendNodePath',
  'externalDependencies', 'extraBinPaths', 'extraEnv', 'failIfNoMatch', 'fetchMinSpeedKiBps',
  'fetchRetries', 'fetchRetryFactor', 'fetchRetryMaxtimeout', 'fetchRetryMintimeout',
  'fetchTimeout', 'fetchWarnTimeoutMs', 'fetchingConcurrency', 'filter', 'filterProd', 'force',
  'forceLegacyDeploy', 'frozenLockfile', 'frozenStore', 'git', 'gitBranchLockfile', 'gitChecks',
  'gitShallowHosts', 'gitTagVersion', 'global', 'globalBinDir', 'globalDir', 'globalPath',
  'globalPkgDir', 'globalPnpmfile', 'globalPrefix', 'globalShims', 'globalVirtualStoreDir',
  'hoist', 'hoistPattern', 'hoistWorkspacePackages', 'hoistingLimits', 'httpProxy', 'httpsProxy',
  'ignoreCompatibilityDb', 'ignoreCurrentSpecifiers', 'ignorePnpmfile', 'ignoreScripts',
  'ignoreWorkspace', 'ignoreWorkspaceCycles', 'ignoreWorkspaceRootCheck',
  'ignoredBuiltDependencies', 'ignoredOptionalDependencies', 'includeWorkspaceRoot',
  'initAuthorEmail', 'initAuthorName', 'initAuthorUrl', 'initLicense', 'initPackageManager',
  'initType', 'initVersion', 'injectWorkspacePackages', 'json', 'key', 'legacyDirFiltering',
  'libc', 'linkWorkspacePackages', 'localAddress', 'lockfile', 'lockfileDir',
  'lockfileIncludeTarballUrl', 'lockfileOnly', 'loglevel', 'long', 'maxSockets', 'maxsockets',
  'mergeGitBranchLockfiles', 'mergeGitBranchLockfilesBranchPattern', 'message',
  'minimumReleaseAge', 'minimumReleaseAgeExclude', 'minimumReleaseAgeExcludePrune',
  'minimumReleaseAgeIgnoreMissingTime', 'minimumReleaseAgeStrict', 'modulesCacheMaxAge',
  'modulesDir', 'namedRegistries', 'networkConcurrency', 'neverBuiltDependencies', 'noProxy',
  'nodeDownloadMirrors', 'nodeExperimentalPackageMap', 'nodeLinker', 'nodeOptions',
  'nodePackageMapType', 'nodeVersion', 'noproxy', 'npmPath', 'npmrcAuthFile', 'offline', 'only',
  'onlyBuiltDependencies', 'onlyBuiltDependenciesFile', 'optimisticRepeatInstall', 'optional',
  'os', 'otp', 'overrides', 'packDestination', 'packGzipLevel', 'packageConfigs',
  'packageExtensions', 'packageImportMethod', 'packageLock', 'packageManagerNetworkConfig',
  'packageManagerRegistries', 'packages', 'parseable', 'patchedDependencies', 'patchesDir',
  'peerDependencyRules', 'peersSuffixMaxLength', 'pending', 'pipelineBase', 'pipelines',
  'pmOnFail', 'pnpmExecPath', 'pnpmHomeDir', 'pnpmfile', 'pnprServer', 'preferFrozenLockfile',
  'preferOffline', 'preferSymlinkedExecutables', 'preferWorkspacePackages', 'prefix',
  'preserveAbsolutePaths', 'production', 'progress', 'provenance', 'proxy', 'publicHoistPattern',
  'publishBranch', 'python', 'recursive', 'recursiveInstall', 'registries', 'registriesByPrefix',
  'registriesByScope', 'registry', 'registryOptionsByUrl', 'registrySupportsTimeField',
  'remoteSideEffectsCache', 'reporter', 'reporterHidePrefix', 'requiredScripts', 'resolutionMode',
  'resolvePeersFromWorkspaceRoot', 'reverse', 'runtime', 'runtimeOnFail', 'save',
  'saveCatalogName', 'saveDev', 'saveExact', 'saveOptional', 'savePeer', 'savePrefix', 'saveProd',
  'saveWorkspaceProtocol', 'scope', 'scriptShell', 'scriptsPrependNodePath', 'shamefullyHoist',
  'sharedWorkspaceLockfile', 'shellEmulator', 'sideEffectsCache', 'sideEffectsCacheRead',
  'sideEffectsCacheReadonly', 'sideEffectsCacheWrite', 'signGitTag', 'skipManifestObfuscation',
  'sort', 'stateDir', 'storeDir', 'stream', 'strictDepBuilds', 'strictPeerDependencies',
  'strictSsl', 'strictStorePkgContentCheck', 'supportedArchitectures', 'symlink',
  'syncInjectedDepsAfterScripts', 'tag', 'tagVersionPrefix', 'tasks', 'testPattern', 'tools',
  'trustLockfile', 'trustPolicy', 'trustPolicyExclude', 'trustPolicyExcludePrune',
  'trustPolicyIgnoreAfter', 'tryLoadDefaultPnpmfile', 'umask', 'unsafePerm', 'update',
  'updateConfig', 'updateNotifier', 'useBetaCli', 'useGitBranchLockfile', 'useLockfile',
  'useRunningStoreServer', 'useStderr', 'useStoreServer', 'userAgent', 'userConfig', 'userconfig',
  'verifyDepsBeforeRun', 'verifyStoreIntegrity', 'version', 'versioning', 'virtualStoreDir',
  'virtualStoreDirMaxLength', 'virtualStoreOnly', 'virtualStoreType', 'workspaceConcurrency',
  'workspaceDir', 'workspacePackagePatterns', 'workspacePackages', 'workspacePrefix',
  'workspaceRoot', 'yes',
];

// pnpm reads these from the command line or the user's config rather than the workspace file.
// It warns about them and never raises ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS for them.
const REFUSED_SETTINGS = [
  'allProjects', 'allProjectsGraph', 'authConfig', 'bin', 'cliOptions', 'configByUri',
  'configDir', 'dir', 'explicitlySetKeys', 'finders', 'globalBinDir', 'globalDir', 'globalPkgDir',
  'hooks', 'npmrcAuthFile', 'packageManager', 'packageManagerNetworkConfig',
  'packageManagerRegistries', 'pnpmHomeDir', 'prodAllProjectsGraph',
  'prodOnlySelectedProjectDirs', 'rootProjectManifest', 'rootProjectManifestDir', 'scope',
  'selectedProjectsGraph', 'stateDir', 'userConfig', 'userconfig', 'wantedPackageManager',
  'workspaceDir',
];

// pnpm skips the JSON-schema directive before it classifies anything.
const SCHEMA_KEY = '$schema';

const knownSet = new Set(KNOWN_SETTINGS);
const refusedSet = new Set(REFUSED_SETTINGS);

// lodash-style word split, which is what pnpm's to_camel_case is built on: it breaks on
// separators and on case boundaries so 'node-linker' and 'nodeLinker' collapse to one name.
const WORDS = /[A-Z]{2,}(?=[A-Z][a-z]+|d|)|[A-Z]?[a-z]+d*|[A-Z]+d*|d+/g;

function toCamelCase(key) {
  const parts = String(key).match(WORDS);
  if (!parts) return '';
  return parts
    .map((word, i) => (i === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
}

function isKnownSetting(key) {
  return knownSet.has(toCamelCase(key));
}

function isRefusedSetting(key) {
  return refusedSet.has(toCamelCase(key));
}

function editDistance(a, b) {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const substitute = previous[j] + (a[i] === b[j] ? 0 : 1);
      current.push(Math.min(current[j] + 1, previous[j + 1] + 1, substitute));
    }
    previous = current;
  }
  return previous[b.length];
}

// pnpm suggests a setting when the similarity clears didyoumean2's default threshold, so the
// name we print is the name pnpm itself would print.
const SUGGESTION_SIMILARITY = 0.4;

// A typo this close to a real setting is a policy that silently never applied, which is the
// case worth failing over. Anything further away may simply be a setting a newer pnpm added.
const NEAR_MISS_DISTANCE = 2;

function closestKnownSetting(key) {
  const camel = toCamelCase(key).toLowerCase();
  if (!camel) return null;
  let best = null;
  for (const candidate of KNOWN_SETTINGS) {
    const distance = editDistance(camel, candidate.toLowerCase());
    const similarity = 1 - distance / Math.max(camel.length, candidate.length);
    if (similarity >= SUGGESTION_SIMILARITY && (best === null || similarity > best.similarity)) {
      best = { name: candidate, distance, similarity };
    }
  }
  return best;
}

module.exports = {
  SNAPSHOT_DATE,
  SNAPSHOT_PNPM_VERSION,
  KNOWN_SETTINGS,
  REFUSED_SETTINGS,
  SCHEMA_KEY,
  NEAR_MISS_DISTANCE,
  toCamelCase,
  isKnownSetting,
  isRefusedSetting,
  closestKnownSetting,
};
