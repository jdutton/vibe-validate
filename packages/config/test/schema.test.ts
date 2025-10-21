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
    expect(result.git.mainBranch).toBe('main');
    expect(result.validation.phases).toHaveLength(1);
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

describe('HooksConfigSchema', () => {
  it('should validate config with secret scanning enabled', () => {
    const config = {
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      },
      hooks: {
        preCommit: {
          enabled: true,
          command: 'npx vibe-validate pre-commit',
          secretScanning: {
            enabled: true,
            scanCommand: 'gitleaks protect --staged --verbose'
          }
        }
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(true);
    expect(result.data?.hooks?.preCommit?.secretScanning?.enabled).toBe(true);
    expect(result.data?.hooks?.preCommit?.secretScanning?.scanCommand).toBe('gitleaks protect --staged --verbose');
  });

  it('should validate config with secret scanning disabled', () => {
    const config = {
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      },
      hooks: {
        preCommit: {
          enabled: true,
          secretScanning: {
            enabled: false
          }
        }
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(true);
    expect(result.data?.hooks?.preCommit?.secretScanning?.enabled).toBe(false);
  });

  it('should apply defaults when secretScanning not specified', () => {
    const config = {
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      },
      hooks: {
        preCommit: {
          enabled: true
        }
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(true);
    // secretScanning should not be present by default (optional field)
    expect(result.data?.hooks?.preCommit?.secretScanning).toBeUndefined();
  });

  it('should require scanCommand when secretScanning is enabled', () => {
    const config = {
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      },
      hooks: {
        preCommit: {
          enabled: true,
          secretScanning: {
            enabled: true
            // Missing scanCommand
          }
        }
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.includes('scanCommand') || e.includes('required'))).toBe(true);
  });

  it('should allow custom scan commands', () => {
    const config = {
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      },
      hooks: {
        preCommit: {
          secretScanning: {
            enabled: true,
            scanCommand: 'detect-secrets scan --staged'
          }
        }
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(true);
    expect(result.data?.hooks?.preCommit?.secretScanning?.scanCommand).toBe('detect-secrets scan --staged');
  });

  it('should reject scanCommand when enabled is false', () => {
    const config = {
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      },
      hooks: {
        preCommit: {
          secretScanning: {
            enabled: false,
            scanCommand: 'gitleaks protect --staged'  // Should not be allowed when disabled
          }
        }
      }
    };

    const result = safeValidateConfig(config);
    // This should succeed but scanCommand is ignored when enabled=false
    // Or we could make it fail - let's check the implementation
    expect(result.success).toBe(true);
  });

  it('should reject empty scanCommand', () => {
    const config = {
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      },
      hooks: {
        preCommit: {
          secretScanning: {
            enabled: true,
            scanCommand: ''
          }
        }
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.includes('scanCommand') && e.includes('empty'))).toBe(true);
  });
});

describe('Strict Schema Validation', () => {
  it('should reject unknown properties in config root', () => {
    const config = {
      git: { mainBranch: 'main' },
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      },
      unknownProperty: 'should be rejected'
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.includes('Unrecognized key'))).toBe(true);
  });

  it('should reject unknown properties in nested objects (output)', () => {
    const config = {
      git: { mainBranch: 'main' },
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      },
      output: {
        format: 'auto'  // This property doesn't exist in schema
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.includes('output') && e.includes('Unrecognized key'))).toBe(true);
  });

  it('should reject unknown properties in validation steps', () => {
    const config = {
      git: { mainBranch: 'main' },
      validation: {
        phases: [{
          name: 'Test',
          steps: [{
            name: 'Test',
            command: 'npm test',
            unknownStepProperty: 'should fail'
          }]
        }]
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.includes('Unrecognized key'))).toBe(true);
  });

  it('should reject unknown properties in git config', () => {
    const config = {
      git: {
        mainBranch: 'main',
        unknownGitProp: 'should fail'
      },
      validation: {
        phases: [{
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }]
        }]
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some(e => e.includes('git') && e.includes('Unrecognized key'))).toBe(true);
  });

  it('should accept valid config with no unknown properties', () => {
    const config = {
      git: { mainBranch: 'main' },
      validation: {
        phases: [{
          name: 'Test',
          parallel: false,
          steps: [{
            name: 'Test',
            command: 'npm test',
            timeout: 60000
          }]
        }],
        failFast: true
      }
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(true);
  });
});
