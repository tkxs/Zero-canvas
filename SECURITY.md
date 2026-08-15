# Security Policy

## Supported Versions

USA零 is in active development. Security fixes are accepted for the
`main` branch and the latest tagged release. Older versions may be handled on a
best-effort basis.

## Reporting a Vulnerability

Please do not open a public issue with exploit details, credentials, private
API keys, proof-of-concept code, or screenshots that reveal sensitive data.

Preferred reporting channels:

1. Use GitHub private vulnerability reporting or a GitHub Security Advisory for
   this repository, if available.
2. If private reporting is unavailable, open a public issue that asks for a
   private contact channel and does not include technical exploit details.

Please include:

- Affected version, commit, branch, or deployment mode.
- Clear reproduction steps.
- Impact and attack scenario.
- Any relevant logs, screenshots, or proof of concept, with secrets removed.
- Whether the issue affects OAuth, official Keys, browser storage, WebDAV,
  plugins, hosted deployments, or network requests.

## Scope

### Official account credentials

Business pages are gated by USA0 OAuth Authorization Code with S256 PKCE. The
OAuth callback carries only `code`, `state`, or `error` results. The official
website Cookie is used only by the same-origin authorization page; the canvas
must never read or transmit it.

Complete official Keys are fetched after authorization and kept in runtime
memory only. They must never enter persisted configuration, imports or exports,
WebDAV data, logs, errors, the DOM, URLs, `postMessage`, `BroadcastChannel`, or
the plugin SDK. Each Key is an independent model source. Nodes and pending tasks
retain their exact `usa0-key-<Key ID>::<model name>` source and must fail rather
than fall back when that account or Key source is unavailable.

### Canvas node plugins

Third-party node plugins execute directly in the page context and therefore
require the same trust as other code installed into the application. Install
plugins only from sources you trust. The SDK exposes opaque source-qualified
model values and host-mediated generation methods, never complete official
Keys.

Reports **in scope** include the app loading or executing plugin code without
install confirmation, exposing complete official Keys through the SDK or other
listed surfaces, or allowing an unrelated origin to modify the plugin source
cache. A trusted plugin's ability to interact with ordinary page data is part
of the documented page-context execution model.

Examples of in-scope reports:

- Cross-site scripting or token exfiltration in the web app.
- Exposure of runtime-only official Keys or synced canvas data caused by project
  code.
- Unsafe file handling, import/export behavior, or WebDAV proxy behavior.
- Authentication, authorization, or access-control flaws in project-managed
  features.
- Supply-chain issues that are exploitable through this repository's shipped
  code or default configuration.

Examples that are usually out of scope:

- Vulnerabilities in third-party AI providers, model APIs, hosting platforms,
  or browser extensions outside this repository.
- Compromise of a user's own API key outside the app.
- Denial-of-service reports that require unrealistic traffic volume or physical
  access to the user's device.
- Missing security headers without a demonstrated exploit path.
- Social engineering, phishing, spam, or account recovery requests.
- Dependency reports without a practical impact on this project.

## Disclosure

The maintainers aim to acknowledge valid reports within 7 days and coordinate a
fix before public disclosure. Response and fix timelines are best effort for
this community project.

Please allow time for investigation and remediation before publishing details.
Credit will be given on request unless you prefer to remain anonymous.

