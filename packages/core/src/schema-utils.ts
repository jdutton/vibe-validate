/**
 * Zod Schema Utilities
 *
 * Shared validation helpers for consistent error handling across packages.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';

/**
 * Create a type-safe validator function from a Zod schema
 *
 * Provides consistent error formatting across all schema validations.
 * Error messages include full path (e.g., "phases.0.steps.2.command: Required")
 *
 * @param schema - Zod schema to validate against
 * @returns Safe validation function with success/error union type
 *
 * @example
 * ```typescript
 * const safeValidateResult = createSafeValidator(ValidationResultSchema);
 *
 * const result = safeValidateResult(data);
 * if (result.success) {
 *   console.log(result.data); // Typed as ValidationResult
 * } else {
 *   console.error(result.errors); // Array of formatted error messages
 * }
 * ```
 */
export function createSafeValidator<T extends z.ZodType>(schema: T) {
  return function safeValidate(data: unknown):
    | { success: true; data: z.infer<T> }
    | { success: false; errors: string[] } {
    const result = schema.safeParse(data);

    if (result.success) {
      return { success: true, data: result.data };
    }

    // Extract error messages with full path
    const errors = result.error.errors.map(err => {
      const path = err.path.join('.');
      return path ? `${path}: ${err.message}` : err.message;
    });

    return { success: false, errors };
  };
}

/**
 * Create a strict validator function from a Zod schema
 *
 * Throws on validation failure (useful when invalid data is a critical error).
 *
 * @param schema - Zod schema to validate against
 * @returns Strict validation function that throws on error
 *
 * @example
 * ```typescript
 * const validateResult = createStrictValidator(ValidationResultSchema);
 *
 * try {
 *   const result = validateResult(data); // Typed as ValidationResult
 * } catch (error) {
 *   console.error('Invalid data:', error);
 * }
 * ```
 */
export function createStrictValidator<T extends z.ZodType>(schema: T) {
  return function validate(data: unknown): z.infer<T> {
    return schema.parse(data);
  };
}
