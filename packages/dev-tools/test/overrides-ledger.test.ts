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

const TOML = `# Overrides ledger.
#     basic-ftp 5.3.1   GHSA-c475-qrg2-pj4r  (an adopter note, not a pin)
#     @hono/node-server 2.1.3           (GHSA-rmxm-3fg6-px4f)
#     ajv@8 8.18.0, lodash 4.18.1,
#                                       (a continuation line)
[[IgnoredVulns]]
id = "GHSA-mrhx-c7xc-m3w5"
`;

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
    expect(Object.fromEntries(parseLedger(TOML))).toEqual(OVERRIDES);
  });

  it('passes when every pin resolves, is listed and is not deprecated', () => {
    expect(checkOverridesLedger(OVERRIDES, LOCK, TOML)).toEqual([]);
  });

  it('(a) fails on an override that resolves no package', () => {
    expect(checkOverridesLedger({ ...OVERRIDES, 'ajv@6': '6.14.0' }, LOCK, `${TOML}#     ajv@6 6.14.0\n`)).toEqual([
      'override ajv@6 6.14.0 resolves no package in pnpm-lock.yaml',
    ]);
  });

  it('(b) fails on an override missing from the ledger', () => {
    const toml = TOML.replace('#     @hono/node-server 2.1.3           (GHSA-rmxm-3fg6-px4f)\n', '');
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

  it('holds for this repository', () => {
    const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
    const read = (file: string): string => readFileSync(join(root, file), 'utf8');
    const overrides = (JSON.parse(read('package.json')) as { pnpm: { overrides: Record<string, string> } }).pnpm
      .overrides;
    expect(checkOverridesLedger(overrides, read('pnpm-lock.yaml'), read('osv-scanner.toml'))).toEqual([]);
  });
});
