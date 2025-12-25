import { readFileSync } from 'node:fs';
import { extractJestErrors } from '../extractors/src/jest-extractor.ts';

const jestOutput = readFileSync('/tmp/jest-comprehensive-output.txt', 'utf8');
console.log('=== Jest Output Length:', jestOutput.length, 'bytes ===\n');

const result = extractJestErrors(jestOutput);

console.log('=== Extraction Result ===');
console.log('Summary:', result.summary);
console.log('Total Count:', result.totalCount);
console.log('Errors Extracted:', result.errors.length);
console.log('\n=== Extracted Errors ===');
result.errors.forEach((err, idx) => {
  console.log(`\n${idx + 1}. ${err.file}:${err.line}:${err.column}`);
  console.log(`   ${err.message}`);
});

console.log('\n=== Clean Output ===');
console.log(result.cleanOutput);

console.log('\n=== Quality Check ===');
console.log(`Expected failures: 14`);
console.log(`Extracted failures: ${result.totalCount}`);
console.log(`Match rate: ${Math.round((result.totalCount / 14) * 100)}%`);

if (result.totalCount >= 14) {
  console.log('✅ PASS: Extracted correct number of failures (or more)');
  process.exit(0);
} else {
  console.log('⚠️  WARNING: Extraction count below expected');
  console.log(`Missing ${14 - result.totalCount} failures`);
  process.exit(1);
}
