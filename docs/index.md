# USA零 Documentation Index

## Overview

- [Quick Start](/docs/overview/quick-start)
- [Features](/docs/overview/features)
- [Deploy on Render](/docs/overview/render)
- [Docker Deployment](/docs/overview/docker)
- [Third-party GitHub Prompt Repositories](/docs/overview/third-party-prompt-repositories)

## Canvas Guide

- [Canvas Node Guide](/docs/canvas/canvas-node-manual)
- [Canvas Shortcuts](/docs/canvas/canvas-shortcuts)

## Development and Data

- [Local Development](/docs/development/local-development)
- [Canvas Data Structure](/docs/development/canvas-data-structure)
- [How the Local Codex Connection Works](/docs/development/local-codex-canvas)

## Business

- [Open-source License](/docs/business/license)
- [Business Cooperation](/docs/business/business)

## Support and Security

- [Report a Vulnerability](/docs/support/security)
- [Sponsor the Project](/docs/support/sponsor)

## Project Progress

- [Changelog](/docs/progress/changelog)
- [Pending Tests](/docs/progress/pending-test)
- [TODO](/docs/progress/todo)

## Notes

- All business pages require USA0 OAuth. The website login cookie is reused only inside the official same-origin `/oauth/authorize` page; the canvas never reads or transmits the website cookie or website token.
- All official Keys synchronize automatically as independent model sources, including duplicate model names. Users without a Key select an official website group and create one in Account Management; create and delete operations update the official site as the source of truth.
- There are no custom or local channels or manual endpoint credentials. Full official Keys stay only in runtime memory.
- Canvas projects and My Assets are primarily stored in the browser. WebDAV can be configured for cross-device synchronization.
- Production OAuth requires a stable HTTPS canvas origin registered by the external official service as both the exact CORS origin and exact `<origin>/oauth/callback` redirect URI. Wildcards and random preview domains are not supported.
