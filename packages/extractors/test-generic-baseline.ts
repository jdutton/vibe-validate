#!/usr/bin/env tsx
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { extractGenericErrors } from './src/generic-extractor.js';

const samplesDir = './test/samples';

// Get all sample directories
const categories = readdirSync(samplesDir).filter(f => !f.startsWith('_') && !f.includes('.'));

console.log('Testing Generic Extractor Against All Samples\n');
console.log('='.repeat(80));

for (const category of categories) {
  const categoryPath = join(samplesDir, category);
  const files = readdirSync(categoryPath);

  console.log(`\n📁 ${category.toUpperCase()}`);
  console.log('-'.repeat(80));

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.txt')) continue;

    const filePath = join(categoryPath, file);
    let rawOutput: string;

    if (file.endsWith('.yaml')) {
      const content = readFileSync(filePath, 'utf8');
      const parsed = parseYaml(content);
      rawOutput = parsed.input?.raw || '';
    } else {
      rawOutput = readFileSync(filePath, 'utf8');
    }

    const result = extractGenericErrors(rawOutput, category);

    console.log(`\n  📄 ${file}`);
    console.log(`     Summary: ${result.summary}`);
    console.log(`     Errors found: ${result.errors.length}`);
    console.log(`     Total count: ${result.totalCount}`);
    console.log(`     Clean output length: ${result.errorSummary.length} chars`);
    console.log(`     First 300 chars of clean output:`);
    const preview = result.errorSummary.substring(0, 300).replaceAll('\n', '\n     ');
    console.log(`     ${preview}${result.errorSummary.length > 300 ? '...' : ''}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('\n📊 Analysis: Look for patterns in what gets through vs. what gets filtered');
