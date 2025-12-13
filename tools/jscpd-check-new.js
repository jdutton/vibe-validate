#!/usr/bin/env node
/**
 * jscpd-check-new.js
 *
 * Fails pre-commit only if NEW duplication is introduced.
 * Compares current scan to baseline, ignoring existing technical debt.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const BASELINE_FILE = '.github/.jscpd-baseline.json';

const JSCPD_CONFIG = [
  '--min-lines', '5',
  '--min-tokens', '50',
  '--reporters', 'json',
  '--format', 'typescript,javascript',
  '--ignore', '**/*.test.ts,**/*.test.js,**/node_modules/**,**/dist/**,**/coverage/**,**/.turbo/**,**/jscpd-report/**,**/*.json,**/*.yaml,**/*.md',
  '--output', './jscpd-report'
].join(' ');

/**
 * Run jscpd and return results
 */
function runJscpd() {
  try {
    execSync(`npx jscpd . ${JSCPD_CONFIG}`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    // jscpd exits with error if duplications found, but we still get JSON
  }

  const reportPath = './jscpd-report/jscpd-report.json';
  if (!existsSync(reportPath)) {
    console.error('❌ jscpd report not generated');
    process.exit(1);
  }

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
