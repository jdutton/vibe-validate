import type { CIProvider } from './ci-provider.js';
import { GitHubActionsProvider } from './ci-providers/github-actions.js';

/**
 * Registry for CI providers with auto-detection
 *
 * Manages available CI providers and provides auto-detection
 * to determine which provider is usable in current context.
 *
 * Future providers can be added here:
 * - GitLab CI
 * - CircleCI
 * - Jenkins
 * - etc.
 */
export class CIProviderRegistry {
  private providers: CIProvider[] = [
    new GitHubActionsProvider(),
    // new GitLabCIProvider(),
    // new CircleCIProvider(),
  ];

  /**
   * Auto-detect which CI provider is available in current context
   *
   * Checks each registered provider in order until one reports availability.
   *
   * @returns First available provider, or null if none available
   */
  async detectProvider(): Promise<CIProvider | null> {
    for (const provider of this.providers) {
      if (await provider.isAvailable()) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Get specific provider by name
   *
   * @param name - Provider name (e.g., 'github-actions', 'gitlab-ci')
   * @returns Provider instance if found, undefined otherwise
   */
  getProvider(name: string): CIProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  /**
   * Get all registered provider names
   *
   * @returns Array of provider names
   */
  getProviderNames(): string[] {
    return this.providers.map((p) => p.name);
  }
}
