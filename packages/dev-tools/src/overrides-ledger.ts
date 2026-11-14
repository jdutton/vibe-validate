import semver from 'semver';

/**
 * Overrides ledger check
 *
 * Every pin in the root package.json `pnpm.overrides` must (a) resolve a package in
 * pnpm-lock.yaml, (b) be listed in the osv-scanner.toml overrides ledger at the same
 * version, with no ledger entry left over, and (c) not pin a deprecated release. A key
 * with a selector (`picomatch@2`) must also be pinned to a version that satisfies it.
 *
 * The ledger sits between `# BEGIN overrides ledger` and `# END overrides ledger`
 * comment lines. Inside them every line is one of:
 *   - an entry: `#`, five spaces, then `<key> <version>` pairs, optionally followed by
 *     a parenthesised note;
 *   - a continuation (`#` and six or more spaces) of the previous entry's note;
 *   - prose: `#` and three spaces, or a bare `#`.
 * Anything else, and a key listed twice, is reported.
 *
 *     #     hono 4.13.11, body-parser 2.4.0
 *     #     tar 7.5.22                        (GHSA-...)
 */

export const LEDGER_BEGIN = '# BEGIN overrides ledger';
export const LEDGER_END = '# END overrides ledger';
const ENTRY_LINE = /^# {5}\S/;
const CONTINUATION_LINE = /^# {6,}\S/;
const PROSE_LINE = /^#( {3}\S.*|\s*)$/;
const ENTRY_PREFIX_LENGTH = 6;
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

/** The `<key> <version>` pairs of one entry line, or undefined when the line is malformed */
function ledgerPairs(line: string): string[][] | undefined {
  const body = line.slice(ENTRY_PREFIX_LENGTH).split('  (')[0]?.trimEnd() ?? '';
  const pairs = (body.endsWith(',') ? body.slice(0, -1) : body).split(', ').map(pair => pair.split(' '));
  const valid = pairs.every(
    ([key, version, ...rest]) =>
      rest.length === 0 && OVERRIDE_KEY.test(key ?? '') && EXACT_VERSION.test(version ?? '')
  );
  return valid ? pairs : undefined;
}

export interface ParsedLedger {
  entries: Map<string, string>;
  problems: string[];
}

/** The line indexes of the BEGIN and END markers, and the problems with them */
function findMarkers(lines: string[]): { begin: number; end: number; problems: string[] } {
  const begin = lines.indexOf(LEDGER_BEGIN);
  const end = lines.indexOf(LEDGER_END);
  const problems: string[] = [];
  if (begin === -1) problems.push(`osv-scanner.toml has no "${LEDGER_BEGIN}" line`);
  if (end === -1) problems.push(`osv-scanner.toml has no "${LEDGER_END}" line`);
  if (begin !== -1 && end !== -1 && end < begin) {
    problems.push(`osv-scanner.toml has "${LEDGER_END}" before "${LEDGER_BEGIN}"`);
  }
  return { begin, end, problems };
}

/** What one line between the markers is: an entry's pairs, or nothing to read; `bad` when it fits no shape */
function readLedgerLine(line: string): { pairs: string[][]; bad: boolean } {
  if (ENTRY_LINE.test(line)) {
    const pairs = ledgerPairs(line);
    return { pairs: pairs ?? [], bad: pairs === undefined };
  }
  return { pairs: [], bad: !(CONTINUATION_LINE.test(line) || PROSE_LINE.test(line)) };
}

/** Parse the ledger between the markers in osv-scanner.toml: its entries, and every line or key that breaks the format */
export function parseLedger(tomlText: string): ParsedLedger {
  const entries = new Map<string, string>();
  const lines = tomlText.split(/\r?\n/).map(line => line.trimEnd());
  const { begin, end, problems } = findMarkers(lines);
  if (problems.length > 0) return { entries, problems };

  const duplicates = new Set<string>();
  for (let index = begin + 1; index < end; index++) {
    const line = lines[index] ?? '';
    const read = readLedgerLine(line);
    if (read.bad) {
      problems.push(`osv-scanner.toml line ${index + 1}: not a ledger entry or continuation: "${line}"`);
    }
    for (const [key, version] of read.pairs) {
      if (!key || !version) continue;
      if (entries.has(key)) duplicates.add(key);
      else entries.set(key, version);
    }
  }
  for (const key of duplicates) problems.push(`ledger key ${key} is listed more than once`);
  return { entries, problems };
}

/** The package name an override key selects (`ajv@8` → `ajv`, `@hono/node-server` → itself) */
function packageName(key: string): string {
  const at = key.indexOf('@', 1);
  return at === -1 ? key : key.slice(0, at);
}

/** The version selector of an override key (`ajv@8` → `8`), or undefined when it has none */
function selector(key: string): string | undefined {
  const at = key.indexOf('@', 1);
  return at === -1 ? undefined : key.slice(at + 1);
}

/** The rules one override breaks, one message each; empty when all hold */
function checkOverride(
  key: string,
  version: string,
  packages: Map<string, LockPackage>,
  ledger: Map<string, string>
): string[] {
  if (key.includes('>')) return [`override ${key}: parent>child keys are not supported by the ledger check`];
  if (!EXACT_VERSION.test(version)) return [`override ${key}: "${version}" is not an exact version`];
  const problems: string[] = [];
  const range = selector(key);
  if (range !== undefined && !semver.satisfies(version, range)) {
    problems.push(`override ${key} pins ${version}, which does not satisfy its selector "${range}"`);
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
  return problems;
}

/** Every rule the overrides break, one message each; empty when all hold */
export function checkOverridesLedger(
  overrides: Record<string, string>,
  lockText: string,
  tomlText: string
): string[] {
  const packages = parseLockPackages(lockText);
  const { entries: ledger, problems } = parseLedger(tomlText);
  for (const [key, version] of Object.entries(overrides)) {
    problems.push(...checkOverride(key, version, packages, ledger));
  }
  for (const key of ledger.keys()) {
    if (!(key in overrides)) {
      problems.push(`ledger entry ${key} has no override in package.json`);
    }
  }
  return problems;
}
