/**
 * Overrides ledger check
 *
 * Every pin in the root package.json `pnpm.overrides` must (a) resolve a package in
 * pnpm-lock.yaml, (b) be listed in the osv-scanner.toml overrides ledger at the same
 * version, with no ledger entry left over, and (c) not pin a deprecated release.
 *
 * Ledger entries are comment lines of `<key> <version>` pairs, indented four spaces
 * after the `#`, optionally followed by a parenthesised note:
 *
 *     #     hono 4.13.11, body-parser 2.4.0
 *     #     tar 7.5.22                        (GHSA-...)
 */

const LEDGER_PREFIX = '#     ';
/** An override key: `name`, `@scope/name` or `name@major` */
const OVERRIDE_KEY = /^@?[\w./@-]+$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

export interface LockPackage {
  deprecated: boolean;
}

/** Parse the `packages:` section of a pnpm v9 lockfile into `name@version` → entry */
export function parseLockPackages(lockText: string): Map<string, LockPackage> {
  const packages = new Map<string, LockPackage>();
  let inPackages = false;
  let current: LockPackage | undefined;
  for (const line of lockText.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = line === 'packages:';
      current = undefined;
      continue;
    }
    if (!inPackages) continue;
    const entry = lockEntryKey(line);
    if (entry) {
      current = { deprecated: false };
      packages.set(entry, current);
    } else if (current && line.startsWith('    deprecated:')) {
      current.deprecated = true;
    }
  }
  return packages;
}

/** A `packages:` entry key in a v9 lockfile (`  name@version:` or `  'name@version':`) as `name@version` */
function lockEntryKey(line: string): string | undefined {
  if (!line.startsWith('  ') || line[2] === ' ' || !line.endsWith(':')) return undefined;
  const key = line.slice(2, -1).replaceAll("'", '');
  return key.lastIndexOf('@') > 0 ? key : undefined;
}

/** The `<key> <version>` pairs of one ledger line, or undefined when it is not a ledger entry */
function ledgerPairs(line: string): string[][] | undefined {
  if (!line.startsWith(LEDGER_PREFIX) || line[LEDGER_PREFIX.length] === ' ') return undefined;
  const body = line.slice(LEDGER_PREFIX.length).split('  (')[0]?.trimEnd() ?? '';
  const pairs = (body.endsWith(',') ? body.slice(0, -1) : body).split(', ').map(pair => pair.split(' '));
  const valid = pairs.every(
    ([key, version, ...rest]) =>
      rest.length === 0 && OVERRIDE_KEY.test(key ?? '') && EXACT_VERSION.test(version ?? '')
  );
  return valid ? pairs : undefined;
}

/** Parse the ledger's `<key> <version>` entries out of osv-scanner.toml's comments */
export function parseLedger(tomlText: string): Map<string, string> {
  const ledger = new Map<string, string>();
  for (const line of tomlText.split(/\r?\n/)) {
    for (const [key, version] of ledgerPairs(line.trimEnd()) ?? []) {
      if (key && version) ledger.set(key, version);
    }
  }
  return ledger;
}

/** The package name an override key selects (`ajv@8` → `ajv`, `@hono/node-server` → itself) */
function packageName(key: string): string {
  const at = key.indexOf('@', 1);
  return at === -1 ? key : key.slice(0, at);
}

/** Every rule the overrides break, one message each; empty when all hold */
export function checkOverridesLedger(
  overrides: Record<string, string>,
  lockText: string,
  tomlText: string
): string[] {
  const packages = parseLockPackages(lockText);
  const ledger = parseLedger(tomlText);
  const problems: string[] = [];

  for (const [key, version] of Object.entries(overrides)) {
    if (!EXACT_VERSION.test(version)) {
      problems.push(`override ${key}: "${version}" is not an exact version`);
      continue;
    }
    const resolved = packages.get(`${packageName(key)}@${version}`);
    if (!resolved) {
      problems.push(`override ${key} ${version} resolves no package in pnpm-lock.yaml`);
    } else if (resolved.deprecated) {
      problems.push(`override ${key} ${version} pins a deprecated release`);
    }
    const listed = ledger.get(key);
    if (listed === undefined) {
      problems.push(`override ${key} ${version} is missing from the osv-scanner.toml ledger`);
    } else if (listed !== version) {
      problems.push(`override ${key} is ${version}, but the ledger lists ${listed}`);
    }
  }
  for (const key of ledger.keys()) {
    if (!(key in overrides)) {
      problems.push(`ledger entry ${key} has no override in package.json`);
    }
  }
  return problems;
}
