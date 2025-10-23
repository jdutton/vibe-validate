import { describe, it, expect } from 'vitest';
import {
  generateValidationResultJsonSchema,
  validationResultJsonSchema,
} from '../src/result-schema-export.js';

describe('result-schema-export', () => {
  describe('generateValidationResultJsonSchema', () => {
    it('should generate a valid JSON Schema object', () => {
      const schema = generateValidationResultJsonSchema();

      // Should be an object
      expect(schema).toBeTypeOf('object');
      expect(schema).not.toBeNull();

      // Should have JSON Schema metadata
      expect(schema).toHaveProperty('$schema');
      expect(schema).toHaveProperty('$ref');
      expect(schema).toHaveProperty('definitions');

      // Should reference ValidationResult definition
      expect(schema).toMatchObject({
        $ref: '#/definitions/ValidationResult',
        $schema: 'http://json-schema.org/draft-07/schema#',
      });
    });
  });

  describe('validationResultJsonSchema', () => {
    it('should export pre-generated schema', () => {
      // Should be an object
      expect(validationResultJsonSchema).toBeTypeOf('object');
      expect(validationResultJsonSchema).not.toBeNull();

      // Should match the generated schema
      expect(validationResultJsonSchema).toEqual(
        generateValidationResultJsonSchema()
      );
    });
  });
});
