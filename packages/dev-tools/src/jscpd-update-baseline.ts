#!/usr/bin/env tsx
/**
 * jscpd-update-baseline.js
 *
 * Update the duplication baseline after intentional refactoring.
 * Use this when you've successfully reduced duplication.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { safeExecSync } from '../../utils/dist/safe-exec.js';

const BASELINE_FILE = '.github/.jscpd-baseline.json';

/**
 * IMPORTANT: Test files are INTENTIONALLY included in duplication checks.
 * This matches the configuration in jscpd-check-new.ts.
 * See that file for detailed explanation of why we check test code duplication.
 */
const JSCPD_ARGS = [
  '.',
  '--min-lines', '5',
  '--min-tokens', '50',
  '--reporters', 'json',
  '--format', 'typescript,javascript',
  '--ignore', '**/node_modules/**,**/dist/**,**/coverage/**,**/.turbo/**,**/jscpd-report/**,**/*.json,**/*.yaml,**/*.md',
  '--output', './jscpd-report'
];

console.log('🔄 Updating duplication baseline...\n');

// Run jscpd
try {
  safeExecSync('npx', ['jscpd', ...JSCPD_ARGS], { encoding: 'utf-8', stdio: 'pipe' });
} catch {
  // Expected - jscpd exits with error if duplications found
}

// Read current report
const reportPath = './jscpd-report/jscpd-report.json';
const currentReport = JSON.parse(readFileSync(reportPath, 'utf-8'));
const currentClones = currentReport.duplicates || [];

// Save as new baseline
writeFileSync(BASELINE_FILE, JSON.stringify({ duplicates: currentClones }, null, 2));

console.log('✅ Baseline updated!');
console.log(`   Clones: ${currentClones.length}`);
console.log(`   Duplication: ${currentReport.statistics.total.percentage.toFixed(2)}%`);
console.log(`   Lines: ${currentReport.statistics.total.duplicatedLines} / ${currentReport.statistics.total.totalLines}\n`);

console.log(`📝 Baseline saved to: ${BASELINE_FILE}`);
console.log(`   Commit this file to version control.\n`);
