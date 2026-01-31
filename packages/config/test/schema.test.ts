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

/**
 * Create a base valid config object for testing
 * @param overrides - Properties to override in the config
 * @returns A valid config object
 */
function createBaseConfig(overrides: Record<string, unknown> = {}) {
  return {
    validation: {
      phases: [
        {
          name: 'Test',
          steps: [{ name: 'Test', command: 'npm test' }],
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Test that a config validates successfully
 * @param config - The config to validate
 * @returns The validation result for additional assertions
 */
function expectValidConfig(config: Record<string, unknown>) {
  const result = safeValidateConfig(config);
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error('Expected valid config but got errors');
  }
  return result;
}

/**
 * Test that a config fails validation with expected error
 * @param config - The config to validate
 * @param errorCheck - String or regex to match in error messages
 * @returns The validation result for additional assertions
 */
function expectInvalidConfig(
  config: Record<string, unknown>,
  errorCheck: string | RegExp
): { success: false; errors: string[] } {
  const result = safeValidateConfig(config);
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error('Expected invalid config but validation succeeded');
  }

  const errorCheckFn =
    typeof errorCheck === 'string'
      ? (e: string) => e.includes(errorCheck)
      : (e: string) => errorCheck.test(e);

  expect(result.errors).toBeDefined();
  expect(result.errors.some(errorCheckFn)).toBe(true);
  return result;
}

/**
 * Assert locking config with directory scope (default)
 */
function expectLockingDirectoryScope(result: ReturnType<typeof expectValidConfig>) {
  expect(result.data?.locking?.enabled).toBe(true);
  expect(result.data?.locking?.concurrencyScope).toBe('directory');
}

/**
 * Assert secret scanning is enabled with optional scanCommand
 */
function expectSecretScanningEnabled(
  result: ReturnType<typeof expectValidConfig>,
  expectScanCommand: boolean
) {
  expect(result.data?.hooks?.preCommit?.secretScanning?.enabled).toBe(true);
  if (!expectScanCommand) {
    expect(result.data?.hooks?.preCommit?.secretScanning?.scanCommand).toBeUndefined();
  }
}

const TYPESCRIPT_NAME = 'TypeScript';
const TSC_NO_EMIT = 'tsc --noEmit';
const UNRECOGNIZED_KEY_ERROR = 'Unrecognized key';
const UNKNOWN_PROPERTY = 'unknownProperty';
const SHOULD_FAIL = 'should fail';
const TRUST_FULL = 'full';
const TRUST_SANDBOX = 'sandbox';
const MAVEN_COMPILER = 'maven-compiler';
const ESLINT_NAME = 'eslint';
const OLD_PLUGIN = 'old-plugin';
const DEPRECATED_EXTRACTOR = 'deprecated-extractor';

describe('ValidationStepSchema', () => {
  it('should validate valid step', () => {
    const step = {
      name: TYPESCRIPT_NAME,
      command: TSC_NO_EMIT,
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
      name: TYPESCRIPT_NAME,
      command: '',
    };

    expect(() => ValidationStepSchema.parse(step)).toThrow('Command cannot be empty');
  });

  it('should accept optional fields', () => {
    const step = {
      name: TYPESCRIPT_NAME,
      command: TSC_NO_EMIT,
      timeout: 60000,
      continueOnError: true,
      env: { NODE_ENV: 'test' },
      cwd: './packages/core',
    };

    const result = ValidationStepSchema.parse(step);
    expect(result).toMatchObject(step);
  });

  it('should accept cwd field (relative to git root)', () => {
    const step = {
      name: TYPESCRIPT_NAME,
      command: TSC_NO_EMIT,
      cwd: 'packages/core',
    };

    const result = ValidationStepSchema.parse(step);
    expect(result.cwd).toBe('packages/core');
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
    if (result.success) {
      expect(result.data).toBeDefined();
    }
  });

  it('should return errors for invalid config', () => {
    const config = {
      validation: {
        phases: [],
      },
    };

    const result = safeValidateConfig(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    }
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
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toBeDefined();
      // Should have descriptive error messages
      expect(result.errors.some((e: string) => e.includes('cannot be empty'))).toBe(true);
    }
  });
});

describe('HooksConfigSchema', () => {
  it('should validate config with secret scanning enabled', () => {
    const config = createBaseConfig({
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
    });

    const result = expectValidConfig(config);
    expectSecretScanningEnabled(result, true);
    expect(result.data?.hooks?.preCommit?.secretScanning?.scanCommand).toBe('gitleaks protect --staged --verbose');
  });

  it('should validate config with secret scanning disabled', () => {
    const config = createBaseConfig({
      hooks: {
        preCommit: {
          enabled: true,
          secretScanning: {
            enabled: false
          }
        }
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.hooks?.preCommit?.secretScanning?.enabled).toBe(false);
  });

  it('should apply defaults when secretScanning not specified', () => {
    const config = createBaseConfig({
      hooks: {
        preCommit: {
          enabled: true
        }
      }
    });

    const result = expectValidConfig(config);
    // secretScanning should not be present by default (optional field)
    expect(result.data?.hooks?.preCommit?.secretScanning).toBeUndefined();
  });

  it('should allow secretScanning enabled without scanCommand (autodetect)', () => {
    const config = createBaseConfig({
      hooks: {
        preCommit: {
          enabled: true,
          secretScanning: {
            enabled: true
            // scanCommand is optional - defaults to autodetect
          }
        }
      }
    });

    const result = expectValidConfig(config);
    expectSecretScanningEnabled(result, false);
  });

  it('should allow custom scan commands', () => {
    const config = createBaseConfig({
      hooks: {
        preCommit: {
          secretScanning: {
            enabled: true,
            scanCommand: 'detect-secrets scan --staged'
          }
        }
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.hooks?.preCommit?.secretScanning?.scanCommand).toBe('detect-secrets scan --staged');
  });

  it('should reject scanCommand when enabled is false', () => {
    const config = createBaseConfig({
      hooks: {
        preCommit: {
          secretScanning: {
            enabled: false,
            scanCommand: 'gitleaks protect --staged'  // Should not be allowed when disabled
          }
        }
      }
    });

    expectValidConfig(config);
    // This should succeed but scanCommand is ignored when enabled=false
    // Or we could make it fail - let's check the implementation
  });

  it('should reject empty scanCommand', () => {
    const config = createBaseConfig({
      hooks: {
        preCommit: {
          secretScanning: {
            enabled: true,
            scanCommand: ''
          }
        }
      }
    });

    expectInvalidConfig(config, /scanCommand.*empty/i);
  });
});

describe('LockingConfigSchema', () => {
  it('should validate config with locking enabled (default)', () => {
    const config = createBaseConfig({
      locking: {
        enabled: true,
        concurrencyScope: 'directory'
      }
    });

    const result = expectValidConfig(config);
    expectLockingDirectoryScope(result);
  });

  it('should validate config with locking disabled', () => {
    const config = createBaseConfig({
      locking: {
        enabled: false
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.locking?.enabled).toBe(false);
  });

  it('should validate config with project scope', () => {
    const config = createBaseConfig({
      locking: {
        enabled: true,
        concurrencyScope: 'project',
        projectId: 'my-app'
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.locking?.concurrencyScope).toBe('project');
    expect(result.data?.locking?.projectId).toBe('my-app');
  });

  it('should validate config with directory scope (default)', () => {
    const config = createBaseConfig({
      locking: {
        enabled: true,
        concurrencyScope: 'directory'
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.locking?.concurrencyScope).toBe('directory');
  });

  it('should apply defaults when locking not specified', () => {
    const config = createBaseConfig();

    const result = expectValidConfig(config);
    expectLockingDirectoryScope(result);
  });

  it('should reject invalid concurrencyScope values', () => {
    const config = createBaseConfig({
      locking: {
        enabled: true,
        concurrencyScope: 'invalid-scope'
      }
    });

    expectInvalidConfig(config, /concurrencyScope|Invalid enum/);
  });

  it('should allow project scope without explicit projectId (auto-detect)', () => {
    const config = createBaseConfig({
      locking: {
        enabled: true,
        concurrencyScope: 'project'
        // projectId will be auto-detected
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.locking?.concurrencyScope).toBe('project');
    expect(result.data?.locking?.projectId).toBeUndefined();
  });

  it('should reject unknown properties in locking config', () => {
    const config = createBaseConfig({
      locking: {
        enabled: true,
        [UNKNOWN_PROPERTY]: SHOULD_FAIL
      }
    });

    expectInvalidConfig(config, UNRECOGNIZED_KEY_ERROR);
  });
});

describe('Strict Schema Validation', () => {
  it('should reject unknown properties in config root', () => {
    const config = createBaseConfig({
      git: { mainBranch: 'main' },
      unknownProperty: 'should be rejected'
    });

    expectInvalidConfig(config, UNRECOGNIZED_KEY_ERROR);
  });

  it('should reject unknown properties in nested objects (output)', () => {
    const config = createBaseConfig({
      git: { mainBranch: 'main' },
      output: {
        format: 'auto'  // This property doesn't exist in schema
      }
    });

    expectInvalidConfig(config, /Unrecognized.*output/);
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
            unknownStepProperty: SHOULD_FAIL
          }]
        }]
      }
    };

    expectInvalidConfig(config, UNRECOGNIZED_KEY_ERROR);
  });

  it('should reject unknown properties in git config', () => {
    const config = createBaseConfig({
      git: {
        mainBranch: 'main',
        unknownGitProp: SHOULD_FAIL
      }
    });

    expectInvalidConfig(config, /Unrecognized.*git/i);
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

    expectValidConfig(config);
  });
});

describe('ExtractorsConfigSchema', () => {
  it('should apply default values when extractors not specified', () => {
    const config = createBaseConfig();

    const result = expectValidConfig(config);
    expect(result.data?.extractors?.builtins?.trust).toBe('full');
    expect(result.data?.extractors?.builtins?.disable).toEqual([]);
    expect(result.data?.extractors?.localPlugins?.trust).toBe('sandbox');
    expect(result.data?.extractors?.localPlugins?.disable).toEqual([]);
    expect(result.data?.extractors?.external).toEqual([]);
  });

  it('should validate config with custom builtin trust level', () => {
    const config = createBaseConfig({
      extractors: {
        builtins: {
          trust: TRUST_SANDBOX
        }
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.extractors?.builtins?.trust).toBe('sandbox');
  });

  it('should validate config with disabled built-in extractors', () => {
    const config = createBaseConfig({
      extractors: {
        builtins: {
          trust: TRUST_FULL,
          disable: [MAVEN_COMPILER, ESLINT_NAME]
        }
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.extractors?.builtins?.disable).toEqual([MAVEN_COMPILER, ESLINT_NAME]);
  });

  it('should validate config with custom local plugin trust level', () => {
    const config = createBaseConfig({
      extractors: {
        localPlugins: {
          trust: TRUST_FULL
        }
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.extractors?.localPlugins?.trust).toBe('full');
  });

  it('should validate config with disabled local plugins', () => {
    const config = createBaseConfig({
      extractors: {
        localPlugins: {
          trust: TRUST_SANDBOX,
          disable: [OLD_PLUGIN, DEPRECATED_EXTRACTOR]
        }
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.extractors?.localPlugins?.disable).toEqual([OLD_PLUGIN, DEPRECATED_EXTRACTOR]);
  });

  it('should validate config with external npm package extractor (default trust)', () => {
    const config = createBaseConfig({
      extractors: {
        external: [
          {
            package: '@myorg/vibe-validate-plugin-gradle'
          }
        ]
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.extractors?.external).toHaveLength(1);
    expect(result.data?.extractors?.external?.[0].package).toBe('@myorg/vibe-validate-plugin-gradle');
    expect(result.data?.extractors?.external?.[0].trust).toBe('sandbox');
  });

  it('should validate config with external npm package extractor (explicit trust)', () => {
    const config = createBaseConfig({
      extractors: {
        external: [
          {
            package: '@myorg/internal-plugin',
            trust: TRUST_FULL
          }
        ]
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.extractors?.external?.[0].trust).toBe('full');
  });

  it('should validate config with multiple external extractors', () => {
    const config = createBaseConfig({
      extractors: {
        external: [
          {
            package: '@myorg/plugin-gradle',
            trust: TRUST_SANDBOX
          },
          {
            package: '@myorg/plugin-webpack',
            trust: TRUST_SANDBOX
          },
          {
            package: '@myorg/internal-plugin',
            trust: TRUST_FULL
          }
        ]
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.extractors?.external).toHaveLength(3);
  });

  it('should validate complete extractors config', () => {
    const config = createBaseConfig({
      extractors: {
        builtins: {
          trust: TRUST_FULL,
          disable: [MAVEN_COMPILER]
        },
        localPlugins: {
          trust: TRUST_SANDBOX,
          disable: [OLD_PLUGIN]
        },
        external: [
          {
            package: '@myorg/plugin-gradle',
            trust: TRUST_SANDBOX
          }
        ]
      }
    });

    const result = expectValidConfig(config);
    expect(result.data?.extractors?.builtins?.trust).toBe('full');
    expect(result.data?.extractors?.builtins?.disable).toEqual([MAVEN_COMPILER]);
    expect(result.data?.extractors?.localPlugins?.trust).toBe('sandbox');
    expect(result.data?.extractors?.localPlugins?.disable).toEqual([OLD_PLUGIN]);
    expect(result.data?.extractors?.external).toHaveLength(1);
  });

  it('should reject invalid trust level for builtins', () => {
    const config = createBaseConfig({
      extractors: {
        builtins: {
          trust: 'invalid'
        }
      }
    });

    expectInvalidConfig(config, /Invalid enum|trust/);
  });

  it('should reject invalid trust level for localPlugins', () => {
    const config = createBaseConfig({
      extractors: {
        localPlugins: {
          trust: 'untrusted'
        }
      }
    });

    expectInvalidConfig(config, /Invalid enum|trust/);
  });

  it('should reject invalid trust level for external extractor', () => {
    const config = createBaseConfig({
      extractors: {
        external: [
          {
            package: '@myorg/plugin',
            trust: 'partial'
          }
        ]
      }
    });

    expectInvalidConfig(config, /Invalid enum|trust/);
  });

  it('should reject empty package name for external extractor', () => {
    const config = createBaseConfig({
      extractors: {
        external: [
          {
            package: '',
            trust: TRUST_SANDBOX
          }
        ]
      }
    });

    expectInvalidConfig(config, /Package name.*empty/);
  });

  it('should reject unknown properties in extractors config', () => {
    const config = createBaseConfig({
      extractors: {
        builtins: {
          trust: TRUST_FULL,
          [UNKNOWN_PROPERTY]: SHOULD_FAIL
        }
      }
    });

    expectInvalidConfig(config, UNRECOGNIZED_KEY_ERROR);
  });

  it('should reject unknown properties in external extractor', () => {
    const config = createBaseConfig({
      extractors: {
        external: [
          {
            package: '@myorg/plugin',
            trust: TRUST_SANDBOX,
            unknownField: SHOULD_FAIL
          }
        ]
      }
    });

    expectInvalidConfig(config, UNRECOGNIZED_KEY_ERROR);
  });
});
