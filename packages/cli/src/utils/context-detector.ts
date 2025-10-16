/**
 * Agent Context Detection
 *
 * Detects if running in an agent context (Claude Code, Cursor, CI, etc.)
 * and adapts output format accordingly.
 */

export interface AgentContext {
  isAgent: boolean;
  agentName?: string;
  isCI: boolean;
  isInteractive: boolean;
}

/**
 * Detect the current execution context
 *
 * @returns Context information about the environment
 */
export function detectContext(): AgentContext {
  const env = process.env;

  // Check for specific agent environments
  if (env.CLAUDE_CODE) {
    return {
      isAgent: true,
      agentName: 'claude-code',
      isCI: false,
      isInteractive: false,
    };
  }

  if (env.CURSOR) {
    return {
      isAgent: true,
      agentName: 'cursor',
      isCI: false,
      isInteractive: false,
    };
  }

  if (env.AIDER) {
    return {
      isAgent: true,
      agentName: 'aider',
      isCI: false,
      isInteractive: false,
    };
  }

  if (env.CONTINUE) {
    return {
      isAgent: true,
      agentName: 'continue',
      isCI: false,
      isInteractive: false,
    };
  }

  // Check for CI environment
  if (env.CI === 'true' || env.CI === '1') {
    return {
      isAgent: false,
      isCI: true,
      isInteractive: false,
    };
  }

  // Default: human interactive terminal
  return {
    isAgent: false,
    isCI: false,
    isInteractive: process.stdout.isTTY ?? false,
  };
}

/**
 * Get recommended output format based on context
 *
 * @param context Agent context
 * @returns Recommended output format
 */
export function getRecommendedFormat(context: AgentContext): 'human' | 'yaml' | 'json' {
  if (context.isAgent) {
    return 'yaml'; // Agent-friendly structured format
  }

  if (context.isCI) {
    return 'json'; // Machine-readable for CI/CD pipelines
  }

  if (context.isInteractive) {
    return 'human'; // Colorful, verbose output for terminals
  }

  return 'human'; // Default fallback
}
