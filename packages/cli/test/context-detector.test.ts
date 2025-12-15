import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { detectContext, shouldBeVerbose } from '../src/utils/context-detector.js';

describe('context-detector', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear agent/CI environment variables
    delete process.env.CLAUDE_CODE;
    delete process.env.CURSOR;
    delete process.env.AIDER;
    delete process.env.CONTINUE;
    delete process.env.CI;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('detectContext', () => {
    it('should detect Claude Code environment', () => {
      process.env.CLAUDE_CODE = '1';

      const context = detectContext();

      expect(context.isAgent).toBe(true);
      expect(context.agentName).toBe('claude-code');
      expect(context.isCI).toBe(false);
      expect(context.isInteractive).toBe(false);
    });

    it('should detect Cursor environment', () => {
      process.env.CURSOR = '1';

      const context = detectContext();

      expect(context.isAgent).toBe(true);
      expect(context.agentName).toBe('cursor');
      expect(context.isCI).toBe(false);
      expect(context.isInteractive).toBe(false);
    });

    it('should detect Aider environment', () => {
      process.env.AIDER = '1';

      const context = detectContext();

      expect(context.isAgent).toBe(true);
      expect(context.agentName).toBe('aider');
      expect(context.isCI).toBe(false);
      expect(context.isInteractive).toBe(false);
    });

    it('should detect Continue environment', () => {
      process.env.CONTINUE = '1';

      const context = detectContext();

      expect(context.isAgent).toBe(true);
      expect(context.agentName).toBe('continue');
      expect(context.isCI).toBe(false);
      expect(context.isInteractive).toBe(false);
    });

    it('should detect CI environment with CI=true', () => {
      process.env.CI = 'true';

      const context = detectContext();

      expect(context.isAgent).toBe(false);
      expect(context.agentName).toBeUndefined();
      expect(context.isCI).toBe(true);
      expect(context.isInteractive).toBe(false);
    });

    it('should detect CI environment with CI=1', () => {
      process.env.CI = '1';

      const context = detectContext();

      expect(context.isAgent).toBe(false);
      expect(context.isCI).toBe(true);
      expect(context.isInteractive).toBe(false);
    });

    it('should detect interactive terminal (TTY)', () => {
      // Mock process.stdout.isTTY
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        configurable: true,
      });

      const context = detectContext();

      expect(context.isAgent).toBe(false);
      expect(context.isCI).toBe(false);
      expect(context.isInteractive).toBe(true);
    });

    it('should detect non-interactive terminal (no TTY)', () => {
      // Mock process.stdout.isTTY
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        configurable: true,
      });

      const context = detectContext();

      expect(context.isAgent).toBe(false);
      expect(context.isCI).toBe(false);
      expect(context.isInteractive).toBe(false);
    });

    it('should prioritize agent detection over CI', () => {
      process.env.CLAUDE_CODE = '1';
      process.env.CI = 'true';

      const context = detectContext();

      // Agent should take precedence
      expect(context.isAgent).toBe(true);
      expect(context.agentName).toBe('claude-code');
      expect(context.isCI).toBe(false);
    });

    it('should handle undefined isTTY gracefully', () => {
      // Mock process.stdout.isTTY as undefined
      Object.defineProperty(process.stdout, 'isTTY', {
        value: undefined,
        configurable: true,
      });

      const context = detectContext();

      expect(context.isInteractive).toBe(false);
    });
  });

  describe('shouldBeVerbose', () => {
    it('should return false for agent contexts (minimal output preferred)', () => {
      const context = {
        isAgent: true,
        agentName: 'claude-code',
        isCI: false,
        isInteractive: false,
      };

      const verbose = shouldBeVerbose(context);

      expect(verbose).toBe(false);
    });

    it('should return false for CI contexts (minimal output preferred)', () => {
      const context = {
        isAgent: false,
        isCI: true,
        isInteractive: false,
      };

      const verbose = shouldBeVerbose(context);

      expect(verbose).toBe(false);
    });

    it('should return true for interactive terminals (verbose output acceptable)', () => {
      const context = {
        isAgent: false,
        isCI: false,
        isInteractive: true,
      };

      const verbose = shouldBeVerbose(context);

      expect(verbose).toBe(true);
    });

    it('should return false for non-interactive, non-agent, non-CI (minimal default)', () => {
      const context = {
        isAgent: false,
        isCI: false,
        isInteractive: false,
      };

      const verbose = shouldBeVerbose(context);

      expect(verbose).toBe(false);
    });

    it('should prioritize agent over CI when both are true', () => {
      // This shouldn't happen in real scenarios, but test fallback logic
      const context = {
        isAgent: true,
        agentName: 'cursor',
        isCI: true, // Should be ignored
        isInteractive: false,
      };

      const verbose = shouldBeVerbose(context);

      expect(verbose).toBe(false); // Agent takes precedence (both return false anyway)
    });
  });
});
