/**
 * Fixture Types for Testing Extraction Quality
 *
 * These types define the structure of test fixtures used to validate
 * and improve failure extraction accuracy.
 */

import type { FormattedError } from '../src/types.js';

/**
 * Metadata about a test fixture
 */
export interface FixtureMetadata {
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
 * Input section of a fixture
 */
export interface FixtureInput {
  raw: string;
  structured?: {
    format: 'ctrf' | 'junit' | 'tap';
    data: string;
  };
}

/**
 * Expected extraction results (ground truth)
 */
export interface FixtureExpected {
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
 * Quality metrics for a fixture (auto-generated)
 */
export interface FixtureQuality {
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
 * Complete fixture structure
 */
export interface Fixture {
  metadata: FixtureMetadata;
  input: FixtureInput;
  expected: FixtureExpected;
  quality: FixtureQuality;
  improvementHints: string[];
  relatedFixtures: string[];
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
 * Quality score for a single fixture test
 */
export interface FixtureTestResult {
  fixture: string;
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
  totalFixtures: number;
  fixturesByTool: Record<string, number>;
  fixturesByDifficulty: Record<string, number>;

  // Metrics
  averageScore: number;
  scoreByTool: Record<string, number>;
  scoreByDifficulty: Record<string, number>;

  // Regressions & improvements
  regressions: Array<{
    fixture: string;
    previousScore: number;
    currentScore: number;
    delta: number;
  }>;
  improvements: Array<{
    fixture: string;
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
    affectedFixtures: number;
    examples: string[];
  }>;
}
