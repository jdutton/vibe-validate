#!/usr/bin/env node
/**
 * Quality Report Generator
 *
 * Runs all sample tests and generates a comprehensive quality report.
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
  loadAllSamples,
  groupSamplesBy,
  getThreshold,
  computeQualityScore,
} from './sample-loader.js';
import { autoDetectAndExtract } from '../src/smart-extractor.js';
import type { SampleTestResult, ActualExtraction } from './sample-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface QualityMetrics {
  timestamp: string;
  totalSamples: number;
  overallScore: number;
  byTool: Record<
    string,
    {
      count: number;
      avgScore: number;
      passed: number;
      failed: number;
      samples: Array<{
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
    sample: string;
    score: number;
    threshold: number;
    issues: string[];
  }>;
  improvements?: Array<{
    sample: string;
    previousScore: number;
    currentScore: number;
    improvement: number;
  }>;
  regressions?: Array<{
    sample: string;
    previousScore: number;
    currentScore: number;
    regression: number;
  }>;
}

function generateQualityReport(): QualityMetrics {
  console.log('🔍 Loading samples...');
  const samples = loadAllSamples();

  if (samples.length === 0) {
    throw new Error('No samples found! Add samples to test/samples/');
  }

  console.log(`📦 Loaded ${samples.length} samples`);
  console.log('⚙️  Running extractors...\n');

  const results: SampleTestResult[] = [];

  // Run extractor on each sample
  for (const sample of samples) {
    const stepName = `${sample.metadata.tool} validation`;
    const extractorResult = autoDetectAndExtract(stepName, sample.input.raw);

    const actual: ActualExtraction = {
      detectedTool: sample.metadata.tool,
      detectionConfidence: 95,
      failures: extractorResult.errors,
    };

    const { score, fieldScores, issues } = computeQualityScore(actual, sample.expected);

    const testResult: SampleTestResult = {
      sample: `${sample.metadata.tool}/${sample.metadata.category}`,
      passed: score >= getThreshold(sample.metadata.difficulty),
      score,
      fieldScores,
      issues,
      actualExtraction: actual,
    };

    results.push(testResult);

    // Show progress
    const status = testResult.passed ? '✅' : '❌';
    console.log(
      `${status} ${testResult.sample}: ${(score * 100).toFixed(1)}% (${sample.metadata.difficulty})`
    );
  }

  console.log('\n📊 Computing metrics...');

  // Calculate overall metrics
  const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  // Group by tool
  const samplesByTool = groupSamplesBy(samples, 'tool');
  const byTool: QualityMetrics['byTool'] = {};

  for (const tool of Object.keys(samplesByTool)) {
    const toolResults = results.filter(r => r.sample.startsWith(`${tool}/`));
    const avgScore = toolResults.reduce((sum, r) => sum + r.score, 0) / toolResults.length;
    const passed = toolResults.filter(r => r.passed).length;
    const failed = toolResults.length - passed;

    byTool[tool] = {
      count: toolResults.length,
      avgScore,
      passed,
      failed,
      samples: toolResults.map(r => ({
        name: r.sample.replace(`${tool}/`, ''),
        score: r.score,
        passed: r.passed,
      })),
    };
  }

  // Group by difficulty
  const samplesByDifficulty = groupSamplesBy(samples, 'difficulty');
  const byDifficulty: QualityMetrics['byDifficulty'] = {};

  for (const difficulty of Object.keys(samplesByDifficulty)) {
    const difficultyResults = results.filter(r => {
      const sample = samples.find(f => `${f.metadata.tool}/${f.metadata.category}` === r.sample);
      return sample?.metadata.difficulty === difficulty;
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
      const sampleData = samples.find(f => `${f.metadata.tool}/${f.metadata.category}` === r.sample)!;
      return {
        sample: r.sample,
        score: r.score,
        threshold: getThreshold(sampleData.metadata.difficulty),
        issues: r.issues,
      };
    });

  const metrics: QualityMetrics = {
    timestamp: new Date().toISOString(),
    totalSamples: samples.length,
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

  // Compare each tool's samples
  for (const [tool, toolStats] of Object.entries(current.byTool)) {
    const prevToolStats = previous.byTool[tool];
    if (!prevToolStats) continue;

    for (const sample of toolStats.samples) {
      const prevSample = prevToolStats.samples.find(f => f.name === sample.name);
      if (!prevSample) continue;

      const scoreDiff = sample.score - prevSample.score;
      const fullName = `${tool}/${sample.name}`;

      if (scoreDiff > 0.05) {
        // Improved by >5%
        current.improvements!.push({
          sample: fullName,
          previousScore: prevSample.score,
          currentScore: sample.score,
          improvement: scoreDiff,
        });
      } else if (scoreDiff < -0.05) {
        // Regressed by >5%
        current.regressions!.push({
          sample: fullName,
          previousScore: prevSample.score,
          currentScore: sample.score,
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
  console.log(`Total Samples: ${metrics.totalSamples}`);
  console.log(`Overall Score: ${(metrics.overallScore * 100).toFixed(1)}%`);

  console.log('\nBy Tool:');
  for (const [tool, stats] of Object.entries(metrics.byTool)) {
    let emoji: string;
    if (stats.failed === 0) {
      emoji = '✅';
    } else if (stats.passed > stats.failed) {
      emoji = '⚠️ ';
    } else {
      emoji = '❌';
    }
    console.log(`  ${emoji} ${tool}: ${(stats.avgScore * 100).toFixed(1)}% (${stats.passed}/${stats.count} passed)`);
  }

  console.log('\nBy Difficulty:');
  for (const [difficulty, stats] of Object.entries(metrics.byDifficulty)) {
    console.log(`  ${difficulty}: ${(stats.avgScore * 100).toFixed(1)}% (${stats.passed}/${stats.count} passed)`);
  }

  if (metrics.failures.length > 0) {
    console.log('\n❌ Failed Samples:');
    for (const failure of metrics.failures) {
      console.log(
        `  ${failure.sample}: ${(failure.score * 100).toFixed(1)}% (need ${(failure.threshold * 100).toFixed(0)}%)`
      );
      console.log(`    Issues: ${failure.issues.slice(0, 3).join(', ')}`);
    }
  }

  if (metrics.regressions && metrics.regressions.length > 0) {
    console.log('\n⚠️  Regressions Detected:');
    for (const reg of metrics.regressions) {
      console.log(
        `  ${reg.sample}: ${(reg.previousScore * 100).toFixed(1)}% → ${(reg.currentScore * 100).toFixed(1)}% (-${(reg.regression * 100).toFixed(1)}%)`
      );
    }
  }

  if (metrics.improvements && metrics.improvements.length > 0) {
    console.log('\n✅ Improvements:');
    for (const imp of metrics.improvements) {
      console.log(
        `  ${imp.sample}: ${(imp.previousScore * 100).toFixed(1)}% → ${(imp.currentScore * 100).toFixed(1)}% (+${(imp.improvement * 100).toFixed(1)}%)`
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
