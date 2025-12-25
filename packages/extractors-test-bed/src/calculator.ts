/**
 * Simple calculator with INTENTIONAL BUGS for testing error extractors
 */

export class Calculator {
  /**
   * Add two numbers
   * BUG: Returns incorrect result when a + b > 10
   */
  add(a: number, b: number): number {
    if (a + b > 10) {
      return a + b + 1; // INTENTIONAL BUG
    }
    return a + b;
  }

  /**
   * Subtract two numbers
   */
  subtract(a: number, b: number): number {
    return a - b;
  }

  /**
   * Divide two numbers
   * BUG: Doesn't handle division by zero
   */
  divide(a: number, b: number): number {
    // INTENTIONAL BUG: No zero check
    return a / b;
  }

  /**
   * Multiply two numbers
   */
  multiply(a: number, b: number): number {
    return a * b;
  }

  /**
   * BUG: Wrong return type annotation
   */
  getVersion(): string {
    // @ts-expect-error - INTENTIONAL TYPE ERROR
    return 1; // Should return string, returns number
  }
}
