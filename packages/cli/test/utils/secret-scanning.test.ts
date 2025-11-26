/**
 * Unit tests for secret scanning tool detection and execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  isGitleaksAvailable,
  hasGitleaksConfig,
  hasSecretlintConfig,
  detectSecretScanningTools,
  selectToolsToRun,
  runSecretScan,
  formatToolName,
} from '../../src/utils/secret-scanning.js';

// Mock Node.js modules
vi.mock('node:child_process');
vi.mock('node:fs');

describe('secret-scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isGitleaksAvailable', () => {
    it('should return true when gitleaks is available', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('8.18.0'));

      expect(isGitleaksAvailable()).toBe(true);
      expect(execSync).toHaveBeenCalledWith('gitleaks --version', { stdio: 'ignore' });
    });

    it('should return false when gitleaks is not available', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command not found');
      });

      expect(isGitleaksAvailable()).toBe(false);
    });
  });

  describe('hasGitleaksConfig', () => {
    it('should return true when .gitleaks.toml exists', () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        return path.toString().endsWith('.gitleaks.toml');
      });

      expect(hasGitleaksConfig('/test')).toBe(true);
    });

    it('should return true when .gitleaksignore exists', () => {
      vi.mocked(existsSync).mockImplementation((path) => {
        return path.toString().endsWith('.gitleaksignore');
      });

      expect(hasGitleaksConfig('/test')).toBe(true);
    });

    it('should return false when no gitleaks config exists', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(hasGitleaksConfig('/test')).toBe(false);
    });
  });

  describe('hasSecretlintConfig', () => {
    it('should return true when .secretlintrc.json exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);

      expect(hasSecretlintConfig('/test')).toBe(true);
    });

    it('should return false when .secretlintrc.json does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      expect(hasSecretlintConfig('/test')).toBe(false);
    });
  });

  describe('detectSecretScanningTools', () => {
    it('should detect both tools when both are available and configured', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('8.18.0'));
      vi.mocked(existsSync).mockReturnValue(true);

      const tools = detectSecretScanningTools('/test');

      expect(tools).toHaveLength(2);
      expect(tools[0]).toEqual({
        tool: 'gitleaks',
        available: true,
        hasConfig: true,
        defaultCommand: 'gitleaks protect --staged --verbose',
      });
      expect(tools[1]).toEqual({
        tool: 'secretlint',
        available: true,
        hasConfig: true,
        defaultCommand: 'npx secretlint "**/*"',
      });
    });

    it('should detect gitleaks available but not configured', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('8.18.0'));
      vi.mocked(existsSync).mockReturnValue(false);

      const tools = detectSecretScanningTools('/test');

      expect(tools[0]).toMatchObject({
        tool: 'gitleaks',
        available: true,
        hasConfig: false,
      });
    });

    it('should detect gitleaks configured but not available', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command not found');
      });
      vi.mocked(existsSync).mockImplementation((path) => {
        return path.toString().includes('gitleaks');
      });

      const tools = detectSecretScanningTools('/test');

      expect(tools[0]).toMatchObject({
        tool: 'gitleaks',
        available: false,
        hasConfig: true,
      });
    });

    it('should always report secretlint as available via npx', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command not found');
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const tools = detectSecretScanningTools('/test');

      expect(tools[1]).toMatchObject({
        tool: 'secretlint',
        available: true, // Always available via npx
        hasConfig: false,
      });
    });
  });

  describe('selectToolsToRun', () => {
    it('should use explicit scanCommand when provided (not autodetect)', () => {
      const tools = selectToolsToRun('gitleaks protect --staged', '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        tool: 'gitleaks',
        command: 'gitleaks protect --staged',
      });
    });

    it('should detect secretlint from explicit command', () => {
      const tools = selectToolsToRun('npx secretlint "**/*"', '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        tool: 'secretlint',
        command: 'npx secretlint "**/*"',
      });
    });

    it('should run both tools when both configs exist (autodetect)', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('8.18.0'));
      vi.mocked(existsSync).mockReturnValue(true);

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(2);
      expect(tools[0].tool).toBe('gitleaks');
      expect(tools[1].tool).toBe('secretlint');
    });

    it('should run only gitleaks when only gitleaks config exists', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('8.18.0'));
      vi.mocked(existsSync).mockImplementation((path) => {
        return path.toString().includes('gitleaks');
      });

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('gitleaks');
    });

    it('should run only secretlint when only secretlint config exists', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('gitleaks not found');
      });
      vi.mocked(existsSync).mockImplementation((path) => {
        return path.toString().includes('secretlint');
      });

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('secretlint');
    });

    it('should fallback to gitleaks when no configs exist and gitleaks available', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('8.18.0'));
      vi.mocked(existsSync).mockReturnValue(false);

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        tool: 'gitleaks',
        command: 'gitleaks protect --staged --verbose',
      });
    });

    it('should fallback to secretlint when no configs and gitleaks unavailable', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('gitleaks not found');
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        tool: 'secretlint',
        command: 'npx secretlint "**/*"',
      });
    });

    it('should include gitleaks even when unavailable if config exists (will skip during execution)', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('gitleaks not found');
      });
      vi.mocked(existsSync).mockImplementation((path) => {
        return path.toString().includes('gitleaks');
      });

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('gitleaks');
    });

    it('should treat "autodetect" keyword as undefined', () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from('8.18.0'));
      vi.mocked(existsSync).mockReturnValue(false);

      const tools = selectToolsToRun('autodetect', '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('gitleaks');
    });
  });

  describe('runSecretScan', () => {
    it('should return success result when scan passes', () => {
      vi.mocked(execSync).mockReturnValue('No secrets found');

      const result = runSecretScan('gitleaks', 'gitleaks protect --staged', false);

      expect(result.passed).toBe(true);
      expect(result.tool).toBe('gitleaks');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.skipped).toBeUndefined();
    });

    it('should return failure result when scan finds secrets', () => {
      const error: any = new Error('Secrets found');
      error.stderr = Buffer.from('Found secret: API key');
      error.stdout = Buffer.from('Scan output');

      vi.mocked(execSync).mockImplementation((cmd) => {
        // First call is for isGitleaksAvailable check
        if (cmd === 'gitleaks --version') {
          return 'gitleaks version 8.18.0';
        }
        // Second call is the actual scan command
        throw error;
      });

      const result = runSecretScan('gitleaks', 'gitleaks protect --staged', false);

      expect(result.passed).toBe(false);
      expect(result.tool).toBe('gitleaks');
      expect(result.output).toBe('Scan output');
      expect(result.error).toBe('Found secret: API key');
    });

    it('should skip gitleaks if command not available', () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        // First call is for isGitleaksAvailable check
        if (cmd === 'gitleaks --version') {
          throw new Error('Command not found');
        }
        throw new Error('Should not reach here');
      });

      const result = runSecretScan('gitleaks', 'gitleaks protect --staged', false);

      expect(result.passed).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('gitleaks command not available');
    });

    it('should not skip secretlint (always available via npx)', () => {
      const error: any = new Error('Secrets found');
      error.stderr = Buffer.from('Found secret');
      error.stdout = Buffer.from('');
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      const result = runSecretScan('secretlint', 'npx secretlint "**/*"', false);

      expect(result.passed).toBe(false);
      expect(result.skipped).toBeUndefined();
    });

    it('should include output when verbose is true', () => {
      vi.mocked(execSync).mockReturnValue('Detailed output');

      const result = runSecretScan('gitleaks', 'gitleaks protect --staged', true);

      expect(result.passed).toBe(true);
      expect(result.output).toBe('Detailed output');
    });

    it('should not include output when verbose is false', () => {
      vi.mocked(execSync).mockReturnValue('Detailed output');

      const result = runSecretScan('gitleaks', 'gitleaks protect --staged', false);

      expect(result.passed).toBe(true);
      expect(result.output).toBeUndefined();
    });
  });

  describe('formatToolName', () => {
    it('should format gitleaks correctly', () => {
      expect(formatToolName('gitleaks')).toBe('gitleaks');
    });

    it('should format secretlint correctly', () => {
      expect(formatToolName('secretlint')).toBe('secretlint');
    });
  });
});
