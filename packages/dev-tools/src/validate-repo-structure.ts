#!/usr/bin/env tsx
/**
 * Repository Structure Validator
 *
 * Deterministic guardrails that prevent structural drift from agentic development.
 * Validates build system consistency, package.json conventions, source file locations,
 * security, and turbo/build alignment.
 *
 * Run: pnpm validate-structure
 *      tsx packages/dev-tools/src/validate-repo-structure.ts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT, colors, log } from './common.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ValidationError {
  rule: string;
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

interface CategoryResult {
  name: string;
  errors: ValidationError[];
  passed: number;
  failed: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.husky', 'coverage', '.turbo']);
const TSCONFIG_FILENAME = 'tsconfig.json';
const PACKAGE_JSON_FILENAME = 'package.json';
const RULE_NO_SECRETS = 'no-secrets';

// Packages exempt from source conventions (test-bed uses various frameworks intentionally)
const EXEMPT_PACKAGES = new Set(['extractors-test-bed']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getPackageDirs(): string[] {
  const packagesDir = join(PROJECT_ROOT, 'packages');
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b));
}

function walkDirectory(
  dir: string,
  relativePath: string,
  handler: (entry: { name: string; fullPath: string; relPath: string; isDir: boolean }) => void,
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = join(relativePath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      handler({ name: entry.name, fullPath, relPath, isDir: true });
      walkDirectory(fullPath, relPath, handler);
    } else if (entry.isFile()) {
      handler({ name: entry.name, fullPath, relPath, isDir: false });
    }
  }
}

/**
 * Record violations for a rule into a CategoryResult
 */
function recordViolations(
  result: CategoryResult,
  violations: string[],
  rule: string,
  message: string,
  severity: 'error' | 'warning' = 'error',
): void {
  if (violations.length > 0) {
    for (const v of violations) {
      result.errors.push({ rule, path: v, message, severity });
    }
    result.failed++;
  } else {
    result.passed++;
  }
}

function getTsconfigCompilerOption(filePath: string, option: string): unknown {
  const tsconfig = readJson(filePath);
  if (!tsconfig) return undefined;
  const opts = tsconfig['compilerOptions'] as Record<string, unknown> | undefined;
  return opts?.[option];
}

// ─── Build System Rules ──────────────────────────────────────────────────────

function findCompositeViolations(packages: string[]): string[] {
  const violations: string[] = [];

  if (getTsconfigCompilerOption(join(PROJECT_ROOT, TSCONFIG_FILENAME), 'composite') === true) {
    violations.push(TSCONFIG_FILENAME);
  }
  if (getTsconfigCompilerOption(join(PROJECT_ROOT, 'tsconfig.base.json'), 'composite') === true) {
    violations.push('tsconfig.base.json');
  }

  for (const pkg of packages) {
    const path = join(PROJECT_ROOT, 'packages', pkg, TSCONFIG_FILENAME);
    if (getTsconfigCompilerOption(path, 'composite') === true) {
      violations.push(`packages/${pkg}/${TSCONFIG_FILENAME}`);
    }
  }

  return violations;
}

function findTsBuildInfoViolations(): string[] {
  const violations: string[] = [];
  walkDirectory(PROJECT_ROOT, '.', ({ name, relPath, isDir }) => {
    if (!isDir && name.endsWith('.tsbuildinfo')) {
      violations.push(relPath);
    }
  });
  return violations;
}

function findTsconfigExtendsViolations(packages: string[]): string[] {
  const violations: string[] = [];
  for (const pkg of packages) {
    const tsconfigPath = join(PROJECT_ROOT, 'packages', pkg, TSCONFIG_FILENAME);
    const tsconfig = readJson(tsconfigPath);
    if (!tsconfig) continue;

    const extendsValue = tsconfig['extends'] as string | undefined;
    if (extendsValue !== `../../${TSCONFIG_FILENAME}`) {
      const actual = extendsValue ? `extends "${extendsValue}"` : 'no extends';
      violations.push(`packages/${pkg}/${TSCONFIG_FILENAME} (${actual})`);
    }
  }
  return violations;
}

function findPerPackageCleanViolations(packages: string[]): string[] {
  const violations: string[] = [];
  for (const pkg of packages) {
    const pkgJson = readJson(join(PROJECT_ROOT, 'packages', pkg, PACKAGE_JSON_FILENAME));
    if (!pkgJson) continue;
    const scripts = pkgJson['scripts'] as Record<string, string> | undefined;
    if (scripts?.['clean']) {
      violations.push(`packages/${pkg}/${PACKAGE_JSON_FILENAME}`);
    }
  }
  return violations;
}

