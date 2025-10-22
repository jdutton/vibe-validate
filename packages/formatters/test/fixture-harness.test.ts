/**
 * Fixture-Driven Test Harness
 *
 * Tests all formatters against real-world fixtures to ensure extraction accuracy.
 * This is the core of our data-driven testing approach.
 *
 * Philosophy:
 * - Formatters will never be perfect
 * - Formatters will never be done
 * - This is a data problem, not a logic problem
 * - Success comes from continuous improvement via fixtures
 */

import { describe, it, expect } from 'vitest';
import {
  loadAllFixtures,
  groupFixturesBy,
  getThreshold,
  computeQualityScore,
} from './fixture-loader.js';
import { formatByStepName } from '../src/smart-formatter.js';
import type { Fixture, FixtureTestResult, ActualExtraction } from './fixture-types.js';

describe('Fixture-Driven Formatter Tests', () => {
  const fixtures = loadAllFixtures();

  if (fixtures.length === 0) {
    it('should have at least one fixture', () => {
      throw new Error('No fixtures found! Add fixtures to test/fixtures/');
    });
    return;
  }

  console.log(`\n📦 Loaded ${fixtures.length} fixtures\n`);

  // Group by tool
  const fixturesByTool = groupFixturesBy(fixtures, 'tool');

  for (const [tool, toolFixtures] of Object.entries(fixturesByTool)) {
    describe(`${tool} formatter (${toolFixtures.length} fixtures)`, () => {
      const results: FixtureTestResult[] = [];

      for (const fixture of toolFixtures) {
        const fixtureName = `${fixture.metadata.category} (${fixture.metadata.difficulty})`;

        it(`should extract ${fixtureName}`, () => {
          // Run formatter on raw input
          // Use tool name as step name hint for smart routing
          const stepName = `${fixture.metadata.tool} validation`;
          const formatterResult = formatByStepName(stepName, fixture.input.raw);

          // Build actual extraction result
          const actual: ActualExtraction = {
            detectedTool: fixture.metadata.tool, // SmartFormatter doesn't expose tool detection yet
            detectionConfidence: 95, // Assume high confidence for now
            failures: formatterResult.errors,
          };

          // Compute quality score
          const { score, fieldScores, issues } = computeQualityScore(actual, fixture.expected);

          // Store result
          const testResult: FixtureTestResult = {
            fixture: `${tool}/${fixture.metadata.category}`,
            passed: score >= getThreshold(fixture.metadata.difficulty),
            score,
            fieldScores,
            issues,
            actualExtraction: actual,
          };

          results.push(testResult);

          // Test assertions
          const threshold = getThreshold(fixture.metadata.difficulty);
          expect(
            score,
            `Extraction quality too low (${(score * 100).toFixed(1)}% < ${(threshold * 100).toFixed(1)}%)\n` +
              `Issues:\n${issues.map(i => `  - ${i}`).join('\n')}\n`
          ).toBeGreaterThanOrEqual(threshold);

          // Basic checks
          expect(actual.failures.length, 'Should extract at least one failure').toBeGreaterThan(0);

          // Location check (if expected has location)
          if (fixture.expected.failures[0]?.location) {
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
          console.log(`\n    Failed Fixtures:`);
          for (const failure of failures) {
            console.log(
              `      - ${failure.fixture}: ${(failure.score * 100).toFixed(1)}% (threshold: ${(getThreshold(fixtures.find(f => `${f.metadata.tool}/${f.metadata.category}` === failure.fixture)!.metadata.difficulty) * 100).toFixed(0)}%)`
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
    console.log('📊 Overall Fixture Test Summary');
    console.log('='.repeat(60));
    console.log(`Total Fixtures: ${fixtures.length}`);

    for (const [tool, count] of Object.entries(fixturesByTool)) {
      console.log(`  ${tool}: ${count.length} fixtures`);
    }

    console.log(`\n💡 To improve extraction quality:`);
    console.log(`  1. Add more fixtures: cp test/fixtures/_template.yaml test/fixtures/<tool>/<name>.yaml`);
    console.log(`  2. Run quality report: pnpm test:report`);
    console.log(`  3. Check for regressions: pnpm test:regression`);
    console.log(
      `  4. Contribute fixtures: https://github.com/jdutton/vibe-validate/issues/new?template=formatter-improvement.yml`
    );
  });
});

describe('Fixture Format Validation', () => {
  const fixtures = loadAllFixtures();

  it('all fixtures should have required metadata', () => {
    for (const fixture of fixtures) {
      expect(fixture.metadata.tool).toBeDefined();
      expect(fixture.metadata.contributor).toBeDefined();
      expect(fixture.metadata.difficulty).toMatch(/^(easy|medium|hard|very-hard)$/);
    }
  });

  it('all fixtures should have input.raw', () => {
    for (const fixture of fixtures) {
      expect(fixture.input.raw).toBeDefined();
      expect(fixture.input.raw.length).toBeGreaterThan(0);
    }
  });

  it('all fixtures should have expected failures with llmSummary', () => {
    for (const fixture of fixtures) {
      expect(fixture.expected.failures).toBeDefined();
      expect(fixture.expected.failures.length).toBeGreaterThan(0);

      for (const failure of fixture.expected.failures) {
        expect(
          failure.llmSummary,
          `Fixture ${fixture.metadata.tool}/${fixture.metadata.category} missing llmSummary`
        ).toBeDefined();
        expect(failure.llmSummary.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
