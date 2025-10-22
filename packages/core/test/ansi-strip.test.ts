/**
 * Test file to verify ANSI stripping
 *
 * This test is INTENTIONALLY FAILING to demonstrate that:
 * 1. Test failures are captured without ANSI codes
 * 2. Watch-pr displays clean, readable validation results
 * 3. Git notes store clean output without escape sequences
 */

import { describe, it, expect } from 'vitest';

describe('ANSI Stripping Demonstration', () => {
  it('should fail to show clean output without ANSI codes', () => {
    // This will fail and produce colorized vitest output
    // The validation runner should strip ANSI codes before storing
    const expected = 'clean output';
    const actual = 'intentional failure';

    expect(actual).toBe(expected);
  });

  it('should fail with descriptive error message', () => {
    // Another intentional failure to generate more test output
    const result = {
      success: false,
      errorMessage: 'This is an intentional failure to test ANSI stripping'
    };

    expect(result.success).toBe(true);
    expect(result.errorMessage).toBeUndefined();
  });
});