// ─── Category A: Build System Consistency ────────────────────────────────────

function validateBuildSystem(): CategoryResult {
  const result: CategoryResult = { name: 'BUILD SYSTEM', errors: [], passed: 0, failed: 0 };
  const packages = getPackageDirs();

  recordViolations(result, findCompositeViolations(packages),
    'no-composite', 'Remove composite:true — Turbo handles build caching, composite creates stale .tsbuildinfo bugs');

  recordViolations(result, findTsBuildInfoViolations(),
    'no-tsbuildinfo', 'Delete .tsbuildinfo files — these are build artifacts that cause stale cache bugs');

  recordViolations(result, findTsconfigExtendsViolations(packages),
    'tsconfig-extends-root', `Must extend "../../${TSCONFIG_FILENAME}" — no standalone configs duplicating compiler options`);

  recordViolations(result, findPerPackageCleanViolations(packages),
    'no-per-package-clean', 'Remove "clean" script — root handles clean centrally to prevent drift');

  return result;
}

// ─── Package Consistency Rules ──────────────────────────────────────────────

function validatePackageRule(
  packages: string[],
  rule: string,
  checker: (pkgJson: Record<string, unknown>, relPath: string) => string | null,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const pkg of packages) {
    const pkgJson = readJson(join(PROJECT_ROOT, 'packages', pkg, PACKAGE_JSON_FILENAME));
    if (!pkgJson) continue;
    const relPath = `packages/${pkg}/${PACKAGE_JSON_FILENAME}`;
    const message = checker(pkgJson, relPath);
    if (message) {
      errors.push({ rule, path: relPath, message, severity: 'error' });
    }
  }
  return errors;
}

// ─── Category B: Package.json Consistency ────────────────────────────────────

function validatePackageConsistency(): CategoryResult {
  const result: CategoryResult = { name: 'PACKAGE CONSISTENCY', errors: [], passed: 0, failed: 0 };
  const packages = getPackageDirs();
  const rootPkgJson = readJson(join(PROJECT_ROOT, PACKAGE_JSON_FILENAME));
  const rootVersion = rootPkgJson?.['version'] as string | undefined;

  const ruleChecks: Array<{ rule: string; checker: (pkg: Record<string, unknown>) => string | null }> = [
    {
      rule: 'type-module',
      checker: (pkg) => pkg['type'] === 'module' ? null : 'Must have "type": "module" — ESM everywhere',
    },
    {
      rule: 'engines-node',
      checker: (pkg) => {
        if (pkg['private'] === true) return null;
        const engines = pkg['engines'] as Record<string, string> | undefined;
        return engines?.['node'] ? null : 'Must have engines.node >= 20.0.0';
      },
    },
    {
      rule: 'publish-config',
      checker: (pkg) => {
        if (pkg['private'] === true) return null;
        const publishConfig = pkg['publishConfig'] as Record<string, string> | undefined;
        return publishConfig?.['access'] === 'public'
          ? null
          : 'Must have publishConfig.access: "public" — prevent accidental restricted publish';
      },
    },
    {
      rule: 'version-sync',
      checker: (pkg) => {
        if (pkg['private'] === true || !rootVersion) return null;
        const pkgVersion = pkg['version'] as string | undefined;
        return (pkgVersion && pkgVersion !== rootVersion)
          ? `Version ${pkgVersion} doesn't match root ${rootVersion} — run pnpm bump-version`
          : null;
      },
    },
  ];

  for (const { rule, checker } of ruleChecks) {
    const errors = validatePackageRule(packages, rule, (pkg) => checker(pkg));
    result.errors.push(...errors);
    if (errors.length > 0) result.failed++;
    else result.passed++;
  }

  return result;
}

// ─── Source Convention Checks ────────────────────────────────────────────────

function isInExemptPackage(normalizedPath: string): boolean {
  const pkgMatch = /^packages\/([^/]+)\//.exec(normalizedPath);
  return pkgMatch ? EXEMPT_PACKAGES.has(pkgMatch[1]) : false;
}

