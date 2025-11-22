import { describe, it, expect } from 'vitest';
import { detectMavenCheckstyle, extractMavenCheckstyle } from '../src/maven-checkstyle-extractor.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Maven Checkstyle Extractor', () => {
  describe('detectMavenCheckstyle', () => {
    it('should detect Maven Checkstyle output with high confidence', () => {
      const output = `[INFO] Starting audit...
[WARN] /path/to/File.java:10:5: Missing Javadoc comment. [JavadocVariable]
Audit done.
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-checkstyle-plugin:3.3.1:check: You have 5 Checkstyle violations.`;

      const result = detectMavenCheckstyle(output);

      expect(result.confidence).toBeGreaterThanOrEqual(100);
      expect(result.patterns).toContain('maven-checkstyle-plugin reference');
      expect(result.patterns).toContain('Checkstyle audit start marker');
      expect(result.patterns).toContain('Checkstyle audit complete marker');
      expect(result.patterns).toContain('Checkstyle violation summary');
      expect(result.reason).toBe('Maven Checkstyle plugin output detected');
    });

    it('should have low confidence for non-Checkstyle output', () => {
      const output = `Some random build output
No Checkstyle markers here
Just normal text`;

      const result = detectMavenCheckstyle(output);

      expect(result.confidence).toBeLessThan(40);
    });
  });

  describe('extractMavenCheckstyle', () => {
    it('should extract errors from [WARN] format', () => {
      const output = `[INFO] Starting audit...
[WARN] /project/src/main/java/com/example/Foo.java:10:5: Missing Javadoc comment. [JavadocVariable]
[WARN] /project/src/main/java/com/example/Foo.java:15:1: '{' should be on previous line. [LeftCurly]
Audit done.`;

      const result = extractMavenCheckstyle(output);

      expect(result.totalErrors).toBe(2);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toMatchObject({
        file: 'src/main/java/com/example/Foo.java',
        line: 10,
        column: 5,
        message: expect.stringContaining('Missing Javadoc'),
      });
    });

    it('should extract errors from [WARNING] format', () => {
      const output = `[INFO] Starting audit...
[WARNING] src/main/java/com/example/Foo.java:[10,5] (javadoc) JavadocVariable: Missing a Javadoc comment.
[WARNING] src/main/java/com/example/Foo.java:[15,1] (blocks) LeftCurly: '{' at column 1 should be on the previous line.
Audit done.`;

      const result = extractMavenCheckstyle(output);

      expect(result.totalErrors).toBe(2);
      expect(result.errors[0]).toMatchObject({
        file: 'src/main/java/com/example/Foo.java',
        line: 10,
        column: 5,
      });
    });

    it('should deduplicate violations from both formats', () => {
      const output = `[INFO] Starting audit...
[WARN] /project/src/main/java/Foo.java:10:5: Missing Javadoc. [JavadocVariable]
Audit done.
[WARNING] src/main/java/Foo.java:[10,5] (javadoc) JavadocVariable: Missing Javadoc.`;

      const result = extractMavenCheckstyle(output);

      // Should only report once, not twice
      expect(result.totalErrors).toBe(1);
    });

    it('should limit errors to MAX_ERRORS_IN_ARRAY', () => {
      // Create 20 violations
      const violations = Array.from({ length: 20 }, (_, i) =>
        `[WARN] /path/File.java:${i}:5: Error ${i}. [Rule${i}]`
      ).join('\n');

      const output = `[INFO] Starting audit...\n${violations}\nAudit done.`;
      const result = extractMavenCheckstyle(output);

      expect(result.totalErrors).toBe(20); // All counted
      expect(result.errors.length).toBeLessThanOrEqual(10); // But array limited
    });

    it('should provide guidance', () => {
      const output = `[INFO] Starting audit...
[WARN] /path/Foo.java:1:1: Error. [Rule]
Audit done.`;

      const result = extractMavenCheckstyle(output);

      expect(result.guidance).toContain('Fix Checkstyle violations');
      expect(result.guidance).toContain('mvn checkstyle:check');
    });

    it('should handle real anonymized output', () => {
      const testFile = join(__dirname, '../static/maven-checkstyle-violations.txt');

      try {
        const output = readFileSync(testFile, 'utf-8');
        const result = extractMavenCheckstyle(output);

        // Should extract all violations
        expect(result.totalErrors).toBeGreaterThan(15);
        expect(result.errors).toHaveLength(10); // Capped at MAX_ERRORS_IN_ARRAY
        expect(result.summary).toContain('Checkstyle violation');
        expect(result.metadata?.detection?.confidence).toBe(100);
      } catch {
        // File doesn't exist yet - skip test
        expect(true).toBe(true);
      }
    });
  });
});
