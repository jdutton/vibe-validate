#!/usr/bin/env node
/**
 * jscpd-check-new.js
 *
 * Fails pre-commit only if NEW duplication is introduced.
 * Compares current scan to baseline, ignoring existing technical debt.
 */

import { safeExecSync } from '../packages/git/dist/safe-exec.js';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE_FILE = join('.github', '.jscpd-baseline.json');

const JSCPD_ARGS = [
  '.',
  '--min-lines', '5',
  '--min-tokens', '50',
  '--reporters', 'json',
  '--format', 'typescript,javascript',
  '--ignore', '**/*.test.ts,**/*.test.js,**/node_modules/**,**/dist/**,**/coverage/**,**/.turbo/**,**/jscpd-report/**,**/*.json,**/*.yaml,**/*.md',
  '--output', './jscpd-report'
];

/**
 * Run jscpd and return results
 */
function runJscpd() {
  console.log(`🔍 Running jscpd on ${process.platform}...`);
  console.log(`   Working directory: ${process.cwd()}`);
  console.log(`   Output path: ${join('.', 'jscpd-report', 'jscpd-report.json')}`);

  try {
    const result = safeExecSync('npx', ['jscpd', ...JSCPD_ARGS], { encoding: 'utf-8', stdio: 'pipe' });
    console.log('   jscpd completed successfully');
    if (result) {
      console.log(`   Output: ${result.toString().substring(0, 200)}`);
    }
  } catch (error) {
    // jscpd exits with error if duplications found, but we still get JSON
    console.log(`   jscpd exited with error (this may be normal if duplications found)`);
    if (error.status) {
      console.log(`   Exit code: ${error.status}`);
    }
    if (error.stderr) {
      console.error(`   stderr: ${error.stderr.toString()}`);
    }
    if (error.stdout) {
      console.log(`   stdout: ${error.stdout.toString().substring(0, 200)}`);
    }
  }

  const reportPath = join('.', 'jscpd-report', 'jscpd-report.json');
  console.log(`\n📋 Checking for report at: ${reportPath}`);

  if (!existsSync(reportPath)) {
    console.error(`\n❌ jscpd report not generated!`);
    console.error(`   Expected: ${reportPath}`);
    console.error(`   Current directory: ${process.cwd()}`);
    console.error(`   Platform: ${process.platform}`);

    // List what's in jscpd-report directory if it exists
    const reportDir = join('.', 'jscpd-report');
    if (existsSync(reportDir)) {
      console.error(`   jscpd-report directory exists, listing contents...`);
      try {
        const files = readdirSync(reportDir);
        console.error(`   Files: ${files.join(', ')}`);
      } catch (e) {
        console.error(`   Could not list directory: ${e.message}`);
      }
    } else {
      console.error(`   jscpd-report directory does not exist!`);
    }

    process.exit(1);
  }

  console.log('   ✅ Report found, parsing...\n');
  return JSON.parse(readFileSync(reportPath, 'utf-8'));
}

/**
 * Create clone signature for comparison
 */
function getCloneSignature(clone) {
  return `${clone.format}:${clone.firstFile.name}:${clone.firstFile.startLoc.line}-${clone.firstFile.endLoc.line}:${clone.secondFile.name}:${clone.secondFile.startLoc.line}-${clone.secondFile.endLoc.line}`;
}

/**
 * Check for new duplications
 */
function checkNewDuplications() {
  console.log('🔍 Checking for new code duplication...\n');

  // Run current scan
  const currentReport = runJscpd();
  const currentClones = currentReport.duplicates || [];

  // Load baseline
  if (!existsSync(BASELINE_FILE)) {
    console.log('📝 No baseline found. Creating baseline from current state...');
    writeFileSync(BASELINE_FILE, JSON.stringify({ duplicates: currentClones }, null, 2));
    console.log(`✅ Baseline saved to ${BASELINE_FILE}`);
    console.log(`   Current duplication: ${currentReport.statistics.total.percentage.toFixed(2)}%`);
    console.log(`   (${currentClones.length} clones)\n`);
    process.exit(0);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
  const baselineClones = baseline.duplicates || [];

  // Build baseline signature set for comparison
  const baselineSignatures = new Set(baselineClones.map(getCloneSignature));

  // Find new clones (not in baseline)
  const newClones = currentClones.filter(clone =>
    !baselineSignatures.has(getCloneSignature(clone))
  );

  // Report results
  if (newClones.length === 0) {
    console.log('✅ No new code duplication detected!');
    console.log(`   Current: ${currentClones.length} clones (${currentReport.statistics.total.percentage.toFixed(2)}%)`);
    console.log(`   Baseline: ${baselineClones.length} clones\n`);
    process.exit(0);
  }

  // New duplications found - FAIL
  console.log(`❌ NEW code duplication detected! (${newClones.length} new clones)\n`);

  for (const clone of newClones) {
    const fileA = clone.firstFile.name;
    const fileB = clone.secondFile.name;
    const linesA = `${clone.firstFile.startLoc.line}-${clone.firstFile.endLoc.line}`;
    const linesB = `${clone.secondFile.startLoc.line}-${clone.secondFile.endLoc.line}`;
    const lines = clone.firstFile.endLoc.line - clone.firstFile.startLoc.line + 1;

    console.log(`  📁 ${fileA}:${linesA}`);
    console.log(`     ↔ ${fileB}:${linesB}`);
    console.log(`     (${lines} lines duplicated)\n`);
  }

  console.log('💡 To fix:');
  console.log('   1. Extract duplicated code into shared utilities');
  console.log('   2. Refactor to eliminate duplication');
  console.log('   3. Or update baseline: node tools/jscpd-update-baseline.js\n');

  process.exit(1);
}

checkNewDuplications();
