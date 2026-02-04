/**
 * Maven Compiler Error Extractor Plugin
 *
 * Extracts Java compilation errors from Maven compiler plugin output.
 * Supports output from `mvn compile` and `mvn test-compile` commands.
 *
 * @package @vibe-validate/extractors
 */

import { extractRelativePath } from '../../maven-utils.js';
import { MAX_ERRORS_IN_ARRAY } from '../../result-schema.js';
import type {
  ExtractorPlugin,
  DetectionResult,
  ErrorExtractorResult,
  FormattedError,
} from '../../types.js';
import { createLowConfidenceResult, createMavenResult } from '../../utils/maven-extractor-utils.js';

// Extractor name constant
const EXTRACTOR_NAME = 'maven-compiler';

/**
 * Maven compiler output format:
 *
 * [ERROR] COMPILATION ERROR :
 * [ERROR] /absolute/path/to/File.java:[line,column] error message
 *   symbol:   additional context
 *   location: additional context
 * [ERROR] /path/to/Another.java:[line,column] error message
 * [INFO] N errors
 * [ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin...
 */

interface CompilationError {
  file: string;
  line: number;
  column?: number;
  message: string;
}

const COMPILER_PATTERNS = {
  // [ERROR] /path/to/File.java:[line,column] error message
  // eslint-disable-next-line sonarjs/slow-regex, security/detect-unsafe-regex -- Safe: Maven compiler output is structured, limited line length
  errorLine: /^\[ERROR\]\s+([^:]+):\[(\d+)(?:,(\d+))?\]\s+(.+)$/,

  // Markers for high-confidence detection
  compilationErrorMarker: /^\[ERROR\]\s+COMPILATION ERROR\s*:/,
  compilerPluginMarker: /maven-compiler-plugin/,
  errorCountMarker: /^\[INFO\]\s+(\d+)\s+errors?\s*$/,

  // Common Java compiler error patterns
  compilerErrorPatterns: [
    'cannot find symbol',
    'incompatible types',
    'class, interface, or enum expected',
    'illegal start of expression',
    'reached end of file while parsing',
    'package .* does not exist',
    'method .* cannot be applied',
  ],
};

/**
 * Detects if output is from Maven compiler plugin
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 22 acceptable for detection (sequentially checks 5 distinct Maven compiler output patterns for accurate detection)
export function detectMavenCompiler(output: string): DetectionResult {
  const lines = output.split('\n');
  let score = 0;
  const foundPatterns: string[] = [];

  // Look for compilation error markers
  let hasErrorLineFormat = false;
  let hasCompilerErrorPattern = false;

  for (const line of lines) {
    // High-value markers (30 points each)
    if (COMPILER_PATTERNS.compilationErrorMarker.test(line)) {
      score += 30;
      foundPatterns.push('[ERROR] COMPILATION ERROR marker');
    }
    if (COMPILER_PATTERNS.compilerPluginMarker.test(line)) {
      score += 30;
      foundPatterns.push('maven-compiler-plugin reference');
    }

    // Medium-value markers (20 points)
    if (COMPILER_PATTERNS.errorCountMarker.test(line)) {
      score += 20;
      foundPatterns.push('error count summary');
    }
    if (!hasErrorLineFormat && COMPILER_PATTERNS.errorLine.test(line)) {
      score += 20;
      foundPatterns.push('file:[line,column] format');
      hasErrorLineFormat = true;
    }

    // Low-value markers (10 points for first match)
    if (!hasCompilerErrorPattern) {
      for (const pattern of COMPILER_PATTERNS.compilerErrorPatterns) {
        if (line.includes(pattern)) {
          score += 10;
          foundPatterns.push('Java compiler error pattern');
          hasCompilerErrorPattern = true;
          break;
        }
      }
    }
  }

  // Determine reason based on score
  let reason: string;
  if (score >= 70) {
    reason = 'Maven compiler plugin output detected';
  } else if (score >= 40) {
    reason = 'Possible Maven compiler output';
  } else {
    reason = 'Not Maven compiler output';
  }

  return {
    confidence: Math.min(score, 100),
    patterns: foundPatterns,
    reason,
  };
}

/**
 * Extracts compilation errors from Maven compiler output
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 21 acceptable for extraction (parses Maven compiler output with context lines, deduplication, and error formatting)
export function extractMavenCompiler(
  output: string,
  command?: string,
): ErrorExtractorResult {
  const detection = detectMavenCompiler(output);

  if (detection.confidence < 40) {
    return createLowConfidenceResult('compiler', detection);
  }

  const compilationErrors: CompilationError[] = [];
  const lines = output.split('\n');

  // Parse error lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = COMPILER_PATTERNS.errorLine.exec(line);

    if (match) {
      const [, filePath, lineStr, colStr, message] = match;

      // Collect additional context (symbol, location) from next lines
      const contextLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nextLine = lines[j]?.trim();
        if (nextLine && !nextLine.startsWith('[') && (nextLine.startsWith('symbol:') || nextLine.startsWith('location:'))) {
          contextLines.push(nextLine);
        } else if (nextLine?.startsWith('[')) {
          // Hit next Maven log line
          break;
        }
      }

      const fullMessage = contextLines.length > 0
        ? `${message}\n${contextLines.join('\n')}`
        : message;

      compilationErrors.push({
        file: extractRelativePath(filePath),
        line: Number.parseInt(lineStr, 10),
        column: colStr ? Number.parseInt(colStr, 10) : undefined,
        message: fullMessage.trim(),
      });
    }
  }

  // Remove duplicates (Maven sometimes reports errors twice)
  const uniqueErrors = deduplicateErrors(compilationErrors);

  // Convert to FormattedError format
  const errors: FormattedError[] = uniqueErrors.slice(0, MAX_ERRORS_IN_ARRAY).map((e) => ({
    file: e.file,
    line: e.line,
    column: e.column,
    message: e.message,
  }));

  // Group by file for summary
  const fileGroups = groupByFile(uniqueErrors);
  const summary = `${uniqueErrors.length} compilation error(s) in ${fileGroups.size} file(s)`;

  // Generate guidance
  const guidance =
    uniqueErrors.length > 0
      ? `Fix Java compilation errors. Run ${command ?? 'mvn compile'} to see all details.`
      : undefined;

  // Create error summary
  const errorSummary = errors.length > 0
    ? errors.map((e, i) => {
        const location = e.column ? `${e.file ?? 'unknown'}:${e.line ?? 0}:${e.column}` : `${e.file ?? 'unknown'}:${e.line ?? 0}`;
        return `[Error ${i + 1}/${errors.length}] ${location}\n${e.message}`;
      }).join('\n\n')
    : undefined;

  return createMavenResult(
    EXTRACTOR_NAME,
    detection,
    summary,
    errors,
    uniqueErrors.length,
    guidance,
    errorSummary
  );
}

/**
 * Deduplicate compilation errors
 */
