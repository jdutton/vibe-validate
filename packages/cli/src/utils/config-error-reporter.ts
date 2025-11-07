/**
 * Shared configuration error reporting utility
 *
 * Provides consistent error formatting and suggestions across commands
 * (config, doctor, etc.)
 */

import chalk from 'chalk';

export interface ConfigErrorDetails {
  fileName: string;
  errors: string[];
}

/**
 * Format configuration validation errors for display
 *
 * @param details Error details from config validation
 * @param maxErrors Maximum number of errors to show (default: 5)
 * @returns Formatted error messages as string array
 */
export function formatConfigErrors(
  details: ConfigErrorDetails,
  maxErrors: number = 5
): string[] {
  const messages: string[] = [];

  messages.push(chalk.yellow('Validation errors:'));

  // Show up to maxErrors errors
  const errorList = details.errors.slice(0, maxErrors);
  for (const err of errorList) {
    messages.push(chalk.gray(`  • ${err}`));
  }

  if (details.errors.length > maxErrors) {
    messages.push(chalk.gray(`  ... and ${details.errors.length - maxErrors} more`));
  }

  return messages;
}

/**
 * Format helpful suggestions for fixing configuration errors
 *
 * @returns Formatted suggestion messages as string array
 */
export function formatConfigSuggestions(): string[] {
  return [
    chalk.blue('💡 Suggestions:'),
    chalk.gray('  • Check YAML syntax (indentation, colons, quotes)'),
    chalk.gray('  • See docs: https://github.com/jdutton/vibe-validate/blob/main/docs/configuration-reference.md'),
    chalk.gray('  • View examples: https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates'),
    chalk.gray('  • Use JSON Schema in your IDE for autocomplete'),
  ];
}

/**
 * Display configuration validation errors with suggestions
 *
 * Prints formatted error messages and helpful suggestions to stderr.
 *
 * @param details Error details from config validation
 * @param maxErrors Maximum number of errors to show (default: 5)
 */
export function displayConfigErrors(
  details: ConfigErrorDetails,
  maxErrors: number = 5
): void {
  console.error(chalk.red(`❌ Configuration is invalid: ${details.fileName}`));
  console.error();

  const errorMessages = formatConfigErrors(details, maxErrors);
  for (const msg of errorMessages) console.error(msg);

  console.error();

  const suggestions = formatConfigSuggestions();
  for (const msg of suggestions) console.error(msg);
}

/**
 * Get error messages as plain strings (for programmatic use)
 *
 * Returns error messages without ANSI color codes for use in
 * structured output or testing.
 *
 * @param details Error details from config validation
 * @param maxErrors Maximum number of errors to show (default: 5)
 * @returns Array of plain text error messages
 */
export function getPlainConfigErrors(
  details: ConfigErrorDetails,
  maxErrors: number = 5
): string[] {
  const messages: string[] = [];

  // Show up to maxErrors errors
  const errorList = details.errors.slice(0, maxErrors);
  for (const err of errorList) {
    messages.push(`  • ${err}`);
  }

  if (details.errors.length > maxErrors) {
    messages.push(`  ... and ${details.errors.length - maxErrors} more`);
  }

  return messages;
}

/**
 * Format config errors for doctor command check result
 *
 * Returns formatted message and suggestion strings suitable for
 * DoctorCheckResult structure.
 *
 * @param details Error details from config validation
 * @param maxErrors Maximum number of errors to show (default: 5)
 * @returns Object with message and suggestion strings
 */
export function formatDoctorConfigError(
  details: ConfigErrorDetails,
  maxErrors: number = 5
): { message: string; suggestion: string } {
  const errorList = details.errors.slice(0, maxErrors);
  const errorMessages = errorList.map(err => `     • ${err}`).join('\n');

  const message = `Found ${details.fileName} but it contains validation errors:\n${errorMessages}`;

  const suggestion = [
    'Fix validation errors shown above',
    'See configuration docs: https://github.com/jdutton/vibe-validate/blob/main/docs/configuration-reference.md',
    'JSON Schema for IDE validation: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/config.schema.json',
    'Example YAML configs: https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates'
  ].join('\n   ');

  return { message, suggestion };
}
