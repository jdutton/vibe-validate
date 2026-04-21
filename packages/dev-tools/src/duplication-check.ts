#!/usr/bin/env tsx
/**
 * Wrapper script that runs jscpd-check-new.js.
 *
 * Windows support requires the pnpm patch at patches/@jscpd__finder@4.0.1.patch
 * (bypasses a realpathSync() call in @jscpd/finder that prevents output
 * generation on Windows — upstream unfixed, tracked at
 * https://github.com/kucherenko/jscpd/issues/143).
 */

await import('./jscpd-check-new.js');
