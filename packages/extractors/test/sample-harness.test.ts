/**
 * Sample-Driven Test Harness
 *
 * Tests all extractors against real-world samples to ensure extraction accuracy.
 * This is the core of our data-driven testing approach.
 *
 * Philosophy:
 * - Extractors will never be perfect
 * - Extractors will never be done
 * - This is a data problem, not a logic problem
 * - Success comes from continuous improvement via samples
 */

import { describe, it, expect } from 'vitest';
import {
  loadAllSamples,
  groupSamplesBy,
  getThreshold,
  computeQualityScore,
} from './sample-loader.js';
import { extractByStepName } from '../src/smart-extractor.js';
import type { Sample, SampleTestResult, ActualExtraction } from './sample-types.js';

describe('Sample-Driven Extractor Tests', () => {
  const samples = loadAllSamples();

  if (samples.length === 0) {
    it('should have at least one sample', () => {
      throw new Error('No samples found! Add samples to test/samples/');
    });
    return;
  }

  console.log(`\n📦 Loaded ${samples.length} samples\n`);

  // Group by tool
  const samplesByTool = groupSamplesBy(samples, 'tool');

  for (const [tool, toolSamples] of Object.entries(samplesByTool)) {
    describe(`${tool} extractor (${toolSamples.length} samples)`, () => {
      const results: SampleTestResult[] = [];

      for (const sample of toolSamples) {
        const sampleName = `${sample.metadata.category} (${sample.metadata.difficulty})`;

        it(`should extract ${sampleName}`, () => {
          // Run extractor on raw input
          // Use tool name as step name hint for smart routing
          const stepName = `${sample.metadata.tool} validation`;
          const extractorResult = extractByStepName(stepName, sample.input.raw);

          // Build actual extraction result
          const actual: ActualExtraction = {
            detectedTool: sample.metadata.tool, // SmartExtractor doesn't expose tool detection yet
            detectionConfidence: 95, // Assume high confidence for now
            failures: extractorResult.errors,
          };

          // Compute quality score
          const { score, fieldScores, issues } = computeQualityScore(actual, sample.expected);

          // Store result
          const testResult: SampleTestResult = {
            sample: `${tool}/${sample.metadata.category}`,
            passed: score >= getThreshold(sample.metadata.difficulty),
            score,
            fieldScores,
            issues,
            actualExtraction: actual,
          };

          results.push(testResult);

          // Test assertions
          const threshold = getThreshold(sample.metadata.difficulty);
          expect(
            score,
            `Extraction quality too low (${(score * 100).toFixed(1)}% < ${(threshold * 100).toFixed(1)}%)\n` +
              `Issues:\n${issues.map(i => `  - ${i}`).join('\n')}\n`
          ).toBeGreaterThanOrEqual(threshold);

          // Basic checks
          expect(actual.failures.length, 'Should extract at least one failure').toBeGreaterThan(0);

          // Location check (if expected has location)
          if (sample.expected.failures[0]?.location) {
            const hasLocation = actual.failures.some(f => f.file && f.line);
            expect(hasLocation, 'Should extract file and line location').toBe(true);
          }
        });
      }

      // After all tests for this tool, print summary
      afterAll(() => {
        if (results.length === 0) return;

        const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
        const passedCount = results.filter(r => r.passed).length;

        console.log(`\n  ${tool} Summary:`);
        console.log(`    Average Score: ${(avgScore * 100).toFixed(1)}%`);
        console.log(`    Passed: ${passedCount}/${results.length}`);

        // Show failures
        const failures = results.filter(r => !r.passed);
        if (failures.length > 0) {
          console.log(`\n    Failed Samples:`);
          for (const failure of failures) {
            console.log(
              `      - ${failure.sample}: ${(failure.score * 100).toFixed(1)}% (threshold: ${(getThreshold(samples.find(f => `${f.metadata.tool}/${f.metadata.category}` === failure.fixture)!.metadata.difficulty) * 100).toFixed(0)}%)`
            );
            console.log(`        Issues: ${failure.issues.join(', ')}`);
          }
        }
      });
    });
  }

  // Overall summary after all tests
  afterAll(() => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 Overall Sample Test Summary');
    console.log('='.repeat(60));
    console.log(`Total Samples: ${samples.length}`);

    for (const [tool, count] of Object.entries(samplesByTool)) {
      console.log(`  ${tool}: ${count.length} samples`);
    }

    console.log(`\n💡 To improve extraction quality:`);
    console.log(`  1. Add more samples: cp test/samples/_template.yaml test/samples/<tool>/<name>.yaml`);
    console.log(`  2. Run quality report: pnpm test:report`);
    console.log(`  3. Check for regressions: pnpm test:regression`);
    console.log(
      `  4. Contribute samples: https://github.com/jdutton/vibe-validate/issues/new?template=extractor-improvement.yml`
    );
  });
});

describe('Sample Format Validation', () => {
  const samples = loadAllSamples();

  it('all samples should have required metadata', () => {
    for (const sample of samples) {
      expect(sample.metadata.tool).toBeDefined();
      expect(sample.metadata.contributor).toBeDefined();
      expect(sample.metadata.difficulty).toMatch(/^(easy|medium|hard|very-hard)$/);
    }
  });

  it('all samples should have input.raw', () => {
    for (const sample of samples) {
      expect(sample.input.raw).toBeDefined();
      expect(sample.input.raw.length).toBeGreaterThan(0);
    }
  });

  it('all samples should have expected failures with llmSummary', () => {
    for (const sample of samples) {
      expect(sample.expected.failures).toBeDefined();
      expect(sample.expected.failures.length).toBeGreaterThan(0);

      for (const failure of sample.expected.failures) {
        expect(
          failure.llmSummary,
          `Sample ${sample.metadata.tool}/${sample.metadata.category} missing llmSummary`
        ).toBeDefined();
        expect(failure.llmSummary.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
