#!/usr/bin/env node
/**
 * Capture Test Framework Output Samples
 *
 * This script runs intentionally failing tests and captures their output
 * for use in testing error extractors.
 *
 * Cross-platform replacement for capture-samples.sh
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, '..');
const SAMPLES_DIR = join(ROOT_DIR, '../extractors/test/samples');
const JUNIT_DIR = join(ROOT_DIR, 'junit-output');

function banner(message: string): void {
  console.log('═'.repeat(67));
  console.log(message);
  console.log('═'.repeat(67));
  console.log('');
}

function section(message: string): void {
  console.log(`${message}`);
}

function success(message: string): void {
  console.log(`✅ ${message}`);
}

function warning(message: string): void {
  console.error(`⚠️  ${message}`);
}

function runCommand(command: string, outputFile?: string): void {
  try {
    const output = execSync(command, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: outputFile ? 'pipe' : 'inherit',
      shell: true,
    });

    if (outputFile && output) {
      writeFileSync(outputFile, output, 'utf8');
    }
  } catch (error) {
    // Expected to fail (tests are intentional failures)
    if (outputFile && error instanceof Error && 'stdout' in error) {
      const stdout = (error as any).stdout as string;
      if (stdout) {
        writeFileSync(outputFile, stdout, 'utf8');
      }
    }
  }
}

async function main(): Promise<void> {
  banner('Capturing Test Framework Output Samples');

  section('This script runs intentionally failing tests and captures their output');
  section('for use in testing error extractors.');
  console.log('');

  // Create sample directories
  mkdirSync(join(SAMPLES_DIR, 'jest'), { recursive: true });
  mkdirSync(join(SAMPLES_DIR, 'vitest'), { recursive: true });
  mkdirSync(join(SAMPLES_DIR, 'mocha'), { recursive: true });
  mkdirSync(JUNIT_DIR, { recursive: true });

  // Jest - Text Output
  section('📝 Capturing Jest text output...');
  const jestTextOutput = join(SAMPLES_DIR, 'jest/extraction-test-bed.txt');
  runCommand('npm run test:jest', jestTextOutput);
  success(`Saved to: ${jestTextOutput}`);
  console.log('');

  // Jest - JUnit XML
  section('📄 Capturing Jest JUnit XML...');
  runCommand('npm run test:jest:junit');
  const jestJunitSource = join(JUNIT_DIR, 'junit.xml');
  const jestJunitDest = join(SAMPLES_DIR, 'jest/extraction-test-bed.junit.xml');
  if (existsSync(jestJunitSource)) {
    copyFileSync(jestJunitSource, jestJunitDest);
    success(`Saved to: ${jestJunitDest}`);
  } else {
    warning(`JUnit XML not found at ${jestJunitSource}`);
  }
  console.log('');

  // Vitest - Text Output
  section('📝 Capturing Vitest text output...');
  const vitestTextOutput = join(SAMPLES_DIR, 'vitest/extraction-test-bed.txt');
  runCommand('npm run test:vitest', vitestTextOutput);
  success(`Saved to: ${vitestTextOutput}`);
  console.log('');

  // Vitest - JUnit XML
  section('📄 Capturing Vitest JUnit XML...');
  runCommand('npm run test:vitest:junit');
  const vitestJunitSource = join(JUNIT_DIR, 'vitest-results.xml');
  const vitestJunitDest = join(SAMPLES_DIR, 'vitest/extraction-test-bed.junit.xml');
  if (existsSync(vitestJunitSource)) {
    copyFileSync(vitestJunitSource, vitestJunitDest);
    success(`Saved to: ${vitestJunitDest}`);
  } else {
    warning(`JUnit XML not found at ${vitestJunitSource}`);
  }
  console.log('');

  banner('Sample Capture Complete!');

  section('Next steps:');
  section('  1. Review samples in packages/extractors/test/samples/');
  section('  2. Test extractors: cd ../extractors && npm test');
  section('  3. Run baseline test: npx tsx test-generic-baseline.ts');
  console.log('');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
