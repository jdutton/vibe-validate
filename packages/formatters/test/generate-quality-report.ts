#!/usr/bin/env node
/**
 * Quality Report Generator
 *
 * Runs all fixture tests and generates a comprehensive quality report.
 * Tracks metrics over time and detects regressions.
 *
 * Usage:
 *   pnpm test:report           # Generate fresh report
 *   pnpm test:regression       # Check for regressions (exit 1 if found)
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadAllFixtures,
  groupFixturesBy,
  getThreshold,
  computeQualityScore,
} from './fixture-loader.js';
import { formatByStepName } from '../src/smart-formatter.js';
import type { Fixture, FixtureTestResult, ActualExtraction } from './fixture-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface QualityMetrics {
  timestamp: string;
  totalFixtures: number;
  overallScore: number;
  byTool: Record<
    string,
    {
      count: number;
      avgScore: number;
      passed: number;
      failed: number;
      fixtures: Array<{
        name: string;
        score: number;
        passed: boolean;
      }>;
    }
  >;
  byDifficulty: Record<
    string,
    {
      count: number;
      avgScore: number;
      passed: number;
      failed: number;
    }
  >;
  failures: Array<{
    fixture: string;
    score: number;
    threshold: number;
    issues: string[];
  }>;
  improvements?: Array<{
    fixture: string;
    previousScore: number;
    currentScore: number;
    improvement: number;
  }>;
  regressions?: Array<{
    fixture: string;
    previousScore: number;
    currentScore: number;
    regression: number;
  }>;
}

function generateQualityReport(): QualityMetrics {
  console.log('🔍 Loading fixtures...');
  const fixtures = loadAllFixtures();

  if (fixtures.length === 0) {
    throw new Error('No fixtures found! Add fixtures to test/fixtures/');
  }

  console.log(`📦 Loaded ${fixtures.length} fixtures`);
  console.log('⚙️  Running formatters...\n');

  const results: FixtureTestResult[] = [];

  // Run formatter on each fixture
  for (const fixture of fixtures) {
    const stepName = `${fixture.metadata.tool} validation`;
    const formatterResult = formatByStepName(stepName, fixture.input.raw);

    const actual: ActualExtraction = {
      detectedTool: fixture.metadata.tool,
      detectionConfidence: 95,
      failures: formatterResult.errors,
    };

    const { score, fieldScores, issues } = computeQualityScore(actual, fixture.expected);

    const testResult: FixtureTestResult = {
      fixture: `${fixture.metadata.tool}/${fixture.metadata.category}`,
      passed: score >= getThreshold(fixture.metadata.difficulty),
      score,
      fieldScores,
      issues,
      actualExtraction: actual,
    };

    results.push(testResult);

    // Show progress
    const status = testResult.passed ? '✅' : '❌';
    console.log(
      `${status} ${testResult.fixture}: ${(score * 100).toFixed(1)}% (${fixture.metadata.difficulty})`
    );
  }

  console.log('\n📊 Computing metrics...');

  // Calculate overall metrics
  const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  // Group by tool
  const fixturesByTool = groupFixturesBy(fixtures, 'tool');
  const byTool: QualityMetrics['byTool'] = {};

  for (const [tool, toolFixtures] of Object.entries(fixturesByTool)) {
    const toolResults = results.filter(r => r.fixture.startsWith(`${tool}/`));
    const avgScore = toolResults.reduce((sum, r) => sum + r.score, 0) / toolResults.length;
    const passed = toolResults.filter(r => r.passed).length;
    const failed = toolResults.length - passed;

    byTool[tool] = {
      count: toolResults.length,
      avgScore,
      passed,
      failed,
      fixtures: toolResults.map(r => ({
        name: r.fixture.replace(`${tool}/`, ''),
        score: r.score,
        passed: r.passed,
      })),
    };
  }

  // Group by difficulty
  const fixturesByDifficulty = groupFixturesBy(fixtures, 'difficulty');
  const byDifficulty: QualityMetrics['byDifficulty'] = {};

  for (const [difficulty, difficultyFixtures] of Object.entries(fixturesByDifficulty)) {
    const difficultyResults = results.filter(r => {
      const fixture = fixtures.find(f => `${f.metadata.tool}/${f.metadata.category}` === r.fixture);
      return fixture?.metadata.difficulty === difficulty;
    });

    const avgScore =
      difficultyResults.reduce((sum, r) => sum + r.score, 0) / difficultyResults.length;
    const passed = difficultyResults.filter(r => r.passed).length;
    const failed = difficultyResults.length - passed;

    byDifficulty[difficulty] = {
      count: difficultyResults.length,
      avgScore,
      passed,
      failed,
    };
  }

  // Collect failures
  const failures = results
    .filter(r => !r.passed)
    .map(r => {
      const fixture = fixtures.find(f => `${f.metadata.tool}/${f.metadata.category}` === r.fixture)!;
      return {
        fixture: r.fixture,
        score: r.score,
        threshold: getThreshold(fixture.metadata.difficulty),
        issues: r.issues,
      };
    });

  const metrics: QualityMetrics = {
    timestamp: new Date().toISOString(),
    totalFixtures: fixtures.length,
    overallScore,
    byTool,
    byDifficulty,
    failures,
  };

  return metrics;
}

function detectRegressions(current: QualityMetrics, previous: QualityMetrics): void {
  console.log('\n🔍 Comparing with previous report...');

  current.improvements = [];
  current.regressions = [];

  // Compare each tool's fixtures
  for (const [tool, toolStats] of Object.entries(current.byTool)) {
    const prevToolStats = previous.byTool[tool];
    if (!prevToolStats) continue;

    for (const fixture of toolStats.fixtures) {
      const prevFixture = prevToolStats.fixtures.find(f => f.name === fixture.name);
      if (!prevFixture) continue;

      const scoreDiff = fixture.score - prevFixture.score;
      const fullName = `${tool}/${fixture.name}`;

      if (scoreDiff > 0.05) {
        // Improved by >5%
        current.improvements!.push({
          fixture: fullName,
          previousScore: prevFixture.score,
          currentScore: fixture.score,
          improvement: scoreDiff,
        });
      } else if (scoreDiff < -0.05) {
        // Regressed by >5%
        current.regressions!.push({
          fixture: fullName,
          previousScore: prevFixture.score,
          currentScore: fixture.score,
          regression: Math.abs(scoreDiff),
        });
      }
    }
  }

  console.log(`  ${current.improvements.length} improvements`);
  console.log(`  ${current.regressions.length} regressions`);
}

function displaySummary(metrics: QualityMetrics, checkOnly: boolean = false) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Quality Report Summary');
  console.log('='.repeat(60));
  console.log(`Generated: ${new Date(metrics.timestamp).toLocaleString()}`);
  console.log(`Total Fixtures: ${metrics.totalFixtures}`);
  console.log(`Overall Score: ${(metrics.overallScore * 100).toFixed(1)}%`);

  console.log('\nBy Tool:');
  for (const [tool, stats] of Object.entries(metrics.byTool)) {
    const emoji = stats.failed === 0 ? '✅' : stats.passed > stats.failed ? '⚠️ ' : '❌';
    console.log(`  ${emoji} ${tool}: ${(stats.avgScore * 100).toFixed(1)}% (${stats.passed}/${stats.count} passed)`);
  }

  console.log('\nBy Difficulty:');
  for (const [difficulty, stats] of Object.entries(metrics.byDifficulty)) {
    console.log(`  ${difficulty}: ${(stats.avgScore * 100).toFixed(1)}% (${stats.passed}/${stats.count} passed)`);
  }

  if (metrics.failures.length > 0) {
    console.log('\n❌ Failed Fixtures:');
    for (const failure of metrics.failures) {
      console.log(
        `  ${failure.fixture}: ${(failure.score * 100).toFixed(1)}% (need ${(failure.threshold * 100).toFixed(0)}%)`
      );
      console.log(`    Issues: ${failure.issues.slice(0, 3).join(', ')}`);
    }
  }

  if (metrics.regressions && metrics.regressions.length > 0) {
    console.log('\n⚠️  Regressions Detected:');
    for (const reg of metrics.regressions) {
      console.log(
        `  ${reg.fixture}: ${(reg.previousScore * 100).toFixed(1)}% → ${(reg.currentScore * 100).toFixed(1)}% (-${(reg.regression * 100).toFixed(1)}%)`
      );
    }
  }

  if (metrics.improvements && metrics.improvements.length > 0) {
    console.log('\n✅ Improvements:');
    for (const imp of metrics.improvements) {
      console.log(
        `  ${imp.fixture}: ${(imp.previousScore * 100).toFixed(1)}% → ${(imp.currentScore * 100).toFixed(1)}% (+${(imp.improvement * 100).toFixed(1)}%)`
      );
    }
  }

  if (!checkOnly) {
    console.log('\n📁 Full report: test/quality-report.json');
  }
  console.log('='.repeat(60));
}

// Main execution
const checkOnly = process.argv.includes('--check');

try {
  const metrics = generateQualityReport();

  // Load previous report for comparison
  const reportPath = join(__dirname, 'quality-report.json');
  if (existsSync(reportPath)) {
    const previousMetrics = JSON.parse(readFileSync(reportPath, 'utf-8'));
    detectRegressions(metrics, previousMetrics);
  }

  // Display summary
  displaySummary(metrics, checkOnly);

  // Write report (unless --check flag)
  if (!checkOnly) {
    writeFileSync(reportPath, JSON.stringify(metrics, null, 2));
    console.log('\n✅ Report saved!');
  }

  // Exit with error if regressions found in check mode
  if (checkOnly && metrics.regressions && metrics.regressions.length > 0) {
    console.error('\n❌ Regressions detected! Fix before committing.');
    process.exit(1);
  }

  process.exit(0);
} catch (error) {
  console.error('\n❌ Error generating report:', error);
  process.exit(1);
}
