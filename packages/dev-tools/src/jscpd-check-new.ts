#!/usr/bin/env tsx
/**
 * jscpd-check-new.js
 *
 * Fails pre-commit only if NEW duplication is introduced.
 * Compares current scan to baseline, ignoring existing technical debt.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { safeExecSync } from '../../utils/dist/safe-exec.js';

const BASELINE_FILE = join('.github', '.jscpd-baseline.json');
const JSCPD_OUTPUT_DIR = './jscpd-report';

/**
 * IMPORTANT: Test files are INTENTIONALLY included in duplication checks.
 *
 * Why we check test code duplication (shift-left principle):
 *
 * 1. **Consistency with SonarQube**: SonarQube checks both src and test code.
 *    Pre-commit checks should catch the same issues to prevent CI surprises.
 *
 * 2. **Early Detection**: Catching duplication in local pre-commit is faster and
 *    cheaper than discovering it in CI after push (shift-left testing).
 *
 * 3. **Test Quality**: Duplicated test code is just as problematic as duplicated
 *    production code. It makes tests harder to maintain, update, and understand.
 *
 * 4. **Baseline Approach**: We baseline existing duplication (technical debt) but
 *    prevent NEW duplication from being introduced going forward.
 */
const JSCPD_ARGS = [
  '.',
  '--min-lines', '5',
  '--min-tokens', '50',
  '--reporters', 'json',
  '--format', 'typescript,javascript',
  '--ignore', '**/node_modules/**,**/dist/**,**/coverage/**,**/.turbo/**,**/jscpd-report/**,**/*.json,**/*.yaml,**/*.md',
  '--output', JSCPD_OUTPUT_DIR
];

/**
 * Run jscpd and return results
 */
function runJscpd() {
  try {
    safeExecSync('npx', ['jscpd', ...JSCPD_ARGS], { encoding: 'utf-8', stdio: 'pipe' });
  } catch (error) {
    // Expected behavior: jscpd exits with non-zero when duplications found,
    // but still generates JSON report which we process below
    // Verify it's the expected failure (not a critical error like ENOENT)
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new Error('jscpd executable not found. Install with: npm install -g jscpd');
    }
    // Otherwise continue - duplications found, but report still generated
  }

  const reportPath = join(JSCPD_OUTPUT_DIR, 'jscpd-report.json');
  if (!existsSync(reportPath)) {
    throw new Error(`jscpd report not found at ${reportPath}`);
  }

  return JSON.parse(readFileSync(reportPath, 'utf-8'));
}

interface CloneLocation {
  name: string;
  startLoc: { line: number };
  endLoc: { line: number };
}

interface Clone {
  format: string;
  firstFile: CloneLocation;
  secondFile: CloneLocation;
}

/**
 * Create clone signature for comparison
 */
function getCloneSignature(clone: Clone): string {
  return `${clone.format}:${clone.firstFile.name}:${clone.firstFile.startLoc.line}-${clone.firstFile.endLoc.line}:${clone.secondFile.name}:${clone.secondFile.startLoc.line}-${clone.secondFile.endLoc.line}`;
}

/**
 * Check for new duplications
 */
function checkNewDuplications() {
  console.log('🔍 Checking for new code duplication...\n');

  // Run current scan
  const currentReport = runJscpd();
  const currentClones = currentReport.duplicates ?? [];

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
  const baselineClones = baseline.duplicates ?? [];

  // Build baseline signature set for comparison
  const baselineSignatures = new Set(baselineClones.map(getCloneSignature));

  // Find new clones (not in baseline)
  const newClones = currentClones.filter((clone: Clone) =>
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
