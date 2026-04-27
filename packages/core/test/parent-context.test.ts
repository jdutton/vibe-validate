import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  ParentContextSchema,
  readParentContext,
  buildChildContext,
  serializeForEnv,
  PARENT_CONTEXT_ENV,
  MAX_NESTED_DEPTH,
} from '../src/parent-context.js';

describe('ParentContext', () => {
  const validCtx = {
    runId: 'run-abc',
    treeHash: 'deadbeef',
    depth: 1,
    stepName: 'Integration tests',
    phaseName: 'Integration Tests',
    // eslint-disable-next-line sonarjs/publicly-writable-directories -- Test fixture data only
    outputDir: '/tmp/vv/runs/run-abc/steps/integration-tests',
    capturing: true,
    caching: true,
    extracting: true,
    verbose: false,
    forceExecution: false,
  };

  describe('ParentContextSchema', () => {
    it('parses a valid context', () => {
      expect(() => ParentContextSchema.parse(validCtx)).not.toThrow();
    });

    it('rejects unknown fields (strict)', () => {
      const withExtra = { ...validCtx, somethingElse: 'x' };
      expect(() => ParentContextSchema.parse(withExtra)).toThrow();
    });

    it('rejects negative depth', () => {
      expect(() => ParentContextSchema.parse({ ...validCtx, depth: -1 })).toThrow();
    });

    it('makes phaseName optional', () => {
      const withoutPhase = Object.fromEntries(
        Object.entries(validCtx).filter(([key]) => key !== 'phaseName')
      );
      expect(() => ParentContextSchema.parse(withoutPhase)).not.toThrow();
    });
  });

  describe('readParentContext', () => {
    let savedEnv: string | undefined;
    beforeEach(() => { savedEnv = process.env[PARENT_CONTEXT_ENV]; });
    afterEach(() => {
      if (savedEnv === undefined) delete process.env[PARENT_CONTEXT_ENV];
      else process.env[PARENT_CONTEXT_ENV] = savedEnv;
    });

    it('returns null when env var is not set', () => {
      delete process.env[PARENT_CONTEXT_ENV];
      expect(readParentContext()).toBeNull();
    });

    it('returns parsed context when env var is valid JSON', () => {
      process.env[PARENT_CONTEXT_ENV] = JSON.stringify(validCtx);
      expect(readParentContext()).toEqual(validCtx);
    });

    it('throws on malformed JSON', () => {
      process.env[PARENT_CONTEXT_ENV] = '{not json';
      expect(() => readParentContext()).toThrow(/Invalid VV_PARENT_CONTEXT/);
    });

    it('throws on schema mismatch (unknown field)', () => {
      process.env[PARENT_CONTEXT_ENV] = JSON.stringify({ ...validCtx, foo: 'bar' });
      expect(() => readParentContext()).toThrow(/Invalid VV_PARENT_CONTEXT/);
    });
  });

  describe('buildChildContext', () => {
    const stepInput = {
      runId: 'run-abc',
      treeHash: 'deadbeef',
      stepName: 'Integration tests',
      phaseName: 'Integration Tests',
      // eslint-disable-next-line sonarjs/publicly-writable-directories -- Test fixture data only
      outputDir: '/tmp/vv/x',
      verbose: false,
      forceExecution: false,
    };

    it('starts at depth 1 when no parent', () => {
      const ctx = buildChildContext(null, stepInput);
      expect(ctx.depth).toBe(1);
    });

    it('increments depth when parent exists', () => {
      const ctx = buildChildContext(validCtx, stepInput);
      expect(ctx.depth).toBe(validCtx.depth + 1);
    });

    it('throws when depth would exceed MAX_NESTED_DEPTH', () => {
      const deepParent = { ...validCtx, depth: MAX_NESTED_DEPTH };
      expect(() => buildChildContext(deepParent, stepInput)).toThrow(/depth exceeded/);
    });

    it('sets capabilities to true for outer-handled work', () => {
      const ctx = buildChildContext(null, stepInput);
      expect(ctx.capturing).toBe(true);
      expect(ctx.caching).toBe(true);
      expect(ctx.extracting).toBe(true);
    });
  });

  describe('serializeForEnv', () => {
    it('roundtrips through JSON.parse + schema parse', () => {
      const serialized = serializeForEnv(validCtx);
      expect(ParentContextSchema.parse(JSON.parse(serialized))).toEqual(validCtx);
    });
  });
});