function checkSpecFile(name: string, relPath: string, normalizedPath: string, errors: ValidationError[]): void {
  if (name.endsWith('.spec.ts') && !isInExemptPackage(normalizedPath)) {
    errors.push({
      rule: 'no-spec-ts',
      path: relPath,
      message: 'Use .test.ts instead of .spec.ts for consistency',
      severity: 'error',
    });
  }
}

const ALLOWED_ROOT_TS_FILES = new Set([
  'eslint.config.ts',
  'vitest.config.ts',
  'vitest.config.integration.ts',
]);

const ALLOWED_NONSTANDARD_TS_FILES = new Set([
  '.github/vitest.setup.ts',
]);

function checkSourceLocation(name: string, relPath: string, normalizedPath: string, errors: ValidationError[]): void {
  if (!name.endsWith('.ts') || name.endsWith('.d.ts') || isInExemptPackage(normalizedPath)) return;
  if (ALLOWED_ROOT_TS_FILES.has(normalizedPath)) return;
  if (ALLOWED_NONSTANDARD_TS_FILES.has(normalizedPath)) return;
  if (/^packages\/[^/]+\/vitest\..*config.*\.ts$/.test(normalizedPath)) return;
  if (/^packages\/[^/]+\/[^/]+\.ts$/.test(normalizedPath)) return;

  const isInSrc = /^packages\/[^/]+\/src\//.test(normalizedPath);
  const isInTest = /^packages\/[^/]+\/test\//.test(normalizedPath);
  const isInScripts = /^packages\/[^/]+\/scripts\//.test(normalizedPath);

  if (!isInSrc && !isInTest && !isInScripts) {
    errors.push({
      rule: 'source-location',
      path: relPath,
      message: 'TypeScript files must be in packages/*/src/, packages/*/test/, or packages/*/scripts/',
      severity: 'error',
    });
  }
}

function checkNestedPackageJson(name: string, relPath: string, normalizedPath: string, errors: ValidationError[]): void {
  if (name !== PACKAGE_JSON_FILENAME) return;
  const isRoot = normalizedPath === PACKAGE_JSON_FILENAME;
  const isPackageRoot = /^packages\/[^/]+\/package\.json$/.test(normalizedPath);
  const isInFixtures = /^packages\/[^/]+\/test\/fixtures\//.test(normalizedPath);

  if (!isRoot && !isPackageRoot && !isInFixtures) {
    errors.push({
      rule: 'no-nested-package-json',
      path: relPath,
      message: 'Nested package.json detected — only root and packages/*/ allowed',
      severity: 'error',
    });
  }
}

const FORBIDDEN_SHELL_EXTENSIONS = new Set(['.sh', '.ps1', '.bat', '.cmd']);

function checkShellScript(name: string, relPath: string, normalizedPath: string, errors: ValidationError[]): void {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  if (FORBIDDEN_SHELL_EXTENSIONS.has(ext) && !normalizedPath.startsWith('.husky/') && !isInExemptPackage(normalizedPath)) {
    errors.push({
      rule: 'no-shell-scripts',
      path: relPath,
      message: 'Shell scripts forbidden — use TypeScript for automation',
      severity: 'error',
    });
  }
}

// ─── Category C: Source File Conventions ──────────────────────────────────────

function validateSourceConventions(): CategoryResult {
  const result: CategoryResult = { name: 'SOURCE CONVENTIONS', errors: [], passed: 0, failed: 0 };

  const specErrors: ValidationError[] = [];
  const locationErrors: ValidationError[] = [];
  const nestedPkgErrors: ValidationError[] = [];
  const shellErrors: ValidationError[] = [];

  walkDirectory(PROJECT_ROOT, '.', ({ name, relPath, isDir }) => {
    if (isDir) return;
    const normalizedPath = relPath.replaceAll('\\', '/');

    checkSpecFile(name, relPath, normalizedPath, specErrors);
    checkSourceLocation(name, relPath, normalizedPath, locationErrors);
    checkNestedPackageJson(name, relPath, normalizedPath, nestedPkgErrors);
    checkShellScript(name, relPath, normalizedPath, shellErrors);
  });

  for (const errors of [specErrors, locationErrors, nestedPkgErrors, shellErrors]) {
    result.errors.push(...errors);
    if (errors.length > 0) result.failed++;
    else result.passed++;
  }

  return result;
}

// ─── Security Checks ────────────────────────────────────────────────────────

