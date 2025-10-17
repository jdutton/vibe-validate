#!/usr/bin/env bash
#
# Pre-Publish Validation Check
#
# This script ensures the repository is in a publishable state:
# 1. No uncommitted changes (clean working tree)
# 2. No untracked files (except allowed patterns)
# 3. All validation checks pass
# 4. On main branch (or explicitly allow other branches)
#
# Usage:
#   ./tools/pre-publish-check.sh [--allow-branch BRANCH]
#
# Exit codes:
#   0 - Ready to publish
#   1 - Not ready (with explanation)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ALLOWED_BRANCH="main"
ALLOW_CUSTOM_BRANCH=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --allow-branch)
      ALLOWED_BRANCH="$2"
      ALLOW_CUSTOM_BRANCH=true
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--allow-branch BRANCH]"
      exit 1
      ;;
  esac
done

echo "🔍 Pre-Publish Validation Check"
echo "================================"
echo ""

# Check 1: Git repository exists
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo -e "${RED}✗ Not a git repository${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Git repository detected${NC}"

# Check 2: Current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "$ALLOWED_BRANCH" ]]; then
  if [[ "$ALLOW_CUSTOM_BRANCH" == "false" ]]; then
    echo -e "${RED}✗ Not on main branch (current: $CURRENT_BRANCH)${NC}"
    echo "  Tip: Run 'git checkout main' or use --allow-branch flag"
    exit 1
  else
    echo -e "${YELLOW}⚠ On branch: $CURRENT_BRANCH (explicitly allowed)${NC}"
  fi
else
  echo -e "${GREEN}✓ On main branch${NC}"
fi

# Check 3: Working tree is clean
if ! git diff-index --quiet HEAD --; then
  echo -e "${RED}✗ Uncommitted changes detected${NC}"
  echo ""
  git status --short
  echo ""
  echo "  Please commit or stash your changes before publishing"
  exit 1
fi
echo -e "${GREEN}✓ No uncommitted changes${NC}"

# Check 4: No untracked files (except common patterns)
UNTRACKED=$(git ls-files --others --exclude-standard)
if [[ -n "$UNTRACKED" ]]; then
  # Filter out allowed patterns
  FILTERED=$(echo "$UNTRACKED" | grep -v -E '(node_modules|dist|\.DS_Store|\.vibe-validate-state\.yaml|TODO\.md)' || true)
  if [[ -n "$FILTERED" ]]; then
    echo -e "${RED}✗ Untracked files detected${NC}"
    echo ""
    echo "$FILTERED"
    echo ""
    echo "  Please add these files to git or .gitignore before publishing"
    exit 1
  fi
fi
echo -e "${GREEN}✓ No untracked files${NC}"

# Check 5: Run validation
echo ""
echo "Running validation checks..."
if ! pnpm validate; then
  echo ""
  echo -e "${RED}✗ Validation failed${NC}"
  echo "  Check the output above and fix all issues before publishing"
  exit 1
fi
echo -e "${GREEN}✓ All validation checks passed${NC}"

# Check 6: Packages are built
echo ""
echo "Checking package builds..."
MISSING_BUILDS=""
for pkg in packages/*/; do
  if [[ ! -d "${pkg}dist" ]]; then
    MISSING_BUILDS+="${pkg}\n"
  fi
done

if [[ -n "$MISSING_BUILDS" ]]; then
  echo -e "${RED}✗ Missing build outputs${NC}"
  echo -e "$MISSING_BUILDS"
  echo "  Run 'pnpm build' to build all packages"
  exit 1
fi
echo -e "${GREEN}✓ All packages built${NC}"

# Success!
echo ""
echo -e "${GREEN}✅ Repository is ready to publish!${NC}"
echo ""
echo "Next steps:"
echo "  1. Update package versions: pnpm version:patch (or minor/major)"
echo "  2. Commit version changes: git commit -am 'Release vX.Y.Z'"
echo "  3. Create git tag: git tag -a vX.Y.Z -m 'Release vX.Y.Z'"
echo "  4. Push to GitHub: git push origin main --tags"
echo "  5. Publish to npm: pnpm publish:all"
echo ""

exit 0
