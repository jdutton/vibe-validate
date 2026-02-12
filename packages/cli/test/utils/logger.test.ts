/**
 * Tests for logger utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Helper: Simulate slow operation that exceeds threshold
 */
function simulateSlowOperation(durationMs: number): void {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    // Busy wait to ensure we exceed threshold
  }
}

describe('createPerfTimer', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalEnv = process.env.VV_DEBUG;
    vi.resetModules(); // Force module reload to pick up new VV_DEBUG value
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env.VV_DEBUG;
    } else {
      process.env.VV_DEBUG = originalEnv;
    }
  });

  describe('VV_DEBUG not set (production mode)', () => {
    beforeEach(() => {
      delete process.env.VV_DEBUG;
    });

    it('should return no-op timer when VV_DEBUG is not set', async () => {
      const { createPerfTimer } = await import('../../src/utils/logger.js');
      const timer = createPerfTimer('test-context');

      timer.mark('step 1');
      timer.mark('step 2');
      timer.done();

      // No debug output in production mode
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
    });

    it('should still check thresholds and warn even when VV_DEBUG is not set', async () => {
      const { createPerfTimer } = await import('../../src/utils/logger.js');
      const timer = createPerfTimer('test-context');

      simulateSlowOperation(150);
      timer.markWithThreshold('slow operation', 100);

      // Should warn about threshold violation
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PERF WARNING]')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('test-context')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('slow operation')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('threshold: 100ms')
      );
    });

    it('should not warn when operation is under threshold', async () => {
      const { createPerfTimer } = await import('../../src/utils/logger.js');
      const timer = createPerfTimer('test-context');

      timer.markWithThreshold('fast operation', 10000);

      // Should not warn
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[PERF WARNING]')
      );
    });
  });

  describe('VV_DEBUG=1 (debug mode)', () => {
    beforeEach(() => {
      process.env.VV_DEBUG = '1';
    });

    it('should log timing breakdown when done() is called', async () => {
      const { createPerfTimer } = await import('../../src/utils/logger.js');
      const timer = createPerfTimer('test-context');

      timer.mark('step 1');
      timer.mark('step 2');
      timer.done();

      // Should log debug output
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] [perf] [test-context]')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('step 1')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('step 2')
      );
    });

    it('should track elapsed and delta times', async () => {
      const { createPerfTimer } = await import('../../src/utils/logger.js');
      const timer = createPerfTimer('test-context');

      timer.mark('first');
      timer.mark('second');
      timer.done();

      // Verify timing format: label, delta (+Xms), elapsed (Xms)
      const calls = consoleErrorSpy.mock.calls.map(call => call[0]);
      const markCalls = calls.filter(c => typeof c === 'string' && c.includes('first'));

      expect(markCalls.length).toBeGreaterThan(0);
      expect(markCalls[0]).toMatch(/\+\d+ms/); // Delta
      expect(markCalls[0]).toMatch(/\(\d+ms\)/); // Elapsed
    });

    it('should warn on threshold violations in debug mode', async () => {
      const { createPerfTimer } = await import('../../src/utils/logger.js');
      const timer = createPerfTimer('test-context');

      simulateSlowOperation(150);
      timer.markWithThreshold('slow step', 100);
      timer.done();

      // Should have both warning and debug output
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PERF WARNING]')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] [perf]')
      );
    });

    it('should include threshold in warning message', async () => {
      const { createPerfTimer } = await import('../../src/utils/logger.js');
      const timer = createPerfTimer('test-context');

      simulateSlowOperation(150);
      timer.markWithThreshold('slow step', 100);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('threshold: 100ms')
      );
    });

    it('should handle multiple marks correctly', async () => {
      const { createPerfTimer } = await import('../../src/utils/logger.js');
      const timer = createPerfTimer('multi-step');

      timer.mark('step 1');
      timer.mark('step 2');
      timer.mark('step 3');
      timer.done();

      // Should log all three steps
      const calls = consoleErrorSpy.mock.calls.map(call => call[0]);
      expect(calls.some(c => typeof c === 'string' && c.includes('step 1'))).toBe(true);
      expect(calls.some(c => typeof c === 'string' && c.includes('step 2'))).toBe(true);
      expect(calls.some(c => typeof c === 'string' && c.includes('step 3'))).toBe(true);
    });

    it('should handle mix of mark and markWithThreshold', async () => {
      const { createPerfTimer } = await import('../../src/utils/logger.js');
      const timer = createPerfTimer('mixed');

      timer.mark('regular mark');
      timer.markWithThreshold('threshold mark', 10000);
      timer.done();

      const calls = consoleErrorSpy.mock.calls.map(call => call[0]);
      expect(calls.some(c => typeof c === 'string' && c.includes('regular mark'))).toBe(true);
      expect(calls.some(c => typeof c === 'string' && c.includes('threshold mark'))).toBe(true);
    });
  });
});
