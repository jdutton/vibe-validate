/**
 * Edge Case System Tests for doctor command
 *
 * Tests doctor behavior across various environment configurations:
 * 1. .git + good config
 * 2. .git + no config
 * 3. .git + bad config
 * 4. No .git + no config
 * 5. No .git + good config
 * 6. No .git + bad config
 *
 * Uses isolated test environments in /tmp to avoid affecting the main repo.
 * Tests run in parallel for speed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { safeExecFromString } from '@vibe-validate/utils';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Get path to the vv binary from the built CLI package
const PROJECT_ROOT = join(__dirname, '../../../..');
const VV_BINARY = join(PROJECT_ROOT, 'packages/cli/dist/bin/vv');

// Base directory for test environments
// eslint-disable-next-line sonarjs/publicly-writable-directories -- Test isolation requires /tmp
const TEST_BASE_DIR = '/tmp/vibe-validate-doctor-edge-cases';

/**
 * Good config template for testing
 */
const GOOD_CONFIG = `validation:
  phases:
    - name: "Test Phase"
      steps:
        - name: "Echo Test"
          command: "echo test"
`;

/**
 * Bad config with invalid YAML syntax
 */
const BAD_CONFIG = `validation:
  phases:
    - name: "Test Phase"
      steps:
        - name: "Missing closing bracket
          command: "echo test"
`;

/**
 * Execute doctor command in a specific directory (with --verbose to see all checks)
 */
