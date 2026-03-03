# Storage Strategy

This document defines where QuickCut stores data and why.

## Decision Matrix

### localStorage (renderer)

Use for small, non-sensitive UX/session preferences.

Examples:

- active sidebar tab
- lightweight AI telemetry counters
- token/rate-limit counters
- collapsible section UI state

Do not store:

- media file binary content
- secrets/tokens
- large transcript/media payloads

### File system (Electron main)

Use for project and analysis artifacts requiring durability and larger payload
support.

Examples:

- `.quickcut` project files selected by user
- AI memory state (`memory.json`)
- markdown analysis exports
- app caches under user data directory

### Optional SQLite (future)

Use when we need indexed queries and higher write volume than JSON files.

Candidate workloads:

- large project libraries
- search over historical analysis artifacts
- high-frequency event/audit storage

## Current Hardening

- Introduced `src/lib/storage.ts` for safe, namespaced localStorage access.
- Standardized sidebar and collapsible UI key usage through shared key builders.
- All browser storage helpers gracefully handle unavailable storage/quota
  errors.

## SQLite Migration Notes

If/when SQLite is introduced:

1. Add `StorageAdapter` interface and keep file-based adapter as default.
2. Introduce SQLite adapter behind feature flag (`ENABLE_SQLITE_STORAGE=1`).
3. Add one-time migration from JSON/localStorage keys into SQLite tables.
4. Keep rollback path: if SQLite init fails, continue with existing file/local
   storage.
5. Add migration checksum + version table to guarantee idempotent upgrades.

## Data Loss Guardrails

- Keep project save/load in main process file APIs.
- Never overwrite user-selected project files without explicit save path.
- Preserve AI memory write/read behavior and test compatibility.

## Chat Persistence Retention Policy

Persisted chat state is compacted on both write and hydrate using
`src/lib/chatPersistencePolicy.ts`.

Current caps:

- `maxMessages`: 120
- `maxTurns`: 80
- `maxTurnParts`: 200 per turn
- `maxMessageChars`: 12,000 per message

Behavior:

- Old oversized stores are migration-pruned safely during hydrate.
- Latest system message is retained when message compaction is needed.
- Active turn ID is cleared if the referenced turn is pruned.
- Non-serializable attachment fields (`file`, `previewUrl`, `base64Data`) are
  stripped from persisted messages.
