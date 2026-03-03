# Architecture Boundaries

This project enforces dependency boundaries to keep Electron main-process code,
renderer code, and shared contracts maintainable at scale.

## Layers

- `electron/`: Electron main process, preload, native/OS integrations.
- `src/`: Renderer application (React UI, stores, renderer-side services).
- Shared contracts currently live in `electron/ipc/contracts.ts`.

## Enforced Rules

- Renderer (`src/**`) must not import main-process modules (`electron/**`).
- Electron main (`electron/**`) must not import renderer UI/state modules
  (`src/components/**`, `src/stores/**`, `src/assets/**`).
- Circular dependencies are disallowed.

These rules are enforced by `dependency-cruiser` via:

```bash
npm run architecture:check
```

## CI Enforcement

`architecture:check` runs in CI and is treated as a required quality gate.

When adding new shared contracts, place them in stable shared modules and update
the architecture rules intentionally in the same PR.
