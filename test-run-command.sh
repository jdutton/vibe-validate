#!/bin/bash

# vibe-validate Run Command Test Script
# Tests caching, error extraction, exit codes, and cache invalidation

set +e  # Don't exit on error (we're testing failures)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  vibe-validate Run Command Test Suite${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Helper function to check test result
check_result() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"

  if [ "$expected" = "$actual" ]; then
    echo -e "${GREEN}✅ PASS${NC}: $test_name"
    ((PASS++))
  else
    echo -e "${RED}❌ FAIL${NC}: $test_name (expected: $expected, got: $actual)"
    ((FAIL++))
  fi
}

# Test 1: Cache Miss (First Run)
echo -e "${YELLOW}Test 1: Cache Miss (first run)${NC}"
START_TIME=$(date +%s%N)
OUTPUT=$(pnpm vibe-validate run "echo 'Test 1'" 2>&1)
END_TIME=$(date +%s%N)
DURATION=$(( (END_TIME - START_TIME) / 1000000 ))  # Convert to ms
EXIT_CODE=$(echo "$OUTPUT" | grep "exitCode:" | awk '{print $2}')
TOTAL_COUNT=$(echo "$OUTPUT" | grep "totalCount:" | awk '{print $2}')
echo "  Duration: ${DURATION}ms"
check_result "Cache miss exit code" "0" "$EXIT_CODE"
check_result "Cache miss totalCount" "0" "$TOTAL_COUNT"
echo ""

# Test 2: Cache Hit (Second Run)
echo -e "${YELLOW}Test 2: Cache Hit (second run - should be fast)${NC}"
START_TIME=$(date +%s%N)
OUTPUT=$(pnpm vibe-validate run "echo 'Test 1'" 2>&1)
END_TIME=$(date +%s%N)
DURATION=$(( (END_TIME - START_TIME) / 1000000 ))
EXIT_CODE=$(echo "$OUTPUT" | grep "exitCode:" | awk '{print $2}')
echo "  Duration: ${DURATION}ms"
check_result "Cache hit exit code" "0" "$EXIT_CODE"
if [ "$DURATION" -lt 500 ]; then
  echo -e "${GREEN}✅ PASS${NC}: Cache hit is fast (<500ms)"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}: Cache hit is slow (${DURATION}ms)"
  ((FAIL++))
fi
echo ""

# Test 3: --check Flag (Cached Command)
echo -e "${YELLOW}Test 3: --check flag on cached command${NC}"
pnpm vibe-validate run --check "echo 'Test 1'" > /dev/null 2>&1
CHECK_EXIT=$?
check_result "--check on cached command" "0" "$CHECK_EXIT"
echo ""

# Test 4: --check Flag (Non-Cached Command)
echo -e "${YELLOW}Test 4: --check flag on non-cached command${NC}"
pnpm vibe-validate run --check "echo 'Never executed $(date +%s)'" > /dev/null 2>&1
CHECK_EXIT=$?
check_result "--check on non-cached command" "1" "$CHECK_EXIT"
echo ""

# Test 5: --force Flag (Bypass Cache)
echo -e "${YELLOW}Test 5: --force flag bypasses cache${NC}"
START_TIME=$(date +%s%N)
OUTPUT=$(pnpm vibe-validate run --force "echo 'Test 1'" 2>&1)
END_TIME=$(date +%s%N)
DURATION=$(( (END_TIME - START_TIME) / 1000000 ))
echo "  Duration: ${DURATION}ms"
if [ "$DURATION" -gt 200 ]; then
  echo -e "${GREEN}✅ PASS${NC}: --force bypassed cache (took ${DURATION}ms)"
  ((PASS++))
else
  echo -e "${RED}❌ FAIL${NC}: --force might have used cache (only ${DURATION}ms)"
  ((FAIL++))
fi
echo ""

