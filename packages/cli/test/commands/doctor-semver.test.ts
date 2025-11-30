/**
 * Tests for semver comparison in doctor command
 *
 * Ensures proper handling of prerelease versions (e.g., 0.17.0 > 0.17.0-rc.11)
 */

import { describe, it, expect } from 'vitest';
import * as semver from 'semver';

describe('semver comparison in doctor command', () => {
  describe('stable vs prerelease', () => {
    it('should recognize 0.17.0 > 0.17.0-rc.11', () => {
      expect(semver.lt('0.17.0-rc.11', '0.17.0')).toBe(true);
      expect(semver.gt('0.17.0', '0.17.0-rc.11')).toBe(true);
    });

    it('should recognize 1.0.0 > 1.0.0-beta.5', () => {
      expect(semver.lt('1.0.0-beta.5', '1.0.0')).toBe(true);
    });

    it('should recognize 0.16.0 < 0.17.0-rc.1', () => {
      expect(semver.lt('0.16.0', '0.17.0-rc.1')).toBe(true);
    });
  });

  describe('prerelease vs prerelease', () => {
    it('should recognize 0.17.0-rc.10 < 0.17.0-rc.11', () => {
      expect(semver.lt('0.17.0-rc.10', '0.17.0-rc.11')).toBe(true);
    });

    it('should recognize 0.17.0-alpha.1 < 0.17.0-beta.1', () => {
      expect(semver.lt('0.17.0-alpha.1', '0.17.0-beta.1')).toBe(true);
    });

    it('should recognize 0.17.0-beta.1 < 0.17.0-rc.1', () => {
      expect(semver.lt('0.17.0-beta.1', '0.17.0-rc.1')).toBe(true);
    });
  });

  describe('stable vs stable', () => {
    it('should recognize 0.16.0 < 0.17.0', () => {
      expect(semver.lt('0.16.0', '0.17.0')).toBe(true);
    });

    it('should recognize 0.16.5 < 0.17.0', () => {
      expect(semver.lt('0.16.5', '0.17.0')).toBe(true);
    });

    it('should recognize 1.0.0 > 0.99.0', () => {
      expect(semver.gt('1.0.0', '0.99.0')).toBe(true);
    });
  });

  describe('equal versions', () => {
    it('should recognize 0.17.0 == 0.17.0', () => {
      expect(semver.eq('0.17.0', '0.17.0')).toBe(true);
      expect(semver.lt('0.17.0', '0.17.0')).toBe(false);
    });

    it('should recognize 0.17.0-rc.11 == 0.17.0-rc.11', () => {
      expect(semver.eq('0.17.0-rc.11', '0.17.0-rc.11')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle patch version differences with prereleases', () => {
      expect(semver.lt('0.16.9-rc.1', '0.17.0')).toBe(true);
      expect(semver.lt('0.17.0-rc.1', '0.17.1')).toBe(true);
    });

    it('should handle different prerelease identifiers', () => {
      expect(semver.lt('0.17.0-rc.11', '0.17.0')).toBe(true);
      expect(semver.lt('0.17.0-alpha.1', '0.17.0-rc.11')).toBe(true);
    });
  });
});
