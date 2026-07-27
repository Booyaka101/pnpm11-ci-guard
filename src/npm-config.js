'use strict';

/**
 * pnpm v11 stopped reading `npm_config_*` environment variables entirely
 * (pnpm v11.0 release notes: "pnpm no longer reads `npm_config_*` environment
 * variables. Use `pnpm_config_*` instead").
 *
 * The one shape that is NOT dead is the URL-scoped registry form introduced in
 * pnpm 11.6 — `npm_config_//registry.npmjs.org/:_authToken=<token>` — which pnpm
 * explicitly still reads. Flagging those would tell people to break working auth,
 * so they are exempt.
 */

const PREFIX_RE = /^npm_config_/i;
const AUTH_SCOPED_RE = /^npm_config_\/\//i;

/** Does this key use the (now ignored) npm_config_ prefix at all? */
function isNpmConfigKey(key) {
  return typeof key === 'string' && PREFIX_RE.test(key);
}

/** URL-scoped registry auth (`npm_config_//host/:_authToken`) — still honoured by pnpm 11.6+. */
function isScopedAuthKey(key) {
  return typeof key === 'string' && AUTH_SCOPED_RE.test(key);
}

/** The keys we actually report: npm_config_* that is not URL-scoped auth. */
function isIgnoredNpmConfigKey(key) {
  return isNpmConfigKey(key) && !isScopedAuthKey(key);
}

/** `npm_config_registry` -> `pnpm_config_registry`; `NPM_CONFIG_X` -> `PNPM_CONFIG_X`. */
function toPnpmConfigKey(key) {
  if (!isNpmConfigKey(key)) return key;
  return (key[0] === 'N' ? 'P' : 'p') + key;
}

module.exports = {
  isNpmConfigKey,
  isScopedAuthKey,
  isIgnoredNpmConfigKey,
  toPnpmConfigKey,
};
