#!/usr/bin/env node
/**
 * Sandbox Performance & Security Benchmark
 *
 * Compares three approaches for running extractor plugins:
 * 1. worker_threads (Node.js native)
 * 2. isolated-vm (V8 isolates)
 * 3. No sandbox (baseline)
 *
 * Tests performance with realistic extractor workload and security boundaries.
 */

import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Sample test data (realistic Maven compiler error output)
const SAMPLE_INPUT = `[ERROR] COMPILATION ERROR :
[INFO] -------------------------------------------------------------
[ERROR] /src/main/java/com/example/App.java:[15,20] cannot find symbol
  symbol:   variable undeclaredVar
  location: class com.example.App
[ERROR] /src/main/java/com/example/Utils.java:[42,8] incompatible types: int cannot be converted to String
[INFO] 2 errors
[INFO] -------------------------------------------------------------`;

// Realistic extractor function (similar to maven-compiler) - kept for future benchmarking work
const _extractorCode = `
function extractErrors(content) {
  const errors = [];
  const pattern = /\\[ERROR\\]\\s+([^:]+):\\[([0-9]+),([0-9]+)\\]\\s+(.+)/g;

  let match;
  while ((match = pattern.exec(content)) !== null) {
    errors.push({
      file: match[1].trim(),
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      message: match[4].trim(),
      severity: 'error'
    });
  }

  return errors;
}

extractErrors(INPUT_DATA);
`;

// Security test payloads (should be blocked)
const SECURITY_TESTS = [
  {
    name: 'Process access',
    code: `process.exit(1);`,
    shouldFail: true
  },
  {
    name: 'Filesystem access',
    code: `require('fs').readFileSync('/etc/passwd');`,
    shouldFail: true
  },
  {
    name: 'Child process',
    code: `require('child_process').execSync('ls -la');`,
    shouldFail: true
  },
  {
    name: 'Network access',
    code: `require('http').get('http://example.com');`,
    shouldFail: true
  },
  {
    name: 'Constructor escape',
    code: `this.constructor.constructor('return process')().exit(1);`,
    shouldFail: true
  }
];

/**
 * Baseline: No sandbox (direct execution)
 */
async function benchmarkNoSandbox(iterations = 1000) {
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    // Simulate extractor execution
    const errors = [];
    const pattern = /\[ERROR\]\s+([^:]+):\[([0-9]+),([0-9]+)\]\s+(.+)/g;

    let match;
    while ((match = pattern.exec(SAMPLE_INPUT)) !== null) {
      errors.push({
        file: match[1].trim(),
        line: Number.parseInt(match[2], 10),
        column: Number.parseInt(match[3], 10),
        message: match[4].trim(),
        severity: 'error'
      });
    }
  }

  const duration = performance.now() - start;
  return {
    approach: 'No Sandbox (Baseline)',
    iterations,
    totalMs: duration,
    avgMs: duration / iterations,
    throughput: (iterations / duration) * 1000
  };
}

/**
 * Worker Threads: Run in separate thread
 * Note: Worker creation has significant overhead, so we reuse workers
 */
async function benchmarkWorkerThreads(iterations = 1000) {
  const workerCode = `
    const { parentPort, workerData } = require('worker_threads');

    function extractErrors(content) {
      const errors = [];
      const pattern = /\\[ERROR\\]\\s+([^:]+):\\[([0-9]+),([0-9]+)\\]\\s+(.+)/g;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        errors.push({
          file: match[1].trim(),
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          message: match[4].trim(),
          severity: 'error'
        });
      }

      return errors;
    }

    // Process initial workerData
    const result = extractErrors(workerData.input);
    parentPort.postMessage({ result });

    // Listen for additional messages
    parentPort.on('message', (data) => {
      const result = extractErrors(data.input);
      parentPort.postMessage({ result });
    });
  `;

  const start = performance.now();

  // Create one worker and reuse it for all iterations
  const worker = new Worker(workerCode, {
    eval: true,
    workerData: { input: SAMPLE_INPUT }
  });

  let completed = 0;
  const targetCompleted = iterations;

  const promise = new Promise((resolve, reject) => {
    worker.on('message', () => {
      completed++;
      if (completed >= targetCompleted) {
        worker.terminate();
        resolve();
      } else if (completed < targetCompleted) {
        // Send next task
        worker.postMessage({ input: SAMPLE_INPUT });
      }
    });

    worker.on('error', reject);
  });

  await promise;

  const duration = performance.now() - start;
  return {
    approach: 'Worker Threads',
    iterations,
    totalMs: duration,
    avgMs: duration / iterations,
    throughput: (iterations / duration) * 1000,
    note: 'Reused single worker for all iterations'
  };
}