const FORBIDDEN_FILES = new Set(['.env', '.env.local', '.env.production', 'credentials.json']);
const FORBIDDEN_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);
const FORBIDDEN_PREFIXES = ['service-account'];

function checkSecretFile(name: string, relPath: string, normalizedPath: string, errors: ValidationError[]): void {
  if (normalizedPath.includes('/test/fixtures/')) return;

  if (FORBIDDEN_FILES.has(name)) {
    errors.push({ rule: RULE_NO_SECRETS, path: relPath, message: 'Secret/credential file detected — must never be committed', severity: 'error' });
    return;
  }

  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    errors.push({ rule: RULE_NO_SECRETS, path: relPath, message: 'Certificate/key file detected — must never be committed', severity: 'error' });
    return;
  }

  for (const prefix of FORBIDDEN_PREFIXES) {
    if (name.toLowerCase().startsWith(prefix)) {
      errors.push({ rule: RULE_NO_SECRETS, path: relPath, message: 'Service account file detected — must never be committed', severity: 'error' });
      return;
    }
  }
}

// ─── Category D: Security ────────────────────────────────────────────────────

function validateSecurity(): CategoryResult {
  const result: CategoryResult = { name: 'SECURITY', errors: [], passed: 0, failed: 0 };

  walkDirectory(PROJECT_ROOT, '.', ({ name, relPath, isDir }) => {
    if (isDir) return;
    const normalizedPath = relPath.replaceAll('\\', '/');
    checkSecretFile(name, relPath, normalizedPath, result.errors);
  });

  if (result.errors.length === 0) result.passed++;
  else result.failed++;

  return result;
}

// ─── Category E: Turbo/Build Alignment ───────────────────────────────────────

function validateTurboAlignment(): CategoryResult {
  const result: CategoryResult = { name: 'TURBO ALIGNMENT', errors: [], passed: 0, failed: 0 };

  const turboJson = readJson(join(PROJECT_ROOT, 'turbo.json'));
  if (turboJson) {
    const tasks = turboJson['tasks'] as Record<string, unknown> | undefined;
    if (tasks?.['clean']) {
      result.errors.push({
        rule: 'no-turbo-clean',
        path: 'turbo.json',
        message: 'Remove "clean" task — clean is centralized in root package.json, not per-package via Turbo',
        severity: 'error',
      });
      result.failed++;
    } else {
      result.passed++;
    }
  } else {
    result.passed++;
  }

  return result;
}

// ─── Output ──────────────────────────────────────────────────────────────────

function printCategoryResult(cat: CategoryResult): void {
  console.log(`\n${colors.cyan}${cat.name}:${colors.reset}`);

  if (cat.errors.length === 0) {
    console.log(`  ${colors.green}All ${cat.passed} checks passed${colors.reset}`);
    return;
  }

  const byRule = new Map<string, ValidationError[]>();
  for (const err of cat.errors) {
    const list = byRule.get(err.rule) ?? [];
    list.push(err);
    byRule.set(err.rule, list);
  }

  for (const [, ruleErrors] of byRule) {
    for (const err of ruleErrors) {
      const icon = err.severity === 'error' ? `${colors.red}✗${colors.reset}` : `${colors.yellow}⚠${colors.reset}`;
      console.log(`  ${icon} ${err.path}`);
      console.log(`    ${err.message}`);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('🔍 Validating repository structure...');

  const categories = [
    validateBuildSystem(),
    validatePackageConsistency(),
    validateSourceConventions(),
    validateSecurity(),
    validateTurboAlignment(),
  ];

  for (const cat of categories) {
    printCategoryResult(cat);
  }

  const totalErrors = categories.reduce((sum, cat) => sum + cat.errors.filter(e => e.severity === 'error').length, 0);
  const totalWarnings = categories.reduce((sum, cat) => sum + cat.errors.filter(e => e.severity === 'warning').length, 0);
  const totalPassed = categories.reduce((sum, cat) => sum + cat.passed, 0);

  console.log('');

  if (totalErrors === 0 && totalWarnings === 0) {
    log(`✅ Repository structure validation passed! (${totalPassed} checks)`, 'green');
  } else if (totalErrors === 0) {
    log(`⚠️  Repository structure validation passed with ${totalWarnings} warnings`, 'yellow');
  } else {
    log(`❌ Repository structure validation failed: ${totalErrors} errors, ${totalWarnings} warnings`, 'red');
    process.exit(1);
  }
}

main();

export { main as validate, type ValidationError };
