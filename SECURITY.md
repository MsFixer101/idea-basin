# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Idea Basin, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please open a private security advisory on GitHub or contact the maintainer directly.

You should receive a response within 48 hours. Please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Any potential impact

## Scope

Idea Basin is designed to run locally on your machine or over a private network (e.g., Tailscale). It is **not intended to be exposed to the public internet** without additional hardening.

Known security considerations:
- No built-in authentication (relies on network-level access control)
- API keys are encrypted in browser localStorage, not stored server-side
- File operations are scoped to user-configured directories

## Supported Versions

Only the latest version on the `main` branch is actively maintained.
