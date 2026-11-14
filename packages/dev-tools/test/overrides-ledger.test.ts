import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkOverridesLedger, parseLedger, parseLockPackages } from '../src/overrides-ledger.js';

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      lodash:
        specifier: 4.18.1
        version: 4.18.1

packages:

  '@hono/node-server@2.1.3':
    resolution: {integrity: sha512-a}

  ajv@8.18.0:
    resolution: {integrity: sha512-b}

  lodash@4.18.0:
    resolution: {integrity: sha512-c}
    deprecated: Bad release.

  lodash@4.18.1:
    resolution: {integrity: sha512-d}

snapshots:

  ajv@6.14.0:
    dependencies: {}
`;

const HONO_LINE = '#     @hono/node-server 2.1.3           (GHSA-rmxm-3fg6-px4f)\n';

/** A toml whose ledger holds `body` between the markers, with an adopter note outside them */
function tomlWith(body: string): string {
  return `# Overrides ledger.
#     basic-ftp 5.3.1   GHSA-c475-qrg2-pj4r  (an adopter note, not a pin)
# BEGIN overrides ledger
#   Prose about the pins sits at three spaces.
#
${body}# END overrides ledger
[[IgnoredVulns]]
id = "GHSA-mrhx-c7xc-m3w5"
`;
}

const TOML = tomlWith(`${HONO_LINE}#     ajv@8 8.18.0, lodash 4.18.1,
#                                       (a continuation line)
`);

const OVERRIDES = { '@hono/node-server': '2.1.3', 'ajv@8': '8.18.0', lodash: '4.18.1' };

describe('overrides ledger', () => {
  it('reads packages, not snapshots, and marks deprecated releases', () => {
    const packages = parseLockPackages(LOCK);
    expect([...packages.keys()]).toEqual([
      '@hono/node-server@2.1.3',
      'ajv@8.18.0',
      'lodash@4.18.0',
      'lodash@4.18.1',
    ]);
    expect(packages.get('lodash@4.18.0')?.deprecated).toBe(true);
    expect(packages.get('lodash@4.18.1')?.deprecated).toBe(false);
  });

  it('reads ledger entries and skips adopter notes and continuation lines', () => {
    const { entries, problems } = parseLedger(TOML);
    expect(Object.fromEntries(entries)).toEqual(OVERRIDES);
    expect(problems).toEqual([]);
  });

  it('passes when every pin resolves, is listed and is not deprecated', () => {
    expect(checkOverridesLedger(OVERRIDES, LOCK, TOML)).toEqual([]);
  });

  it('(a) fails on an override that resolves no package', () => {
    expect(checkOverridesLedger({ ...OVERRIDES, 'ajv@6': '6.14.0' }, LOCK, tomlWith(`${HONO_LINE}#     ajv@6 6.14.0, ajv@8 8.18.0, lodash 4.18.1\n`))).toEqual([
      'override ajv@6 6.14.0 resolves no package in pnpm-lock.yaml',
    ]);
  });

  it('(b) fails on an override missing from the ledger', () => {
    const toml = TOML.replace(HONO_LINE, '');
    expect(checkOverridesLedger(OVERRIDES, LOCK, toml)).toEqual([
      'override @hono/node-server 2.1.3 is missing from the osv-scanner.toml ledger',
    ]);
  });

  it('(b) fails on a ledger entry with no override', () => {
    const rest = Object.fromEntries(Object.entries(OVERRIDES).filter(([key]) => key !== 'lodash'));
    expect(checkOverridesLedger(rest, LOCK, TOML)).toEqual(['ledger entry lodash has no override in package.json']);
  });

  it('(b) fails when the ledger lists another version', () => {
    expect(checkOverridesLedger(OVERRIDES, LOCK, TOML.replace('ajv@8 8.18.0', 'ajv@8 8.17.1'))).toEqual([
      'override ajv@8 is 8.18.0, but the ledger lists 8.17.1',
    ]);
  });

  it('(c) fails on a pin whose lockfile entry is deprecated', () => {
    expect(
      checkOverridesLedger({ ...OVERRIDES, lodash: '4.18.0' }, LOCK, TOML.replace('lodash 4.18.1', 'lodash 4.18.0'))
    ).toEqual(['override lodash 4.18.0 pins a deprecated release']);
  });

  it('fails on an override that is not an exact version', () => {
    expect(checkOverridesLedger({ ...OVERRIDES, 'ajv@8': '>=8.18.0' }, LOCK, TOML)).toEqual([
      'override ajv@8: ">=8.18.0" is not an exact version',
    ]);
  });

  it('(E1) fails when the pinned version does not satisfy the key selector', () => {
    const toml = tomlWith(`${HONO_LINE}#     ajv@6 8.18.0, ajv@8 8.18.0, lodash 4.18.1\n`);
    expect(checkOverridesLedger({ ...OVERRIDES, 'ajv@6': '8.18.0' }, LOCK, toml)).toEqual([
      'override ajv@6 pins 8.18.0, which does not satisfy its selector "6"',
    ]);
  });

  it('(E2) reports a malformed line between the markers', () => {
    const toml = tomlWith(`${HONO_LINE}#     ajv@8 8.18.0, lodash 4.18.1x\n`);
    expect(checkOverridesLedger(OVERRIDES, LOCK, toml)).toEqual([
      'osv-scanner.toml line 7: not a ledger entry or continuation: "#     ajv@8 8.18.0, lodash 4.18.1x"',
      'override ajv@8 8.18.0 is missing from the osv-scanner.toml ledger',
      'override lodash 4.18.1 is missing from the osv-scanner.toml ledger',
    ]);
  });

  it('(E2) reports a line indented one space short of an entry', () => {
    const toml = tomlWith(`${HONO_LINE}#    ajv@8 8.18.0, lodash 4.18.1\n`);
    expect(checkOverridesLedger(OVERRIDES, LOCK, toml)).toEqual([
      'osv-scanner.toml line 7: not a ledger entry or continuation: "#    ajv@8 8.18.0, lodash 4.18.1"',
      'override ajv@8 8.18.0 is missing from the osv-scanner.toml ledger',
      'override lodash 4.18.1 is missing from the osv-scanner.toml ledger',
    ]);
  });

  it('(E2) reports a duplicate ledger key', () => {
    const toml = tomlWith(`${HONO_LINE}#     ajv@8 8.18.0, lodash 4.18.1, lodash 4.18.0\n`);
    expect(checkOverridesLedger(OVERRIDES, LOCK, toml)).toEqual(['ledger key lodash is listed more than once']);
  });

  it('(E2) reports missing markers', () => {
    const toml = TOML.replace('# BEGIN overrides ledger\n', '').replace('# END overrides ledger\n', '');
    expect(checkOverridesLedger(OVERRIDES, LOCK, toml)).toEqual([
      'osv-scanner.toml has no "# BEGIN overrides ledger" line',
      'osv-scanner.toml has no "# END overrides ledger" line',
      'override @hono/node-server 2.1.3 is missing from the osv-scanner.toml ledger',
      'override ajv@8 8.18.0 is missing from the osv-scanner.toml ledger',
      'override lodash 4.18.1 is missing from the osv-scanner.toml ledger',
    ]);
  });

  it('ignores entry-shaped lines outside the markers', () => {
    const { entries } = parseLedger(TOML);
    expect(entries.has('basic-ftp')).toBe(false);
  });

  it('(E3) reports a parent>child override key as unsupported', () => {
    expect(checkOverridesLedger({ ...OVERRIDES, 'vite>rollup': '4.59.0' }, LOCK, TOML)).toEqual([
      'override vite>rollup: parent>child keys are not supported by the ledger check',
    ]);
  });

  it('holds for this repository', () => {
    const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
    const read = (file: string): string => readFileSync(join(root, file), 'utf8');
    const overrides = (JSON.parse(read('package.json')) as { pnpm: { overrides: Record<string, string> } }).pnpm
      .overrides;
    expect(checkOverridesLedger(overrides, read('pnpm-lock.yaml'), read('osv-scanner.toml'))).toEqual([]);
  });
});
