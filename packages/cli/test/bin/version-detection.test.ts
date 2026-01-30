/**
 * Tests for vibe-validate wrapper's version detection and warning system
 */
/* eslint-disable sonarjs/slow-regex -- Simple test regex patterns, not user-facing */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { executeWrapperSync } from '../helpers/test-command-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('vv wrapper version detection', () => {
  it('should detect and report version in debug mode', () => {
    const result = executeWrapperSync(['--version'], {
      env: { VV_DEBUG: '1' },
    });

    expect(result.status).toBe(0);

    // Check stdout for version number
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);

    // Check stderr for debug output
    expect(result.stderr).toContain('[vv debug] Context:');
    expect(result.stderr).toContain('[vv debug] Binary:');
    expect(result.stderr).toContain('[vv debug] Global version:');
  });

  it('should not show debug output without VV_DEBUG=1', () => {
    const result = executeWrapperSync(['--version']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);

    // Should NOT have debug output in stderr
    expect(result.stderr).not.toContain('[vv debug]');
  });

  it('should report dev context when in vibe-validate repo', () => {
    // Run from the repo root
    const result = executeWrapperSync(['--version'], {
      cwd: join(__dirname, '../../../..'), // Go to repo root
      env: { VV_DEBUG: '1' },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[vv debug] Context: dev');
  });
});
