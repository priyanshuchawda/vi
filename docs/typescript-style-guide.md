# TypeScript Style Guide

This guide defines typing conventions for renderer, Electron main, and shared
contracts.

## Core Principles

- Prefer explicit types at boundaries (IPC, persistence, external APIs).
- Use `unknown` for untrusted inputs; narrow before use.
- Avoid `any`. If unavoidable, scope it to the smallest expression.
- Prefer discriminated unions for state/result modeling.
- Enforce exhaustive switch handling for tagged unions.

## `unknown` Over `any`

Use `unknown` at external boundaries and parse it with runtime schema checks.

Example from this repo:

- `electron/preload.ts` validates renderer inputs before invoke.
- `electron/ipc/contracts.ts` defines Zod schemas and contract types.

## IPC Contracts

- Every channel must have:
  - typed args
  - typed result
  - runtime input validation
- Keep channel names centralized and shared from one contract file.
- Prefer consistent success/error envelopes for new channels.

## Error Typing

- Throw `Error` objects (or error types extending `Error`) from services.
- At process boundaries, convert unknown failures to structured error payloads.
- Include stable error codes for renderer-facing error handling.

## Optional Properties

- Use optional fields only when absence is a valid state.
- Prefer explicit defaults in schemas when possible.
- Avoid “optional but always present in practice” fields.

## Exhaustiveness

For discriminated unions, enforce exhaustive handling:

```ts
switch (result.kind) {
  case 'ok':
    return result.value;
  case 'error':
    return fallback(result.code);
  default: {
    const unreachable: never = result;
    return unreachable;
  }
}
```

## Allowed Exceptions

- File-level `no-explicit-any` disables are not allowed.
- Narrow inline exceptions can be used only with:
  - comment explaining why
  - follow-up issue reference
  - minimal scope

## Review Checklist

- Are new boundary inputs validated?
- Are union states explicit and exhaustive?
- Is any `any` avoidable with `unknown` + narrowing?
- Is IPC behavior reflected in contract types and tests?
