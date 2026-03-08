# Creator Architecture

This document captures the current creator-analysis and AI-editing flow at a
system level. The diagrams in this folder are snapshots of the AWS, YouTube,
local processing, and Bedrock orchestration discovered during live validation.

## Diagrams

- `docs/diagrams/creator-architecture.png` Portrait overview snapshot of the
  creator workflow.
- `docs/diagrams/creator-architecture-detailed.png` Three-row detailed view
  covering creator requests, cloud services, cache layers, and local processing.
- `docs/diagrams/creator-architecture-horizontal.png` Compact horizontal view
  for quick sharing in docs and PRs.

## Mermaid Sources

- `docs/diagrams/creator-architecture-detailed.mmd`
- `docs/diagrams/creator-architecture-horizontal.mmd`

Render updated PNGs with:

```bash
npm run mermaid:render -- -i docs/diagrams/creator-architecture-detailed.mmd -o docs/diagrams/creator-architecture-detailed.png
npm run mermaid:render -- -i docs/diagrams/creator-architecture-horizontal.mmd -o docs/diagrams/creator-architecture-horizontal.png
```

If Chrome sandboxing is unavailable on Linux, use the included fallback
Puppeteer config:

```bash
npm run mermaid:render -- -p .mermaid-tools/puppeteer-no-sandbox.json -i docs/diagrams/creator-architecture-detailed.mmd -o docs/diagrams/creator-architecture-detailed.png
```
