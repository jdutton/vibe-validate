# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.9.x   | :white_check_mark: |
| < 0.9   | :x:                |

**Note**: vibe-validate is currently in beta (0.9.x releases). We recommend always using the latest version for the most up-to-date security fixes.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report security vulnerabilities via email to:

**jeff.r.dutton@gmail.com**

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

### What to Include

Please include the following information in your report:

- Type of vulnerability (e.g., command injection, path traversal, etc.)
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

This information will help us triage your report more quickly.

## Security Response Timeline

1. **Initial Response**: Within 48 hours of report submission
2. **Triage**: Within 5 business days - we'll confirm the vulnerability and begin work on a fix
3. **Fix Development**: Depends on complexity, but we aim for < 2 weeks for critical issues
4. **Release**: Security patches are released as soon as possible after verification
5. **Disclosure**: Public disclosure after patch is released and users have had time to update

## Security Considerations

### Command Execution

vibe-validate executes user-defined commands from configuration files. Users should:

- Only use configuration files from trusted sources
- Review all `validateScript` commands before running validation
- Be cautious with third-party presets that execute arbitrary commands

### Git Operations

vibe-validate interacts with git repositories. Security features:

- All git branch names are sanitized to prevent command injection
- Git commands use array-based `spawn()` to avoid shell injection
- No arbitrary git commands are executed - only specific safe operations

### File System Access

vibe-validate reads and writes validation state files:

- State files are stored in `.vibe-validate-state.yaml` (git-ignored by default)
- No user credentials or secrets should be stored in state files
- State files may contain error output from validation commands

### Environment Variables

vibe-validate respects standard environment variables but does not:

- Execute code from environment variables
- Store secrets in environment variables
- Log environment variables to state files or logs

## Security Best Practices for Users

1. **Trust Your Configuration**: Only use configuration files from trusted sources
2. **Review Presets**: Examine preset configurations before using them
3. **Keep Updated**: Use the latest version of vibe-validate for security fixes
4. **Audit Commands**: Review all validation commands in your config
5. **Limit Scope**: Run validation in isolated environments (CI/CD, containers) when possible

## Known Security Limitations

- **User-Provided Commands**: vibe-validate executes commands defined in user configuration files. Users are responsible for ensuring these commands are safe.
- **Error Output**: Validation error output is embedded in state files. Ensure error messages don't contain sensitive information.
- **Git Repository Access**: vibe-validate requires read/write access to the git repository for tree hash calculations.

## Security Development Practices

We follow these practices during development:

- **Dependency Auditing**: Regular `pnpm audit` checks for vulnerable dependencies
- **Static Analysis**: ESLint with security-focused rules
- **Code Review**: All changes require review before merging
- **Automated Testing**: Comprehensive test suite including security-focused tests
- **Minimal Dependencies**: We minimize third-party dependencies to reduce attack surface

## Questions?

If you have questions about this security policy, please email jeff.r.dutton@gmail.com.
