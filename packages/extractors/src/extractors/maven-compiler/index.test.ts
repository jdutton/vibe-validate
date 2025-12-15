import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import mavenCompilerExtractor from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Maven Compiler Extractor', () => {
  describe('detectMavenCompiler', () => {
    it('should detect Maven compiler output with high confidence', () => {
      const output = `[INFO] Compiling 45 source files to target/classes
[ERROR] COMPILATION ERROR :
[ERROR] /path/to/File.java:[42,25] cannot find symbol
[INFO] 2 errors
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.13.0:compile`;

      const result = mavenCompilerExtractor.detect(output);

      expect(result.confidence).toBe(100);
      expect(result.patterns).toContain('[ERROR] COMPILATION ERROR marker');
      expect(result.patterns).toContain('maven-compiler-plugin reference');
      expect(result.patterns).toContain('file:[line,column] format');
      expect(result.patterns).toContain('error count summary');
      expect(result.patterns).toContain('Java compiler error pattern');
      expect(result.reason).toBe('Maven compiler plugin output detected');
    });

    it('should have low confidence for non-compiler output', () => {
      const output = `Some random build output
No compilation errors here
Just normal text`;

      const result = mavenCompilerExtractor.detect(output);

      expect(result.confidence).toBeLessThan(40);
    });

    it('should detect compilation error marker alone (partial match)', () => {
      const output = `[INFO] Building project
[ERROR] COMPILATION ERROR :
[ERROR] Some compilation issue occurred`;

      const result = mavenCompilerExtractor.detect(output);

      // COMPILATION ERROR marker is worth 30 points, so this is correct
      expect(result.confidence).toBe(30);
      expect(result.patterns).toContain('[ERROR] COMPILATION ERROR marker');
    });
  });

  describe('extractMavenCompiler', () => {
    it('should extract "cannot find symbol" errors', () => {
      const output = `[INFO] Compiling 45 source files
[ERROR] COMPILATION ERROR :
[ERROR] /Users/dev/project/src/main/java/com/example/Foo.java:[42,25] cannot find symbol
  symbol:   method extractComponent()
  location: class com.example.RefactoringActions
[INFO] 1 error`;

      const result = mavenCompilerExtractor.extract(output);

      expect(result.totalErrors).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        file: 'src/main/java/com/example/Foo.java',
        line: 42,
        column: 25,
        message: expect.stringContaining('cannot find symbol'),
      });
      expect(result.errors[0]?.message).toContain('symbol:   method extractComponent()');
      expect(result.errors[0]?.message).toContain('location: class com.example.RefactoringActions');
    });

    it('should extract "incompatible types" errors', () => {
      const output = `[ERROR] COMPILATION ERROR :
[ERROR] /project/src/main/java/com/example/Bar.java:[15,8] incompatible types: java.lang.String cannot be converted to int
[INFO] 1 error`;

      const result = mavenCompilerExtractor.extract(output);

      expect(result.totalErrors).toBe(1);
      expect(result.errors[0]).toMatchObject({
        file: 'src/main/java/com/example/Bar.java',
        line: 15,
        column: 8,
        message: expect.stringContaining('incompatible types'),
      });
    });

    it('should extract multiple compilation errors', () => {
      const output = `[ERROR] COMPILATION ERROR :
[ERROR] /path/to/Foo.java:[42,25] cannot find symbol
[ERROR] /path/to/Bar.java:[15,8] incompatible types: String cannot be converted to int
[ERROR] /path/to/Baz.java:[8,1] class, interface, or enum expected
[INFO] 3 errors`;

      const result = mavenCompilerExtractor.extract(output);

      expect(result.totalErrors).toBe(3);
      expect(result.errors).toHaveLength(3);
      expect(result.summary).toContain('3 compilation error(s)');
    });

    it('should deduplicate identical errors', () => {
      const output = `[ERROR] COMPILATION ERROR :
[ERROR] /path/to/Foo.java:[42,25] cannot find symbol
[ERROR] /path/to/Foo.java:[42,25] cannot find symbol
[INFO] 2 errors`;

      const result = mavenCompilerExtractor.extract(output);

      // Should only report once, not twice
      expect(result.totalErrors).toBe(1);
    });

    it('should limit errors to MAX_ERRORS_IN_ARRAY', () => {
      // Create 20 compilation errors
      const errors = Array.from({ length: 20 }, (_, i) =>
        `[ERROR] /path/File${i}.java:[${i + 1},1] error ${i}`
      ).join('\n');

      const output = `[ERROR] COMPILATION ERROR :\n${errors}\n[INFO] 20 errors`;
      const result = mavenCompilerExtractor.extract(output);

      expect(result.totalErrors).toBe(20); // All counted
      expect(result.errors.length).toBeLessThanOrEqual(10); // But array limited
    });

    it('should provide guidance', () => {
      const output = `[ERROR] COMPILATION ERROR :
[ERROR] /path/Foo.java:[1,1] cannot find symbol
[INFO] 1 error`;

      const result = mavenCompilerExtractor.extract(output);

      expect(result.guidance).toBeDefined();
      expect(result.guidance).toContain('compilation error');
    });

    it('should return 0 errors for low confidence detection', () => {
      const output = 'Some random text with no compilation errors';

      const result = mavenCompilerExtractor.extract(output);

      expect(result.totalErrors).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('Not Maven compiler output');
    });

    it('should extract errors from real-world test data', () => {
      // Use co-located sample data
      const testDataPath = join(__dirname, 'samples/maven-compile-error.txt');
      const output = readFileSync(testDataPath, 'utf-8');

      const result = mavenCompilerExtractor.extract(output);

      // Real-world data should have 2 errors
      expect(result.totalErrors).toBe(2);
      expect(result.errors).toHaveLength(2);

      // First error: cannot find symbol
      expect(result.errors[0]).toMatchObject({
        file: expect.stringContaining('Foo.java'),
        line: 42,
        column: 25,
      });
      expect(result.errors[0]?.message).toContain('cannot find symbol');
      expect(result.errors[0]?.message).toContain('extractComponent()');

      // Second error: incompatible types
      expect(result.errors[1]).toMatchObject({
        file: expect.stringContaining('Bar.java'),
        line: 15,
        column: 8,
      });
      expect(result.errors[1]?.message).toContain('incompatible types');
    });

    it('should extract relative paths correctly', () => {
      const output = `[ERROR] COMPILATION ERROR :
[ERROR] /Users/jeff/workspace/project/src/main/java/com/example/Test.java:[10,5] error message
[INFO] 1 error`;

      const result = mavenCompilerExtractor.extract(output);

      expect(result.errors[0]?.file).toBe('src/main/java/com/example/Test.java');
    });

    it('should handle errors without column numbers', () => {
      const output = `[ERROR] COMPILATION ERROR :
[ERROR] /path/to/File.java:[42] some error without column
[INFO] 1 error`;

      const result = mavenCompilerExtractor.extract(output);

      expect(result.errors[0]).toMatchObject({
        file: expect.any(String),
        line: 42,
        message: 'some error without column',
      });
      expect(result.errors[0]?.column).toBeUndefined();
    });

    it('should group errors by file in summary', () => {
      const output = `[ERROR] COMPILATION ERROR :
[ERROR] /path/to/Foo.java:[1,1] error 1
[ERROR] /path/to/Foo.java:[2,1] error 2
[ERROR] /path/to/Bar.java:[1,1] error 3
[INFO] 3 errors`;

      const result = mavenCompilerExtractor.extract(output);

      expect(result.summary).toContain('3 compilation error(s)');
      expect(result.summary).toContain('2 file(s)');
    });
  });

  describe('plugin metadata', () => {
    it('should have correct metadata', () => {
      expect(mavenCompilerExtractor.metadata.name).toBe('maven-compiler');
      expect(mavenCompilerExtractor.metadata.version).toBeDefined();
      expect(mavenCompilerExtractor.metadata.description).toContain('Maven');
    });

    it('should have hints for fast filtering', () => {
      expect(mavenCompilerExtractor.hints).toBeDefined();
      expect(mavenCompilerExtractor.hints?.required).toContain('[ERROR]');
      expect(mavenCompilerExtractor.hints?.required).toContain('[INFO]');
      expect(mavenCompilerExtractor.hints?.anyOf).toBeDefined();
    });

    it('should have samples for testing', () => {
      expect(mavenCompilerExtractor.samples).toBeDefined();
      expect(mavenCompilerExtractor.samples.length).toBeGreaterThan(0);
    });
  });
});