# Test 6: Failing Command Detection (totalCount = 1)
echo -e "${YELLOW}Test 6: Failing command detection${NC}"
OUTPUT=$(pnpm vibe-validate run "cd packages/extractors-test-bed && npx vitest tests/vitest/comprehensive-failures.test.ts --run" 2>&1)
EXIT_CODE=$(echo "$OUTPUT" | grep "exitCode:" | awk '{print $2}')
TOTAL_COUNT=$(echo "$OUTPUT" | grep "totalCount:" | awk '{print $2}')
check_result "Failing command exit code" "1" "$EXIT_CODE"
check_result "Failing command totalCount" "1" "$TOTAL_COUNT"
echo ""

# Test 7: Passing Command Detection (totalCount = 0)
echo -e "${YELLOW}Test 7: Passing command detection${NC}"
OUTPUT=$(pnpm vibe-validate run "pnpm lint" 2>&1)
EXIT_CODE=$(echo "$OUTPUT" | grep "exitCode:" | awk '{print $2}')
TOTAL_COUNT=$(echo "$OUTPUT" | grep "totalCount:" | awk '{print $2}')
check_result "Passing command exit code" "0" "$EXIT_CODE"
check_result "Passing command totalCount" "0" "$TOTAL_COUNT"
echo ""

# Test 8: Tree Hash Invalidation
echo -e "${YELLOW}Test 8: Tree hash invalidation${NC}"
echo "  Creating temp file to change tree hash..."
touch temp-invalidate-test.txt
pnpm vibe-validate run "echo 'Tree hash test'" > /dev/null 2>&1
echo "  Deleting temp file to change tree hash again..."
rm temp-invalidate-test.txt
pnpm vibe-validate run --check "echo 'Tree hash test'" > /dev/null 2>&1
CHECK_EXIT=$?
check_result "Cache invalidated after tree hash change" "1" "$CHECK_EXIT"
echo ""

# Test 9: Working Directory Caching
echo -e "${YELLOW}Test 9: Working directory caching${NC}"
pnpm vibe-validate run "echo 'Workdir test'" > /dev/null 2>&1
cd packages/cli
pnpm vibe-validate run --check "echo 'Workdir test'" > /dev/null 2>&1
CHECK_EXIT=$?
cd ../..
check_result "Different workdir creates separate cache" "1" "$CHECK_EXIT"
echo ""

# Test 10: Exit Code Propagation
echo -e "${YELLOW}Test 10: Exit code propagation${NC}"
pnpm vibe-validate run "exit 42" > /dev/null 2>&1
ACTUAL_EXIT=$?
check_result "Exit code 42 propagates" "42" "$ACTUAL_EXIT"
echo ""

# Test 11: Jest Failures
echo -e "${YELLOW}Test 11: Jest error extraction${NC}"
OUTPUT=$(pnpm vibe-validate run "cd packages/extractors-test-bed && npx jest tests/jest/comprehensive-failures.test.ts" 2>&1)
EXIT_CODE=$(echo "$OUTPUT" | grep "exitCode:" | awk '{print $2}')
TOTAL_COUNT=$(echo "$OUTPUT" | grep "totalCount:" | awk '{print $2}')
check_result "Jest failures exit code" "1" "$EXIT_CODE"
check_result "Jest failures totalCount" "1" "$TOTAL_COUNT"
echo ""

# Test 12: Calculator Tests (Should Pass)
echo -e "${YELLOW}Test 12: Vitest passing tests${NC}"
OUTPUT=$(pnpm vibe-validate run "cd packages/extractors-test-bed && npx vitest tests/vitest/calculator.test.ts --run" 2>&1)
EXIT_CODE=$(echo "$OUTPUT" | grep "exitCode:" | awk '{print $2}')
TOTAL_COUNT=$(echo "$OUTPUT" | grep "totalCount:" | awk '{print $2}')
check_result "Vitest passing exit code" "0" "$EXIT_CODE"
check_result "Vitest passing totalCount" "0" "$TOTAL_COUNT"
echo ""

# Summary
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Test Summary${NC}"
echo -e "${BLUE}================================================${NC}"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
TOTAL=$((PASS + FAIL))
echo "Total:  $TOTAL"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}🎉 All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
