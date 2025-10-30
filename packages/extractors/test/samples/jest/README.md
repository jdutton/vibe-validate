# Jest Test Samples

## jest-monorepo-full-stderr.txt

**Source**: facebook/jest monorepo v30.2.0-dev  
**Date**: 2025-10-30  
**Size**: 1.7 MB, 28,227 lines  
**Platform**: macOS (darwin), Node.js v24.5.0

Real stderr output from Jest monorepo test run with 484 test suites, capturing:
- 3 intentional errors (formatTime.test.ts, clearCache.test.ts)
- 306 failing tests total
- Console.log pollution (2,215 occurrences)
- 108 snapshot failures
- Critical "Test Suites:" summary line
- ANSI color codes

**Critical for regression testing**:
- Jest detection (not Mocha) despite test names containing "passing"
- ● bullet marker detection without requiring spaces
- Test Suites: summary line parsing

**Usage**:
```bash
# Test detection
node -e "
const fs = require('fs');
const { autoDetectAndExtract } = require('../dist/smart-extractor.js');
const stderr = fs.readFileSync('./jest-monorepo-full-stderr.txt', 'utf8');
const result = autoDetectAndExtract('Run Tests', stderr);
console.log('Detected:', result.metadata?.detection?.extractor);
console.log('Errors:', result.errors?.length);
"
```

**Expected Results** (as of 2025-10-30 after bug fix #42):
- Detection: `jest` (confidence: 90)
- Patterns: `● bullet marker`, `Test Suites: summary`, `FAIL marker`, `PASS marker`
- Errors extracted: 1562

**Note**: This file is kept as raw stderr (not a YAML sample) because:
1. The Jest extractor needs improvement for complex multi-file output
2. Provides real-world baseline for future extractor improvements
3. Documents actual Jest monorepo output patterns