/**
 * Isolated-VM: V8 Isolate
 */
async function benchmarkIsolatedVM(iterations = 1000) {
  let ivm;
  try {
    ivm = require('isolated-vm');
  } catch (_err) {
    return {
      approach: 'Isolated-VM',
      error: 'Package not installed (run: pnpm add -Dw isolated-vm)',
      skipped: true
    };
  }

  const start = performance.now();

  // Create isolate once (reuse across iterations)
  const isolate = new ivm.Isolate({ memoryLimit: 128 });
  const context = isolate.createContextSync();

  // Compile extractor function once
  const script = isolate.compileScriptSync(`
    function extractErrors(content) {
      const errors = [];
      const pattern = /\\[ERROR\\]\\s+([^:]+):\\[([0-9]+),([0-9]+)\\]\\s+(.+)/g;

      let match;
      while ((match = pattern.exec(content)) !== null) {
        errors.push({
          file: match[1].trim(),
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          message: match[4].trim(),
          severity: 'error'
        });
      }

      return errors;
    }

    extractErrors;
  `);

  script.runSync(context);

  // Run iterations
  for (let i = 0; i < iterations; i++) {
    context.global.setSync('input', new ivm.ExternalCopy(SAMPLE_INPUT).copyInto());

    const result = context.evalSync('JSON.stringify(extractErrors(input))');
    const _errors = JSON.parse(result);
  }

  isolate.dispose();

  const duration = performance.now() - start;
  return {
    approach: 'Isolated-VM',
    iterations,
    totalMs: duration,
    avgMs: duration / iterations,
    throughput: (iterations / duration) * 1000,
    memoryLimit: '128MB'
  };
}

/**
 * Security boundary tests
 */
async function testSecurityBoundaries() {
  console.log('\n=== Security Boundary Tests ===\n');

  const results = {
    'No Sandbox': [],
    'Worker Threads': [],
    'Isolated-VM': []
  };

  // Test no sandbox (all attacks succeed)
  for (const test of SECURITY_TESTS) {
    try {
      eval(test.code);
      results['No Sandbox'].push({ test: test.name, blocked: false });
    } catch (err) {
      results['No Sandbox'].push({ test: test.name, blocked: true, reason: err.message });
    }
  }

  // Test worker threads (limited protection)
  for (const test of SECURITY_TESTS) {
    try {
      await new Promise((resolve, _reject) => {
        const worker = new Worker(`
          const { parentPort } = require('worker_threads');
          try {
            ${test.code}
            parentPort.postMessage({ success: true });
          } catch (_err) {
            parentPort.postMessage({ error: err.message });
          }
        `, { eval: true });

        worker.on('message', (msg) => {
          worker.terminate();
          if (msg.error) {
            results['Worker Threads'].push({ test: test.name, blocked: true, reason: msg.error });
          } else {
            results['Worker Threads'].push({ test: test.name, blocked: false });
          }
          resolve();
        });

        worker.on('error', (err) => {
          worker.terminate();
          results['Worker Threads'].push({ test: test.name, blocked: true, reason: err.message });
          resolve();
        });
      });
    } catch (err) {
      results['Worker Threads'].push({ test: test.name, blocked: true, reason: err.message });
    }
  }

  // Test isolated-vm (strong protection)
  let ivm;
  try {
    ivm = require('isolated-vm');

    for (const test of SECURITY_TESTS) {
      try {
        const isolate = new ivm.Isolate({ memoryLimit: 128 });
        const context = await isolate.createContext();

        await context.eval(test.code, { timeout: 100 });

        isolate.dispose();
        results['Isolated-VM'].push({ test: test.name, blocked: false });
      } catch (err) {
        results['Isolated-VM'].push({ test: test.name, blocked: true, reason: err.message });
      }
    }
  } catch (_err) {
    results['Isolated-VM'] = [{ error: 'isolated-vm not installed' }];
  }

  return results;
}

