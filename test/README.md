# QuickCut Video Editor - Test Suite

This directory contains comprehensive tests for the QuickCut video editor.

## Test Structure

```
test/
├── setup.ts                      # Test setup and global mocks
├── stores/
│   └── useProjectStore.test.ts  # Store state management tests
├── lib/
│   ├── clipOperations.test.ts   # Clip manipulation logic tests
│   └── exportHelpers.test.ts    # Export functionality tests
└── integration/
    └── video-editor.test.ts     # End-to-end workflow tests
```

## Running Tests

### Run all tests

```bash
npm test
```

### Run tests in watch mode

```bash
npm run test:watch
```

### Run tests with coverage

```bash
npm run test:coverage
```

### Run specific test file

```bash
npx vitest test/stores/useProjectStore.test.ts
```

### Run optional live AWS storage test

This test writes temporary data to the configured DynamoDB tables and S3 bucket,
verifies round-trips through `CloudBackendService` in `direct` mode, and then cleans up.

```bash
RUN_AWS_LIVE_TESTS=1 npx vitest run test/electron/awsStorage.live.test.ts
```

To preserve the written AWS objects for CLI inspection after the run:

```bash
AWS_LIVE_TEST_KEEP_DATA=1 RUN_AWS_LIVE_TESTS=1 npx vitest run test/electron/awsStorage.live.test.ts
```

Requirements:

- valid AWS credentials available through `.env` or the default AWS SDK provider chain
- access to the configured region and bucket/tables
- local fixture media under `video_test/`

## Test Coverage

### Store Tests (`useProjectStore.test.ts`)

-  Add/remove clips
-  Split clips at time
-  Merge selected clips
-  Update clip properties (trim)
-  Copy/paste clips
-  Reorder timeline clips
-  Selection management

### Clip Operations Tests (`clipOperations.test.ts`)

-  Validate split positions
-  Split clip at specific time
-  Detect gaps between clips
-  Validate clip adjacency
-  Handle edge cases

### Export Helpers Tests (`exportHelpers.test.ts`)

-  Generate export segments
-  Handle merged clips
-  Detect overlaps
-  Validate merge requirements
-  Timeline continuity checks

### Integration Tests (`video-editor.test.ts`)

-  Complete editing workflows
-  Import → Split → Merge → Export
-  Multiple imports and reordering
-  Trimming preservation
-  Copy-paste workflows
-  Error handling
-  Timeline calculations

## Key Test Scenarios

### 1. Basic Clip Management

```typescript
// Add clip
addClip({ path: '/video.mp4', name: 'test', duration: 10 });

// Remove clip
removeClip(clipId);

// Update clip
updateClip(clipId, { start: 2, end: 8 });
```

### 2. Splitting Workflow

```typescript
// Valid split (middle of clip)
splitClip(clipId, 5); //  Creates 2 clips

// Invalid splits
splitClip(clipId, 0); //  At start
splitClip(clipId, 10); //  At end
```

### 3. Merging Workflow

```typescript
// Select clips
toggleClipSelection(clip1Id, false);
toggleClipSelection(clip2Id, true);

// Merge
mergeSelectedClips(); //  Creates merged clip
```

## Mocked Dependencies

All Electron APIs are mocked in `test/setup.ts`:

- `openFile()` - File selection
- `getMetadata()` - Video metadata
- `getThumbnail()` - Thumbnail generation
- `getWaveform()` - Audio waveform
- `exportVideo()` - Video export
- `saveProject()` / `loadProject()` - Project management

## Test Best Practices

1. **Reset state before each test** - Use `beforeEach()` to clean store
2. **Test edge cases** - Invalid inputs, boundary conditions
3. **Test workflows** - Complete user scenarios, not just units
4. **Mock external dependencies** - Electron APIs, file system
5. **Assert meaningful outcomes** - State changes, notifications, errors

## Adding New Tests

When adding new features, create tests in the appropriate directory:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../../src/stores/useProjectStore';

describe('New Feature', () => {
  beforeEach(() => {
    // Reset state
  });

  it('should do something', () => {
    // Test implementation
    expect(result).toBe(expected);
  });
});
```

## Continuous Integration

Tests are automatically run on:

- Every commit
- Pull requests
- Before builds
- In CI/CD pipeline

## Coverage Goals

Target coverage: **80%+**

- Statements: 80%
- Branches: 75%
- Functions: 80%
- Lines: 80%