function deduplicateErrors(errors: CompilationError[]): CompilationError[] {
  const seen = new Set<string>();
  const unique: CompilationError[] = [];

  for (const e of errors) {
    const key = `${e.file ?? 'unknown'}:${e.line ?? 0}:${e.column ?? 0}:${e.message.split('\n')[0]}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }

  return unique;
}

/**
 * Group errors by file
 */
function groupByFile(errors: CompilationError[]): Map<string, CompilationError[]> {
  const groups = new Map<string, CompilationError[]>();

  for (const error of errors) {
    const file = error.file || 'unknown';
    if (!groups.has(file)) {
      groups.set(file, []);
    }
    const group = groups.get(file);
    if (group) {
      group.push(error);
    }
  }

  return groups;
}

/**
 * Maven Compiler Extractor Plugin
 */
const mavenCompilerExtractor: ExtractorPlugin = {
  metadata: {
    name: EXTRACTOR_NAME,
    version: '1.0.0',
    author: 'Jeff Dutton <jeff@duckcreek.com>',
    description: 'Extracts Java compilation errors from Maven compiler plugin output',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['maven', 'java', 'compiler', 'javac'],
  },

  hints: {
    required: ['[ERROR]', '[INFO]'],
    anyOf: ['COMPILATION ERROR', 'maven-compiler-plugin'],
  },

  priority: 70,

  detect: detectMavenCompiler,
  extract: extractMavenCompiler,

  samples: [
    {
      name: 'basic-cannot-find-symbol',
      description: 'Simple cannot find symbol error',
      input: `[INFO] Compiling 45 source files
[ERROR] COMPILATION ERROR :
[ERROR] /Users/dev/project/src/main/java/com/example/Foo.java:[42,25] cannot find symbol
  symbol:   method extractComponent()
  location: class com.example.RefactoringActions
[INFO] 1 error`,
      expected: {
        totalErrors: 1,
        errors: [
          {
            file: 'src/main/java/com/example/Foo.java',
            line: 42,
            column: 25,
            message: 'cannot find symbol',
          },
        ],
      },
    },
    {
      name: 'real-world-output',
      description: 'Real Maven compilation failure from test data',
      inputFile: './samples/maven-compile-error.txt',
      expected: {
        totalErrors: 2,
      },
    },
  ],
};

export default mavenCompilerExtractor;