/**
 * Main benchmark runner
 */
async function main() {
  console.log('=== Sandbox Performance Benchmark ===\n');
  console.log('Running extractor workload (Maven compiler error extraction)\n');

  const iterations = 1000;

  // Performance benchmarks
  console.log('--- Performance Tests ---\n');

  const noSandbox = await benchmarkNoSandbox(iterations);
  console.log(`${noSandbox.approach}:`);
  console.log(`  Total: ${noSandbox.totalMs.toFixed(2)}ms`);
  console.log(`  Avg: ${noSandbox.avgMs.toFixed(4)}ms per call`);
  console.log(`  Throughput: ${noSandbox.throughput.toFixed(0)} ops/sec\n`);

  const workerThreads = await benchmarkWorkerThreads(iterations);
  console.log(`${workerThreads.approach}:`);
  if (workerThreads.note) console.log(`  Note: ${workerThreads.note}`);
  console.log(`  Total: ${workerThreads.totalMs.toFixed(2)}ms`);
  console.log(`  Avg: ${workerThreads.avgMs.toFixed(4)}ms per call`);
  console.log(`  Throughput: ${workerThreads.throughput.toFixed(0)} ops/sec`);
  console.log(`  Overhead: ${((workerThreads.avgMs / noSandbox.avgMs - 1) * 100).toFixed(1)}%\n`);

  const isolatedVM = await benchmarkIsolatedVM(iterations);
  console.log(`${isolatedVM.approach}:`);
  if (isolatedVM.skipped) {
    console.log(`  ⚠️  ${isolatedVM.error}\n`);
  } else {
    console.log(`  Total: ${isolatedVM.totalMs.toFixed(2)}ms`);
    console.log(`  Avg: ${isolatedVM.avgMs.toFixed(4)}ms per call`);
    console.log(`  Throughput: ${isolatedVM.throughput.toFixed(0)} ops/sec`);
    console.log(`  Overhead: ${((isolatedVM.avgMs / noSandbox.avgMs - 1) * 100).toFixed(1)}%\n`);
  }

  // Security tests
  const securityResults = await testSecurityBoundaries();

  console.log('\n--- Security Boundary Results ---\n');
  for (const [approach, tests] of Object.entries(securityResults)) {
    console.log(`${approach}:`);
    if (tests[0]?.error) {
      console.log(`  ⚠️  ${tests[0].error}\n`);
      continue;
    }

    const blocked = tests.filter(t => t.blocked).length;
    const total = tests.length;
    console.log(`  Blocked: ${blocked}/${total} attacks`);

    for (const t of tests) {
      const icon = t.blocked ? '✅' : '❌';
      console.log(`  ${icon} ${t.test}${t.reason ? ` (${t.reason.slice(0, 50)}...)` : ''}`);
    }
    console.log();
  }

  // Summary
  console.log('\n=== Recommendation ===\n');
  console.log('Based on security and performance trade-offs:\n');
  console.log('1. ❌ No Sandbox: Fast but UNSAFE for untrusted code');
  console.log('2. ⚠️  Worker Threads: Some isolation, but NOT a security boundary');
  console.log('3. ✅ Isolated-VM: True security isolation with acceptable overhead\n');
  console.log('For vibe-validate plugin system: Use isolated-vm for external plugins.\n');
  console.log('Built-in extractors can optionally run unsandboxed (trusted code).\n');
}

main().catch(console.error);
