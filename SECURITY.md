# Security Policy

Pipong is an API service for notifications built with Nitro v3 and h3. Report vulnerabilities privately rather than through a public issue so maintainers can investigate and coordinate a fix without exposing deployments.

## Supported Versions

Security fixes target the latest code on `main`. There is no long-term support branch or commitment to backport fixes to older tags. Deployments running a fork or an older commit should check whether a fix applies and update accordingly.

## Reporting a Vulnerability

**Do not open a public issue for a security vulnerability.** Use [GitHub Security Advisories](https://github.com/xcvzmoon/pipong/security/advisories/new) to report privately to the maintainers. If private reporting is unavailable, contact the [maintainer](https://github.com/xcvzmoon) through a private contact channel listed on their profile; do not post exploit details publicly.

A useful report includes:

- The affected component, such as an API handler in `apps/server/src/`, server configuration, dependencies, or build/CI tooling
- The affected version or commit
- Steps to reproduce, or a proof of concept
- The impact and any conditions required to trigger it
- Suggested remediation, if available

Remove credentials, tokens, and personal data from logs and examples unless they are essential to the private report.

### What to expect

- **Acknowledgment**: we aim to acknowledge reports within 3 business days.
- **Initial assessment**: we aim to provide an initial severity assessment within 5 business days.
- **Resolution timeline**: communicated after triage and based on severity; maintainers will keep you informed as the fix progresses.
- **Credit**: with your permission, we will credit you in the published advisory.

Allow a reasonable window to investigate and patch the issue before public disclosure. Avoid accessing, modifying, or exfiltrating data beyond what is necessary to demonstrate the vulnerability.

## Scope

In scope:

- Request validation, injection, or deserialization issues in Nitro/h3 handlers and other server code
- Notification handling that could expose sensitive data or permit unauthorized actions
- Exposure of environment configuration, credentials, tokens, or other secrets
- Dependency vulnerabilities with a realistic exploitation path through Pipong
- Build or CI vulnerabilities that could compromise the service or its release process

Out of scope:

- Upstream vulnerabilities with no realistic exploitation path through Pipong; report these to the upstream project
- Denial of service through sheer traffic volume against a deployer's infrastructure
- Issues requiring an already-compromised environment or credentials
- Deployment misconfiguration outside this repository
- Social engineering against maintainers or contributors

## Disclosure Policy

We follow coordinated disclosure. Once a fix is available, maintainers publish a GitHub Security Advisory describing the issue, its impact, and affected versions or commits. Pipong does not run a paid bug bounty program.
