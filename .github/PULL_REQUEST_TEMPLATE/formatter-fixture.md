## Fixture Contribution

<!-- Thank you for contributing test fixtures to improve vibe-validate's failure extraction! -->

### Fixture(s) Added

<!-- List the fixture file(s) you're adding -->

- [ ] `packages/formatters/test/fixtures/<tool>/<name>.yaml`

**Tool(s) covered:**
- <!-- e.g., vitest, typescript, eslint -->

**Difficulty level(s):**
- <!-- easy, medium, hard, very-hard -->

### Problem Being Solved

<!-- What extraction issue does this fixture address? Link to issue if applicable -->

Fixes #
Relates to #

**What was failing to extract:**
<!-- Describe the pattern that wasn't being extracted correctly -->

### Changes Made

- [ ] Added new fixture(s) with raw tool output
- [ ] Defined expected extraction in fixture
- [ ] Improved formatter to handle this pattern (if applicable)
- [ ] All fixture tests pass
- [ ] Quality score meets threshold for difficulty level

### Test Results

**Before this PR:**
```
<!-- Paste test output showing the issue, or "N/A - new fixture" -->
```

**After this PR:**
```
<!-- Paste output from `pnpm --filter @vibe-validate/formatters test` -->

✓ test/fixture-harness.test.ts
  ✓ <tool> formatter (X fixtures)
    Average Score: X.X%
    Passed: X/X
```

### Quality Report

<!-- Optional: Run `pnpm --filter @vibe-validate/formatters test:report` and paste relevant sections -->

```
Overall: X.X%
By tool:
  <your-tool>: X.X%
```

### Formatter Improvements (if any)

<!-- If you also improved the formatter code to handle this pattern -->

**Files modified:**
- `packages/formatters/src/<tool>-formatter.ts`

**Changes:**
-

### Real-World Context

**Where did you encounter this output?**
- <!-- e.g., "Vitest 3.2.0 with failing expect().toEqual() assertion" -->

**How common is this pattern?**
- [ ] Very common - happens frequently
- [ ] Common - happens occasionally
- [ ] Rare - specific edge case
- [ ] Unknown

### Validation

- [ ] `pnpm --filter @vibe-validate/formatters test` passes
- [ ] Fixture includes `$schema` reference for IDE support
- [ ] Fixture metadata is complete (tool, version, platform, difficulty)
- [ ] Expected output includes both detailed extraction AND `llmSummary`
- [ ] Quality score meets threshold (easy ≥90%, medium ≥75%, hard ≥60%, very-hard ≥40%)

### Documentation

- [ ] Fixture is properly documented with metadata
- [ ] Contributor name/username added to fixture metadata (optional)
- [ ] If this is a new tool, updated `FIXTURE_FORMAT.md` if needed

### Checklist

- [ ] I have searched for similar existing fixtures
- [ ] The fixture uses real tool output (not synthetic/made-up examples)
- [ ] I have tested locally and all formatter tests pass
- [ ] I followed the fixture format specification
- [ ] I'm willing to provide more examples if needed

---

## Recognition

Your contribution will be:
- ✅ Credited in fixture metadata
- ✅ Mentioned in CHANGELOG for significant improvements
- ✅ Listed in quality reports
- ✅ Appreciated by the community! 🙏

Thank you for making vibe-validate better!
