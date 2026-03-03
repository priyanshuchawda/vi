# Security Policy

## Supported Versions

Security fixes are applied to the latest `main` branch and latest production
release. Older releases may not receive patches.

## Reporting a Vulnerability

Do not open public GitHub issues for security vulnerabilities.

Use GitHub private vulnerability reporting:

1. Go to the repository `Security` tab.
2. Click `Report a vulnerability`.
3. Provide impact, reproduction steps, and suggested remediation.

If private reporting is unavailable, contact the maintainers directly and
include:

- vulnerability type and affected surface (`main`, `preload`, `renderer`, IPC
  channel)
- reproduction steps and proof of concept
- estimated impact and attack prerequisites

## Disclosure Process

1. Triage and acknowledgment within 72 hours.
2. Reproduce and validate severity.
3. Prepare and test a fix.
4. Coordinate disclosure and release notes after patch availability.

## Security Expectations for Contributions

Contributions should preserve Electron security posture:

- `contextIsolation: true`
- `nodeIntegration: false`
- no `eval` or remote code execution patterns
- validated IPC payloads on both preload and main sides
- principle of least privilege for file system and OS access