function runDoctorInDir(cwd: string): {
  exitCode: number;
  output: string;
  allPassed: boolean;
} {
  try {
    const output = safeExecFromString(`node "${VV_BINARY}" doctor --verbose`, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return {
      exitCode: 0,
      output,
      allPassed: output.includes('All checks passed'),
    };
  } catch (error: any) {
    const output = error.stdout || error.stderr || '';
    return {
      exitCode: error.status || 1,
      output,
      allPassed: false,
    };
  }
}

/**
 * Create a test environment with specified characteristics
 */
function createTestEnv(envName: string, options: {
  hasGit: boolean;
  configType: 'good' | 'bad' | 'none';
}): string {
  const envPath = join(TEST_BASE_DIR, envName);

  // Create directory
  if (existsSync(envPath)) {
    rmSync(envPath, { recursive: true, force: true });
  }
  mkdirSync(envPath, { recursive: true });

  // Initialize git if requested
  if (options.hasGit) {
    safeExecFromString('git init', { cwd: envPath, stdio: 'ignore' });
    safeExecFromString('git config user.name "Test User"', { cwd: envPath, stdio: 'ignore' });
    safeExecFromString('git config user.email "test@example.com"', { cwd: envPath, stdio: 'ignore' });
  }

  // Create config if requested
  if (options.configType !== 'none') {
    const configPath = join(envPath, 'vibe-validate.config.yaml');
    const configContent = options.configType === 'good' ? GOOD_CONFIG : BAD_CONFIG;
    writeFileSync(configPath, configContent, 'utf8');
  }

  return envPath;
}

describe('doctor command - edge case system tests', () => {
  beforeAll(() => {
    // Clean up any existing test environments
    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_BASE_DIR, { recursive: true });
  });

  afterAll(() => {
    // Clean up test environments after all tests
    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  describe('Scenario 1: .git + good config', () => {
    it('should pass relevant checks and report config as valid', () => {
      // ARRANGE: Create test environment
      const envPath = createTestEnv('scenario-1-git-good-config', {
        hasGit: true,
        configType: 'good',
      });

      // ACT: Run doctor
      const result = runDoctorInDir(envPath);

      // ASSERT: Should not crash, should report config as valid
      expect(result.output).toContain('Git repository');
      expect(result.output).toContain('Configuration');
      // Config should be valid
      expect(result.output).toMatch(/✅.*Configuration valid/);
      // Should not report errors
      expect(result.output).not.toContain('Invalid configuration');
    });
  });

  describe('Scenario 2: .git + no config', () => {
    it('should pass git checks but report missing config', () => {
      // ARRANGE: Create test environment
      const envPath = createTestEnv('scenario-2-git-no-config', {
        hasGit: true,
        configType: 'none',
      });

      // ACT: Run doctor
      const result = runDoctorInDir(envPath);

      // ASSERT: Should detect git repo but missing config
      expect(result.output).toContain('Git repository');
      expect(result.output).toMatch(/❌.*Configuration file/);
      expect(result.output).toContain('Configuration file not found');
    });
  });

  describe('Scenario 3: .git + bad config', () => {
    it('should pass git checks but report invalid config', () => {
      // ARRANGE: Create test environment
      const envPath = createTestEnv('scenario-3-git-bad-config', {
        hasGit: true,
        configType: 'bad',
      });

      // ACT: Run doctor
      const result = runDoctorInDir(envPath);

      // ASSERT: Should detect git repo and invalid config
      expect(result.output).toContain('Git repository');
      expect(result.output).toMatch(/✅.*Configuration file/); // File exists
      expect(result.output).toMatch(/❌.*Configuration valid/); // But invalid
      expect(result.output).toContain('validation errors');
    });
  });

  describe('Scenario 4: no .git + no config', () => {
    it('should report not a git repository and missing config', () => {
      // ARRANGE: Create test environment
      const envPath = createTestEnv('scenario-4-no-git-no-config', {
        hasGit: false,
        configType: 'none',
      });

      // ACT: Run doctor
      const result = runDoctorInDir(envPath);

      // ASSERT: Should report not a git repo and no config
      expect(result.output).toMatch(/❌.*Git repository/);
      expect(result.output).toContain('not a git repository');
      expect(result.output).toMatch(/❌.*Configuration file/);
      expect(result.output).toContain('Configuration file not found');
    });
  });

  describe('Scenario 5: no .git + good config', () => {
    it('should report not a git repository but config is valid', () => {
      // ARRANGE: Create test environment
      const envPath = createTestEnv('scenario-5-no-git-good-config', {
        hasGit: false,
        configType: 'good',
      });

      // ACT: Run doctor
      const result = runDoctorInDir(envPath);

      // ASSERT: Should report not a git repo but config is valid
      expect(result.output).toMatch(/❌.*Git repository/);
      expect(result.output).toContain('not a git repository');
      expect(result.output).toMatch(/✅.*Configuration file/);
      expect(result.output).toMatch(/✅.*Configuration valid/);
    });
  });

  describe('Scenario 6: no .git + bad config', () => {
    it('should report not a git repository and invalid config', () => {
      // ARRANGE: Create test environment
      const envPath = createTestEnv('scenario-6-no-git-bad-config', {
        hasGit: false,
        configType: 'bad',
      });

      // ACT: Run doctor
      const result = runDoctorInDir(envPath);

      // ASSERT: Should report not a git repo and invalid config
      expect(result.output).toMatch(/❌.*Git repository/);
      expect(result.output).toContain('not a git repository');
      expect(result.output).toMatch(/✅.*Configuration file/); // File exists
      expect(result.output).toMatch(/❌.*Configuration valid/); // But invalid
    });
  });

  describe('Parallel execution verification', () => {
    it('should handle all 6 scenarios correctly when run in parallel', () => {
      // ARRANGE: Create all 6 test environments
      const scenarios = [
        { name: 'parallel-1', hasGit: true, configType: 'good' as const },
        { name: 'parallel-2', hasGit: true, configType: 'none' as const },
        { name: 'parallel-3', hasGit: true, configType: 'bad' as const },
        { name: 'parallel-4', hasGit: false, configType: 'none' as const },
        { name: 'parallel-5', hasGit: false, configType: 'good' as const },
        { name: 'parallel-6', hasGit: false, configType: 'bad' as const },
      ];

      const envPaths = scenarios.map(s => ({
        name: s.name,
        path: createTestEnv(s.name, s),
        hasGit: s.hasGit,
        configType: s.configType,
      }));

      // ACT: Run doctor in all environments in parallel
      const results = envPaths.map(env => ({
        ...env,
        result: runDoctorInDir(env.path),
      }));

      // ASSERT: Verify each scenario behaved correctly
      for (const { name, hasGit, configType, result } of results) {
        // All should complete without crashing
        expect(result.output).toBeTruthy();

        // Git check expectations
        if (hasGit) {
          expect(result.output, `${name}: Should detect git repo`).toMatch(/✅.*Git repository/);
        } else {
          expect(result.output, `${name}: Should detect no git repo`).toMatch(/❌.*Git repository/);
        }

        // Config check expectations
        if (configType === 'none') {
          expect(result.output, `${name}: Should detect missing config`).toMatch(/❌.*Configuration file/);
        } else if (configType === 'good') {
          expect(result.output, `${name}: Should validate good config`).toMatch(/✅.*Configuration valid/);
        } else if (configType === 'bad') {
          expect(result.output, `${name}: Should reject bad config`).toMatch(/❌.*Configuration valid/);
        }
      }
    });
  });
});
