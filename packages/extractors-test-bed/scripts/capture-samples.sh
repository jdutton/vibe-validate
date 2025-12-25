#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════════════════"
echo "Capturing Test Framework Output Samples"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "This script runs intentionally failing tests and captures their output"
echo "for use in testing error extractors."
echo ""

cd "$(dirname "$0")/.."

# Create sample directories if they don't exist
mkdir -p ../extractors/test/samples/jest
mkdir -p ../extractors/test/samples/vitest
mkdir -p ../extractors/test/samples/mocha
mkdir -p junit-output

# Jest - Text Output
echo "📝 Capturing Jest text output..."
npm run test:jest 2>&1 | tee ../extractors/test/samples/jest/extraction-test-bed.txt || true
echo "✅ Saved to: ../extractors/test/samples/jest/extraction-test-bed.txt"
echo ""

# Jest - JUnit XML
echo "📄 Capturing Jest JUnit XML..."
npm run test:jest:junit || true
if [[ -f junit-output/junit.xml ]]; then
  cp junit-output/junit.xml ../extractors/test/samples/jest/extraction-test-bed.junit.xml
  echo "✅ Saved to: ../extractors/test/samples/jest/extraction-test-bed.junit.xml"
else
  echo "⚠️  JUnit XML not found at junit-output/junit.xml"
fi
echo ""

# Vitest - Text Output
echo "📝 Capturing Vitest text output..."
npm run test:vitest 2>&1 | tee ../extractors/test/samples/vitest/extraction-test-bed.txt || true
echo "✅ Saved to: ../extractors/test/samples/vitest/extraction-test-bed.txt"
echo ""

# Vitest - JUnit XML
echo "📄 Capturing Vitest JUnit XML..."
npm run test:vitest:junit || true
if [[ -f junit-output/vitest-results.xml ]]; then
  cp junit-output/vitest-results.xml ../extractors/test/samples/vitest/extraction-test-bed.junit.xml
  echo "✅ Saved to: ../extractors/test/samples/vitest/extraction-test-bed.junit.xml"
else
  echo "⚠️  JUnit XML not found at junit-output/vitest-results.xml"
fi
echo ""

echo "═══════════════════════════════════════════════════════════════════"
echo "Sample Capture Complete!"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Review samples in packages/extractors/test/samples/"
echo "  2. Test extractors: cd ../extractors && npm test"
echo "  3. Run baseline test: npx tsx test-generic-baseline.ts"
echo ""
