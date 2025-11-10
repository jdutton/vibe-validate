#!/usr/bin/env node
/**
 * jscpd-update-baseline.js
 *
 * Update the duplication baseline after intentional refactoring.
 * Use this when you've successfully reduced duplication.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const BASELINE_FILE = '.jscpd-baseline.json';

const JSCPD_CONFIG = [
  '--min-lines', '5',
  '--min-tokens', '50',
  '--reporters', 'json',
  '--format', 'typescript,javascript',
  '--ignore', '**/*.test.ts,**/*.test.js,**/node_modules/**,**/dist/**,**/coverage/**,**/.turbo/**,**/jscpd-report/**,**/*.json,**/*.yaml,**/*.md',
  '--output', './jscpd-report'
].join(' ');

console.log('🔄 Updating duplication baseline...\n');

// Run jscpd
try {
  execSync(`npx jscpd . ${JSCPD_CONFIG}`, { encoding: 'utf-8', stdio: 'pipe' });
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
