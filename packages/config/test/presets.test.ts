/**
 * Tests for configuration presets
 */

import { describe, it, expect } from 'vitest';
import {
  typescriptLibraryPreset,
  typescriptNodejsPreset,
  typescriptReactPreset,
} from '../src/presets/index.js';
import { getPreset, listPresets } from '../src/presets/index.js';

describe('presets', () => {
  describe('typescript-library', () => {
    it('should have correct structure', () => {
      expect(typescriptLibraryPreset).toBeDefined();
      expect(typescriptLibraryPreset.validation.phases).toBeDefined();
      expect(typescriptLibraryPreset.validation.phases.length).toBeGreaterThan(0);
    });

    it('should have validation phases', () => {
      expect(typescriptLibraryPreset.validation.phases.length).toBeGreaterThan(0);
      const firstPhase = typescriptLibraryPreset.validation.phases[0];
      expect(firstPhase.name).toContain('Phase');
      expect(firstPhase.steps).toBeDefined();
      expect(firstPhase.steps.length).toBeGreaterThan(0);
    });

    it('should have steps with commands', () => {
      const allSteps = typescriptLibraryPreset.validation.phases.flatMap((p) => p.steps);
      expect(allSteps.length).toBeGreaterThan(0);
      allSteps.forEach((step) => {
        expect(step.name).toBeDefined();
        expect(step.command).toBeDefined();
      });
    });

    it('should use git-tree-hash caching', () => {
      expect(typescriptLibraryPreset.validation.caching.strategy).toBe('git-tree-hash');
      expect(typescriptLibraryPreset.validation.caching.enabled).toBe(true);
    });

    it('should have main branch configured', () => {
      expect(typescriptLibraryPreset.git.mainBranch).toBe('main');
    });
  });

  describe('typescript-nodejs', () => {
    it('should have correct structure', () => {
      expect(typescriptNodejsPreset).toBeDefined();
      expect(typescriptNodejsPreset.validation.phases).toBeDefined();
      expect(typescriptNodejsPreset.validation.phases.length).toBeGreaterThan(0);
    });

    it('should have validation phases', () => {
      expect(typescriptNodejsPreset.validation.phases.length).toBeGreaterThan(0);
      const firstPhase = typescriptNodejsPreset.validation.phases[0];
      expect(firstPhase.name).toContain('Phase');
      expect(firstPhase.steps).toBeDefined();
      expect(firstPhase.steps.length).toBeGreaterThan(0);
    });

    it('should have steps with commands', () => {
      const allSteps = typescriptNodejsPreset.validation.phases.flatMap((p) => p.steps);
      expect(allSteps.length).toBeGreaterThan(0);
      allSteps.forEach((step) => {
        expect(step.name).toBeDefined();
        expect(step.command).toBeDefined();
      });
    });

    it('should use git-tree-hash caching', () => {
      expect(typescriptNodejsPreset.validation.caching.strategy).toBe('git-tree-hash');
      expect(typescriptNodejsPreset.validation.caching.enabled).toBe(true);
    });
  });

  describe('typescript-react', () => {
    it('should have correct structure', () => {
      expect(typescriptReactPreset).toBeDefined();
      expect(typescriptReactPreset.validation.phases).toBeDefined();
      expect(typescriptReactPreset.validation.phases.length).toBeGreaterThan(0);
    });

    it('should have validation phases', () => {
      expect(typescriptReactPreset.validation.phases.length).toBeGreaterThan(0);
      const firstPhase = typescriptReactPreset.validation.phases[0];
      expect(firstPhase.name).toContain('Phase');
      expect(firstPhase.steps).toBeDefined();
      expect(firstPhase.steps.length).toBeGreaterThan(0);
    });

    it('should have steps with commands', () => {
      const allSteps = typescriptReactPreset.validation.phases.flatMap((p) => p.steps);
      expect(allSteps.length).toBeGreaterThan(0);
      allSteps.forEach((step) => {
        expect(step.name).toBeDefined();
        expect(step.command).toBeDefined();
      });
    });

    it('should use git-tree-hash caching', () => {
      expect(typescriptReactPreset.validation.caching.strategy).toBe('git-tree-hash');
      expect(typescriptReactPreset.validation.caching.enabled).toBe(true);
    });
  });

  describe('getPreset', () => {
    it('should return typescript-library preset', () => {
      const preset = getPreset('typescript-library');
      expect(preset).toBeDefined();
      expect(preset).toEqual(typescriptLibraryPreset);
    });

    it('should return typescript-nodejs preset', () => {
      const preset = getPreset('typescript-nodejs');
      expect(preset).toBeDefined();
      expect(preset).toEqual(typescriptNodejsPreset);
    });

    it('should return typescript-react preset', () => {
      const preset = getPreset('typescript-react');
      expect(preset).toBeDefined();
      expect(preset).toEqual(typescriptReactPreset);
    });

    it('should return undefined for unknown preset', () => {
      const preset = getPreset('unknown-preset' as any);
      expect(preset).toBeUndefined();
    });
  });

  describe('listPresets', () => {
    it('should list all available presets', () => {
      const presets = listPresets();
      expect(presets).toEqual([
        'typescript-library',
        'typescript-nodejs',
        'typescript-react',
      ]);
    });
  });
});
