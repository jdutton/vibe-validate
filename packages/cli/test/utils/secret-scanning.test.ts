/**
 * Unit tests for secret scanning tool detection and execution
 */

import { existsSync } from 'node:fs';

import * as utils from '@vibe-validate/utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  hasGitleaksConfig,
  hasSecretlintConfig,
  detectSecretScanningTools,
  selectToolsToRun,
  runSecretScan,
  formatToolName,
  showPerformanceWarning,
} from '../../src/utils/secret-scanning.js';

// Mock Node.js modules
vi.mock('node:fs');
vi.mock('@vibe-validate/utils', () => ({
  isToolAvailable: vi.fn(() => true),
  safeExecSync: vi.fn(() => ''),
  safeExecFromString: vi.fn(() => ''),
}));

describe('secret-scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    it('should detect both tools when both are available and configured', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(true);
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
        defaultCommand: 'npx secretlint .', // No glob patterns
      });
    });

    it('should detect gitleaks available but not configured', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const tools = detectSecretScanningTools('/test');

      expect(tools[0]).toMatchObject({
        tool: 'gitleaks',
        available: true,
        hasConfig: false,
      });
    });

    it('should detect gitleaks configured but not available', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(false);

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

    it('should always report secretlint as available via npx', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(false);
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

    it('should run both tools when both configs exist (autodetect)', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(true);

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(2);
      expect(tools[0].tool).toBe('gitleaks');
      expect(tools[1].tool).toBe('secretlint');
    });

    it('should run only gitleaks when only gitleaks config exists', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(true);
      vi.mocked(existsSync).mockImplementation((path) => {
        return path.toString().includes('gitleaks');
      });

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('gitleaks');
    });

    it('should run only secretlint when only secretlint config exists', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(false);
      vi.mocked(existsSync).mockImplementation((path) => {
        return path.toString().includes('secretlint');
      });

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('secretlint');
    });

    it('should fallback to gitleaks when no configs exist and gitleaks available', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        tool: 'gitleaks',
        command: 'gitleaks protect --staged --verbose',
      });
    });

    it('should fallback to secretlint when no configs and gitleaks unavailable', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(false);

      vi.mocked(existsSync).mockReturnValue(false);

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        tool: 'secretlint',
        command: 'npx secretlint .', // No glob patterns
      });
    });

    it('should include gitleaks even when unavailable if config exists (will skip during execution)', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(false);
      vi.mocked(existsSync).mockImplementation((path) => {
        return path.toString().includes('gitleaks');
      });

      const tools = selectToolsToRun(undefined, '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('gitleaks');
    });

    it('should treat "autodetect" keyword as undefined', async () => {
      const { isToolAvailable } = await import('@vibe-validate/utils');
      vi.mocked(isToolAvailable).mockReturnValue(true);
      vi.mocked(existsSync).mockReturnValue(false);

      const tools = selectToolsToRun('autodetect', '/test');

      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('gitleaks');
    });
  });

  describe('runSecretScan', () => {
    // Helper to reduce duplication
    const mockSuccess = (output = 'No secrets found') => {
      vi.mocked(utils.safeExecFromString).mockReturnValue(output);
    };

    const mockError = (stderr: string, stdout = '') => {
      const error = new Error('Command failed') as Error & { stderr: Buffer; stdout: Buffer };
      error.stderr = Buffer.from(stderr);
      error.stdout = Buffer.from(stdout);
      vi.mocked(utils.safeExecFromString).mockImplementation(() => {
        throw error;
      });
    };

    it('should execute default gitleaks command (no shell syntax)', () => {
      mockSuccess();
      const result = runSecretScan('gitleaks', 'gitleaks protect --staged --verbose', false);

      expect(result.passed).toBe(true);
      expect(result.tool).toBe('gitleaks');
      expect(utils.safeExecFromString).toHaveBeenCalledWith(
        'gitleaks protect --staged --verbose',
        expect.any(Object)
      );
    });

    it('should execute default secretlint command (no shell syntax)', () => {
      mockSuccess();
      // CRITICAL TEST: Default secretlint command must not contain shell syntax
      const result = runSecretScan('secretlint', 'npx secretlint .', false);

      expect(result.passed).toBe(true);
      expect(result.tool).toBe('secretlint');
      expect(utils.safeExecFromString).toHaveBeenCalledWith('npx secretlint .', expect.any(Object));
    });

    it('should return success result when scan passes', () => {
      mockSuccess();
      const result = runSecretScan('gitleaks', 'gitleaks protect --staged', false);

      expect(result.passed).toBe(true);
      expect(result.tool).toBe('gitleaks');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.skipped).toBeUndefined();
    });

    it('should return failure result when scan finds secrets', () => {
      mockError('Found secret: API key', 'Scan output');
      const result = runSecretScan('gitleaks', 'gitleaks protect --staged', false);

      expect(result.passed).toBe(false);
      expect(result.tool).toBe('gitleaks');
      expect(result.output).toBe('Scan output');
      expect(result.error).toBe('Found secret: API key');
    });

    it('should skip gitleaks if command not available', () => {
      vi.mocked(utils.isToolAvailable).mockReturnValue(false);
      const result = runSecretScan('gitleaks', 'gitleaks protect --staged', false);

      expect(result.passed).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('gitleaks command not available');
    });

    it('should not skip secretlint (always available via npx)', () => {
      mockError('Found secret');
      const result = runSecretScan('secretlint', 'npx secretlint .', false);

      expect(result.passed).toBe(false);
      expect(result.skipped).toBeUndefined();
    });

    it('should FAIL LOUD if default secretlint command errors (never skip silently)', () => {
      mockError('npx: command not found');
      // CRITICAL: secretlint should NEVER skip silently - always fail loud
      const result = runSecretScan('secretlint', 'npx secretlint .', false);

      expect(result.passed).toBe(false);
      expect(result.error).toContain('npx: command not found');
      expect(result.skipped).toBeUndefined(); // NEVER skipped!
    });

    it('should include output when verbose is true', () => {
      mockSuccess('Detailed output');
      const result = runSecretScan('gitleaks', 'gitleaks protect --staged', true);

      expect(result.passed).toBe(true);
      expect(result.output).toBe('Detailed output');
    });

    it('should not include output when verbose is false', () => {
      mockSuccess('Detailed output');
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

  describe('showPerformanceWarning', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should not warn if duration is below threshold', () => {
      showPerformanceWarning('secretlint', 3000, 5000);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should warn with install suggestion when no explicit command', () => {
      showPerformanceWarning('secretlint', 6000, 5000, false);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const allWarnings = consoleWarnSpy.mock.calls.map(call => call[0]).join('\n');
      expect(allWarnings).toContain('secretlint');
      expect(allWarnings).toContain('gitleaks');
      expect(allWarnings).toContain('scanCommand');
    });

    it('should warn without install suggestion when explicit command provided', () => {
      showPerformanceWarning('secretlint', 6000, 5000, true);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const allWarnings = consoleWarnSpy.mock.calls.map(call => call[0]).join('\n');
      expect(allWarnings).toContain('secretlint');
      expect(allWarnings).not.toContain('scanCommand');
    });
  });
});
