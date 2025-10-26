/**
 * Playwright Comprehensive Failures Test
 *
 * This test file intentionally contains FAILING tests to generate sample output
 * for the Playwright extractor. DO NOT FIX THESE TESTS.
 *
 * Test-bed is excluded from main workspace to prevent validation failures.
 */

import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use file:// protocol to load static HTML (no server needed)
const TEST_APP_PATH = `file://${join(__dirname, '../../static/test-app.html')}`;

test.describe('Playwright Vibe-Validate Integration Failures', () => {

  test.describe('Extractors', () => {

    // 1. Basic Assertion Error
    test('should fail with assertion error (toBe)', async ({ page }) => {
      await page.goto(TEST_APP_PATH);
      const title = await page.textContent('h1');
      expect(title).toBe('Wrong Title'); // Intentional failure
    });

    // 2. Assertion Error with toContain
    test('should fail with assertion error (toContain)', async ({ page }) => {
      await page.goto(TEST_APP_PATH);
      const text = await page.textContent('#textElement');
      expect(text).toContain('Unexpected Content'); // Intentional failure
    });

    // 3. Element Not Found Error
    test('should fail when element not found', async ({ page }) => {
      await page.goto(TEST_APP_PATH);
      await page.click('#nonexistentButton'); // Element doesn't exist
    });

    // 4. Visibility Assertion Failure
    test('should fail with visibility assertion', async ({ page }) => {
      await page.goto(TEST_APP_PATH);
      // Hidden element should not be visible
      await expect(page.locator('#hiddenElement')).toBeVisible(); // Intentional failure
    });

    // 5. Timeout Error
    test('should fail with timeout', async ({ page }) => {
      test.setTimeout(2000); // Set very short timeout
      await page.goto(TEST_APP_PATH);
      await page.click('#timeoutBtn');
      // This will take 5 seconds but we only allow 2 seconds
      await page.waitForSelector('#output:has-text("Finally done!")'); // Will timeout
    });

    // 6. Text Content Mismatch
    test('should fail with text content mismatch', async ({ page }) => {
      await page.goto(TEST_APP_PATH);
      await page.click('#clickBtn');
      const output = await page.textContent('#output');
      expect(output).toBe('Wrong text'); // Intentional failure
    });

    // 7. Multiple Assertions (first passes, second fails)
    test('should fail with multiple assertions', async ({ page }) => {
      await page.goto(TEST_APP_PATH);
      const title = await page.textContent('h1');
      expect(title).toContain('Playwright'); // This passes
      expect(title).toBe('Completely Wrong'); // This fails
    });

    // 8. Navigation Error
    test('should fail with navigation error', async ({ page }) => {
      // Try to navigate to non-existent file
      await page.goto('file:///nonexistent/path/to/file.html');
    });

    // 9. Input Value Assertion Failure
    test('should fail with input value assertion', async ({ page }) => {
      await page.goto(TEST_APP_PATH);
      await page.fill('#testInput', 'test value');
      await expect(page.locator('#testInput')).toHaveValue('wrong value'); // Intentional failure
    });

    // 10. Count Assertion Failure
    test('should fail with count assertion', async ({ page }) => {
      await page.goto(TEST_APP_PATH);
      // There are only 4 buttons, but we expect 10
      await expect(page.locator('button')).toHaveCount(10); // Intentional failure
    });

  });

  test.describe('Nested Describe', () => {

    // 11. Nested test failure
    test('should fail in nested describe block', async ({ page }) => {
      await page.goto(TEST_APP_PATH);
      const output = await page.textContent('#visibleElement');
      expect(output).toBe('Wrong nested value'); // Intentional failure
    });

  });

});
