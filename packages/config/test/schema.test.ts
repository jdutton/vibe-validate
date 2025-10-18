/**
 * Tests for Zod schema validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  safeValidateConfig,
  ValidationStepSchema,
  ValidationPhaseSchema,
} from '../src/schema.js';

describe('ValidationStepSchema', () => {
  it('should validate valid step', () => {
    const step = {
      name: 'TypeScript',
      command: 'tsc --noEmit',
    };

    expect(() => ValidationStepSchema.parse(step)).not.toThrow();
  });

  it('should reject empty name', () => {
    const step = {
      name: '',
      command: 'tsc',
    };

    expect(() => ValidationStepSchema.parse(step)).toThrow('Step name cannot be empty');
  });

  it('should reject empty command', () => {
    const step = {
      name: 'TypeScript',
      command: '',
    };

    expect(() => ValidationStepSchema.parse(step)).toThrow('Command cannot be empty');
  });

  it('should accept optional fields', () => {
    const step = {
      name: 'TypeScript',
      command: 'tsc --noEmit',
      timeout: 60000,
      continueOnError: true,
      env: { NODE_ENV: 'test' },
      cwd: './packages/core',
    };

    const result = ValidationStepSchema.parse(step);
    expect(result).toMatchObject(step);
  });
});

describe('ValidationPhaseSchema', () => {
  it('should validate valid phase', () => {
    const phase = {
      name: 'Testing',
      parallel: true,
      steps: [
        { name: 'Unit Tests', command: 'npm test' },
      ],
    };

    expect(() => ValidationPhaseSchema.parse(phase)).not.toThrow();
  });

  it('should apply defaults', () => {
    const phase = {
      name: 'Testing',
      steps: [
        { name: 'Tests', command: 'npm test' },
      ],
    };

    const result = ValidationPhaseSchema.parse(phase);
    expect(result.parallel).toBe(false);
    expect(result.timeout).toBe(300000);
    expect(result.failFast).toBe(true);
  });

  it('should require at least one step', () => {
    const phase = {
      name: 'Testing',
      steps: [],
    };

    expect(() => ValidationPhaseSchema.parse(phase)).toThrow('at least one step');
  });
});

describe('validateConfig', () => {
  it('should validate complete config', () => {
    const config = {
      validation: {
        phases: [
          {
            name: 'Testing',
            steps: [{ name: 'Test', command: 'npm test' }],
          },
        ],
      },
    };

    expect(() => validateConfig(config)).not.toThrow();
  });

  it('should apply all defaults', () => {
    const config = {
      validation: {
        phases: [
          {
            name: 'Testing',
            steps: [{ name: 'Test', command: 'npm test' }],
          },
        ],
      },
    };

    const result = validateConfig(config);
    expect(result.validation.caching.strategy).toBe('git-tree-hash');
    expect(result.validation.caching.enabled).toBe(true);
    expect(result.git.mainBranch).toBe('main');
    // format field removed - state files are always YAML
  });
});

describe('safeValidateConfig', () => {
  it('should return success for valid config', () => {
    const config = {
      validation: {
        phases: [
          {
            name: 'Testing',
            steps: [{ name: 'Test', command: 'npm test' }],
          },
        ],
      },
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should return errors for invalid config', () => {
    const config = {
      validation: {
        phases: [],
      },
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('should format error messages', () => {
    const config = {
      validation: {
        phases: [
          {
            name: '',  // Invalid
            steps: [],  // Invalid
          },
        ],
      },
    };

    const result = safeValidateConfig(config);
    expect(result.errors).toBeDefined();
    // Should have descriptive error messages
    expect(result.errors!.some(e => e.includes('cannot be empty'))).toBe(true);
  });
});
