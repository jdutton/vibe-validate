/**
 * Sample Loader - Load test samples from YAML files
 *
 * Loads samples from the test/samples/ directory and provides
 * utilities for working with them.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Sample, SampleTestResult, QualityReport } from './sample-types.js';

const SAMPLES_DIR = fileURLToPath(new URL('./samples/', import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL('./samples/sample-schema.json', import.meta.url));

// Initialize JSON Schema validator
const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);

// Load schema
const schemaContent = readFileSync(SCHEMA_PATH, 'utf8');
const schema = JSON.parse(schemaContent);
const validateSchema = ajv.compile(schema);

/**
 * Load a single sample from a YAML file
 */
export function loadSample(filePath: string): Sample {
  const content = readFileSync(filePath, 'utf8');
  const sample = parseYaml(content) as Sample;

  // Validate against JSON Schema
  const valid = validateSchema(sample);
  if (!valid) {
    const errors = validateSchema.errors
      ?.map((err) => `  - ${err.instancePath || '/'}: ${err.message}`)
      .join('\n');
    throw new Error(
      `Sample ${filePath} failed schema validation:\n${errors}\n\nPlease fix the sample or update the schema at ${SCHEMA_PATH}`
    );
  }

  // Validate required fields (additional checks beyond schema)
  if (!sample.metadata?.tool) {
    throw new Error(`Sample ${filePath} missing metadata.tool`);
  }
  if (!sample.input?.raw) {
    throw new Error(`Sample ${filePath} missing input.raw`);
  }
  if (!sample.expected?.failures || sample.expected.failures.length === 0) {
    throw new Error(`Sample ${filePath} missing expected.failures`);
  }

  // Ensure each failure has llmSummary
  for (const failure of sample.expected.failures) {
    if (!failure.llmSummary) {
      throw new Error(
        `Sample ${filePath} failure missing llmSummary (CRITICAL for user output)`
      );
    }
  }

  return sample;
}

/**
 * Load all samples from a directory recursively
 */
export function loadAllSamples(dir: string = SAMPLES_DIR): Sample[] {
  const samples: Sample[] = [];

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir);

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip hidden directories and non-sample dirs
        if (!entry.startsWith('.') && !entry.startsWith('_')) {
          walk(fullPath);
        }
      } else if (entry.endsWith('.yaml') && !entry.startsWith('_')) {
        try {
          samples.push(loadSample(fullPath));
        } catch (error) {
          console.error(`Failed to load sample ${fullPath}:`, error);
          // Don't fail the whole test run - collect what we can
        }
      }
    }
  }

  walk(dir);
  return samples;
}

/**
 * Group samples by a property
 */
export function groupSamplesBy<K extends keyof Sample['metadata']>(
  samples: Sample[],
  key: K
): Record<string, Sample[]> {
  const grouped: Record<string, Sample[]> = {};

  for (const sample of samples) {
    const value = String(sample.metadata[key]);
    if (!grouped[value]) {
      grouped[value] = [];
    }
    grouped[value].push(sample);
  }

  return grouped;
}

/**
 * Get difficulty threshold for passing
 */
export function getThreshold(difficulty: Sample['metadata']['difficulty']): number {
  switch (difficulty) {
    case 'easy':
      return 0.90;
    case 'medium':
      return 0.75;
    case 'hard':
      return 0.60;
    case 'very-hard':
      return 0.40;
    default:
      return 0.70;
  }
}

/**
 * Check if individual failures match between actual and expected
 */
function checkFailureMatches(
  actual: SampleTestResult['actualExtraction'],
  expected: Sample['expected']
): { locationMatches: number; messageMatches: number; minLength: number } {
  const minLength = Math.min(actual.failures.length, expected.failures.length);
  let locationMatches = 0;
  let messageMatches = 0;

  for (let i = 0; i < minLength; i++) {
    const actualFailure = actual.failures[i];
    const expectedFailure = expected.failures[i];

    // Check location
    if (actualFailure.file && expectedFailure.location) {
      const fileMatch = actualFailure.file.includes(expectedFailure.location.file);
      const lineMatch =
        !expectedFailure.location.line || actualFailure.line === expectedFailure.location.line;

      if (fileMatch && lineMatch) {
        locationMatches++;
      }
    }

    // Check message
    if (actualFailure.message && expectedFailure.message) {
      const messageMatch = actualFailure.message.includes(expectedFailure.message.slice(0, 50));
      if (messageMatch) {
        messageMatches++;
      }
    }
  }

  return { locationMatches, messageMatches, minLength };
}

/**
 * Compute quality score comparing actual vs expected
 */
export function computeQualityScore(
  actual: SampleTestResult['actualExtraction'],
  expected: Sample['expected']
): {
  score: number;
  fieldScores: Record<string, number>;
  issues: string[];
} {
  const fieldScores: Record<string, number> = {};
  const issues: string[] = [];

  // Check tool detection
  if (actual.detectedTool === expected.detectedTool) {
    fieldScores.tool = 1.0;
  } else {
    fieldScores.tool = 0.0;
    issues.push(
      `Tool mismatch: detected '${actual.detectedTool}' but expected '${expected.detectedTool}'`
    );
  }

  // Check detection confidence
  if (actual.detectionConfidence >= expected.detectionConfidence * 0.9) {
    fieldScores.confidence = 1.0;
  } else {
    fieldScores.confidence = actual.detectionConfidence / expected.detectionConfidence;
    issues.push(
      `Low detection confidence: ${actual.detectionConfidence} < ${expected.detectionConfidence}`
    );
  }

  // Check failure count
  if (actual.failures.length === expected.failures.length) {
    fieldScores.count = 1.0;
  } else {
    fieldScores.count = Math.min(
      actual.failures.length / expected.failures.length,
      expected.failures.length / actual.failures.length
    );
    issues.push(
      `Failure count mismatch: extracted ${actual.failures.length} but expected ${expected.failures.length}`
    );
  }

  // Check individual failures
  const { locationMatches, messageMatches, minLength } = checkFailureMatches(actual, expected);

  fieldScores.location = minLength > 0 ? locationMatches / minLength : 0;
  fieldScores.message = minLength > 0 ? messageMatches / minLength : 0;

  if (fieldScores.location < 0.8) {
    issues.push(`Low location accuracy: ${(fieldScores.location * 100).toFixed(0)}%`);
  }
  if (fieldScores.message < 0.8) {
    issues.push(`Low message accuracy: ${(fieldScores.message * 100).toFixed(0)}%`);
  }

  // Weighted average
  const weights = {
    tool: 0.3,
    confidence: 0.1,
    count: 0.1,
    location: 0.25,
    message: 0.25,
  };

  const score =
    fieldScores.tool * weights.tool +
    fieldScores.confidence * weights.confidence +
    fieldScores.count * weights.count +
    fieldScores.location * weights.location +
    fieldScores.message * weights.message;

  return { score, fieldScores, issues };
}

/**
 * Load previous quality report if it exists
 */
export function loadPreviousReport(): QualityReport | null {
  try {
    const reportPath = join(SAMPLES_DIR, '../quality-report.json');
    const content = readFileSync(reportPath, 'utf8');
    return JSON.parse(content) as QualityReport;
  } catch {
    return null;
  }
}

/**
 * Get sample name relative to samples directory
 */
export function getSampleName(samplePath: string): string {
  return relative(SAMPLES_DIR, samplePath);
}
