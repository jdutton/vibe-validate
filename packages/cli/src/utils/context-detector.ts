/**
 * Agent Context Detection
 *
 * Detects if running in an agent context (Claude Code, Cursor, CI, etc.)
 * and adapts output verbosity accordingly (minimal for agents, verbose for interactive).
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
 * Determine if verbose output should be used based on context
 *
 * @param context Agent context
 * @returns True if verbose output is recommended, false for minimal
 */
export function shouldBeVerbose(context: AgentContext): boolean {
  // Agents (Claude Code, Cursor, etc.) prefer minimal output
  if (context.isAgent) {
    return false;
  }

  // CI environments prefer minimal output
  if (context.isCI) {
    return false;
  }

  // Interactive terminals can handle verbose output
  if (context.isInteractive) {
    return true;
  }

  // Default to minimal for non-interactive contexts
  return false;
}
