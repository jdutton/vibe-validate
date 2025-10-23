/**
 * Sample Types for Testing Extraction Quality
 *
 * These types define the structure of test samples used to validate
 * and improve failure extraction accuracy.
 */

import type { FormattedError } from '../src/types.js';

/**
 * Metadata about a test sample
 */
export interface SampleMetadata {
  tool: string;
  toolVersion?: string;
  platform: 'linux' | 'darwin' | 'win32';
  nodeVersion?: string;
  contributor: string;
  contributedDate: string;
  sourceIssue?: string;
  sourcePR?: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'very-hard';
  description: string;
}

/**
 * Input section of a sample
 */
export interface SampleInput {
  raw: string;
  structured?: {
    format: 'ctrf' | 'junit' | 'tap';
    data: string;
  };
}

/**
 * Expected extraction results (ground truth)
 */
export interface SampleExpected {
  detectionConfidence: number;
  detectedTool: string;
  failures: ExpectedFailure[];
}

/**
 * A single expected failure with all details for testing
 */
export interface ExpectedFailure {
  tool: string;
  type: string;
  summary: string;
  message: string;
  location?: {
    file: string;
    line?: number;
    column?: number;
  };
  context?: string;
  stackTrace?: Array<{
    file: string;
    line?: number;
    column?: number;
    function?: string;
  }>;
  relevance: number;

  /**
   * Terse, actionable summary for LLMs/users (1-2 lines max)
   * This is what users actually see in production
   */
  llmSummary: string;
}

/**
 * Quality metrics for a sample (auto-generated)
 */
export interface SampleQuality {
  lastTested?: string;
  fields: Record<string, number>;
  score?: number;
  issues: string[];
  scoreHistory: Array<{
    date: string;
    score: number;
  }>;
}

/**
 * Complete sample structure
 */
export interface Sample {
  metadata: SampleMetadata;
  input: SampleInput;
  expected: SampleExpected;
  quality: SampleQuality;
  improvementHints: string[];
  relatedSamples: string[];
}

/**
 * Actual extraction result for comparison
 */
export interface ActualExtraction {
  detectedTool?: string;
  detectionConfidence: number;
  failures: FormattedError[];
}

/**
 * Quality score for a single sample test
 */
export interface SampleTestResult {
  sample: string;
  passed: boolean;
  score: number;
  fieldScores: Record<string, number>;
  issues: string[];
  actualExtraction: ActualExtraction;
}

/**
 * Aggregated quality report
 */
export interface QualityReport {
  timestamp: string;
  totalSamples: number;
  samplesByTool: Record<string, number>;
  samplesByDifficulty: Record<string, number>;

  // Metrics
  averageScore: number;
  scoreByTool: Record<string, number>;
  scoreByDifficulty: Record<string, number>;

  // Regressions & improvements
  regressions: Array<{
    sample: string;
    previousScore: number;
    currentScore: number;
    delta: number;
  }>;
  improvements: Array<{
    sample: string;
    previousScore: number;
    currentScore: number;
    delta: number;
  }>;

  // Coverage
  coverage: {
    tools: string[];
    categories: string[];
    missingPatterns: string[];
  };

  // Common issues
  commonIssues: Array<{
    issue: string;
    affectedSamples: number;
    examples: string[];
  }>;
}
