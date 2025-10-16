#!/usr/bin/env node
/**
 * Vibe-Validate CLI Entry Point
 *
 * This script loads the configuration and runs the validation runner.
 */

import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { runValidation } from './runner.js';
import type { ValidationConfig } from './types.js';

/**
 * Find and load vibe-validate.config.ts
 *
 * @returns A config object with validation, git, and output settings
 */
async function loadConfig(): Promise<any> {
  const cwd = process.cwd();
  const configPaths = [
    'vibe-validate.config.ts',
    'vibe-validate.config.js',
    'vibe-validate.config.mjs',
    '.vibe-validate.ts',
    '.vibe-validate.js',
    '.vibe-validate.mjs',
  ];

  for (const configPath of configPaths) {
    const fullPath = join(cwd, configPath);
    if (existsSync(fullPath)) {
      console.log(`📋 Loading config from ${configPath}`);
      try {
        // Use dynamic import to support both .ts and .js configs
        const configModule = await import(`file://${resolve(fullPath)}`);
        const config = configModule.default || configModule;
        return config;
      } catch (error) {
        console.error(`❌ Failed to load config from ${configPath}:`, error);
        process.exit(1);
      }
    }
  }

  console.error('❌ No vibe-validate.config.ts found in current directory');
  console.error('   Searched for:');
  configPaths.forEach((path) => console.error(`   - ${path}`));
  process.exit(1);
}

/**
 * Main CLI entry point
 */
async function main() {
  try {
    // Load configuration
    const rawConfig = await loadConfig();

    // Adapt config structure for runner
    // The config loader returns a structured config with {validation, git, output}
    // The runner expects a flat config with {phases, ...}

    // Convert process.env to Record<string, string> by filtering out undefined values
    const envVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        envVars[key] = value;
      }
    }

    const runnerConfig: ValidationConfig = {
      phases: rawConfig.validation?.phases || [],
      enableFailFast: rawConfig.validation?.failFast ?? true,
      env: envVars,
      stateFilePath: '.vibe-validate-state.yaml',
      onPhaseStart: (phase) => console.log(`\n🔄 Running phase: ${phase.name}`),
      onPhaseComplete: (phase, result) => {
        if (result.passed) {
          console.log(`✅ Phase ${phase.name} completed successfully`);
        } else {
          console.log(`❌ Phase ${phase.name} failed`);
        }
      },
      onStepStart: (step) => console.log(`  ⏳ ${step.name}...`),
      onStepComplete: (step, result) => {
        if (result.passed) {
          console.log(`  ✅ ${step.name} (${result.duration}ms)`);
        } else {
          console.log(`  ❌ ${step.name} failed (${result.duration}ms)`);
        }
      },
    };

    // Run validation
    const result = await runValidation(runnerConfig);

    // Exit with appropriate code
    process.exit(result.passed ? 0 : 1);
  } catch (error) {
    console.error('❌ Validation failed with error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
