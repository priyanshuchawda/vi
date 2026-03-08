/**
 * AWS Storage Integration Test
 * Tests DynamoDB (channel-analysis + user-links tables) and S3 bucket.
 * Run with: node scripts/test-aws-storage.mjs
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { gzipSync, gunzipSync } from 'zlib';

// ── Config ────────────────────────────────────────────────────────────────────
const REGION = process.env.AWS_REGION ?? 'eu-central-1';
const ANALYSIS_TABLE = process.env.AWS_DYNAMODB_ANALYSIS_TABLE ?? 'quickcut-channel-analysis';
const USER_LINKS_TABLE = process.env.AWS_DYNAMODB_USER_LINKS_TABLE ?? 'quickcut-user-links';
const PROFILES_TABLE = process.env.AWS_DYNAMODB_PROFILES_TABLE ?? 'quickcut-user-profiles';
const S3_BUCKET = process.env.AWS_S3_BUCKET ?? 'quickcut-279158981022-storage';

const TEST_CHANNEL_ID = 'test-channel-001';
const TEST_USER_ID = 'test-user-001';
const TEST_S3_KEY = 'memory/test/memory.json';
const TEST_AI_CONTEXT_KEY = 'ai-context/chat-history/test-project-001';

// ── Clients ───────────────────────────────────────────────────────────────────
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({ region: REGION });

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅ PASS  ${label}`);
  passed++;
}

function fail(label, err) {
  console.error(`  ❌ FAIL  ${label}`);
  console.error(`         ${err?.message ?? err}`);
  failed++;
}

// ── DynamoDB Tests ────────────────────────────────────────────────────────────
async function testDynamoDB() {
  console.log('\n📦 DynamoDB — quickcut-channel-analysis');

  // 1. Write
  const sampleAnalysis = {
    channel: { id: TEST_CHANNEL_ID, title: 'Test Channel', subscriber_count: 1000 },
    meta: { analyzed_at: new Date().toISOString(), cache_hit: false },
  };
  const ttl = Math.floor(Date.now() / 1000) + 3600; // 1 hour expiry

  try {
    await dynamo.send(new PutCommand({
      TableName: ANALYSIS_TABLE,
      Item: { channelId: TEST_CHANNEL_ID, data: sampleAnalysis, ttl },
    }));
    ok('PutItem to channel-analysis table');
  } catch (err) {
    fail('PutItem to channel-analysis table', err);
  }

  // 2. Read back
  try {
    const result = await dynamo.send(new GetCommand({
      TableName: ANALYSIS_TABLE,
      Key: { channelId: TEST_CHANNEL_ID },
    }));
    const item = result.Item;
    if (item?.channelId === TEST_CHANNEL_ID && item?.data?.channel?.title === 'Test Channel') {
      ok('GetItem from channel-analysis table (data verified)');
    } else {
      fail('GetItem from channel-analysis table', new Error('Data mismatch: ' + JSON.stringify(item)));
    }
  } catch (err) {
    fail('GetItem from channel-analysis table', err);
  }

  // 3. User-links table write
  console.log('\n📦 DynamoDB — quickcut-user-links');
  try {
    await dynamo.send(new PutCommand({
      TableName: USER_LINKS_TABLE,
      Item: { userId: TEST_USER_ID, channelId: TEST_CHANNEL_ID, ttl },
    }));
    ok('PutItem to user-links table');
  } catch (err) {
    fail('PutItem to user-links table', err);
  }

  // 4. User-links table read
  try {
    const result = await dynamo.send(new GetCommand({
      TableName: USER_LINKS_TABLE,
      Key: { userId: TEST_USER_ID },
    }));
    if (result.Item?.channelId === TEST_CHANNEL_ID) {
      ok('GetItem from user-links table (channelId verified)');
    } else {
      fail('GetItem from user-links table', new Error('Data mismatch: ' + JSON.stringify(result.Item)));
    }
  } catch (err) {
    fail('GetItem from user-links table', err);
  }

  // 5. Cleanup
  try {
    await dynamo.send(new DeleteCommand({ TableName: ANALYSIS_TABLE, Key: { channelId: TEST_CHANNEL_ID } }));
    await dynamo.send(new DeleteCommand({ TableName: USER_LINKS_TABLE, Key: { userId: TEST_USER_ID } }));
    ok('Deleted test items (cleanup)');
  } catch (err) {
    fail('Delete test items (cleanup)', err);
  }
}

// ── User Profiles DynamoDB Tests ──────────────────────────────────────────────
async function testProfilesDynamoDB() {
  console.log('\n📦 DynamoDB — quickcut-user-profiles');

  const sampleProfile = {
    userId: TEST_USER_ID,
    userName: 'Test User',
    email: 'test@example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Write
  try {
    await dynamo.send(new PutCommand({
      TableName: PROFILES_TABLE,
      Item: sampleProfile,
    }));
    ok('PutItem to user-profiles table');
  } catch (err) {
    fail('PutItem to user-profiles table', err);
  }

  // Read back
  try {
    const result = await dynamo.send(new GetCommand({
      TableName: PROFILES_TABLE,
      Key: { userId: TEST_USER_ID },
    }));
    const item = result.Item;
    if (item?.userId === TEST_USER_ID && item?.userName === 'Test User') {
      ok('GetItem from user-profiles table (data verified)');
    } else {
      fail('GetItem from user-profiles table', new Error('Data mismatch: ' + JSON.stringify(item)));
    }
  } catch (err) {
    fail('GetItem from user-profiles table', err);
  }

  // Cleanup
  try {
    await dynamo.send(new DeleteCommand({ TableName: PROFILES_TABLE, Key: { userId: TEST_USER_ID } }));
    ok('Deleted test profile (cleanup)');
  } catch (err) {
    fail('Delete test profile (cleanup)', err);
  }
}

// ── S3 Tests ──────────────────────────────────────────────────────────────────
async function testS3() {
  console.log('\n🪣 S3 — ' + S3_BUCKET);

  // 1. Bucket reachable
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    ok('Bucket is accessible');
  } catch (err) {
    fail('Bucket is accessible', err);
    return; // no point running further S3 tests
  }

  // 2. Upload gzip-compressed object
  const payload = JSON.stringify({ entries: [{ id: 'test', value: 'hello from QuickCut' }], ts: Date.now() }, null, 2);
  const compressed = gzipSync(Buffer.from(payload, 'utf-8'));

  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: TEST_S3_KEY,
      Body: compressed,
      ContentEncoding: 'gzip',
      ContentType: 'text/plain; charset=utf-8',
      StorageClass: 'STANDARD',
    }));
    ok('PutObject (gzip-compressed) to S3');
  } catch (err) {
    fail('PutObject (gzip-compressed) to S3', err);
  }

  // 3. Download and decompress
  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: TEST_S3_KEY,
    }));
    const bytes = await result.Body.transformToByteArray();
    const decompressed = gunzipSync(Buffer.from(bytes)).toString('utf-8');
    const parsed = JSON.parse(decompressed);
    if (parsed?.entries?.[0]?.value === 'hello from QuickCut') {
      ok('GetObject + gunzip + JSON parse (data verified)');
    } else {
      fail('GetObject data verification', new Error('Unexpected: ' + JSON.stringify(parsed)));
    }
  } catch (err) {
    fail('GetObject from S3', err);
  }

  // 4. ai-context/ prefix: upload chat history backup
  const chatPayload = JSON.stringify({ messages: [{ id: '1', role: 'user', content: 'hello', timestamp: Date.now() }], savedAt: Date.now() });
  const chatCompressed = gzipSync(Buffer.from(chatPayload, 'utf-8'));
  try {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: TEST_AI_CONTEXT_KEY,
      Body: chatCompressed,
      ContentEncoding: 'gzip',
      ContentType: 'application/json',
    }));
    ok('PutObject to ai-context/ prefix (chat history)');
  } catch (err) {
    fail('PutObject to ai-context/ prefix', err);
  }

  // 5. ai-context/ prefix: download and verify
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: TEST_AI_CONTEXT_KEY }));
    const bytes = await result.Body.transformToByteArray();
    const parsed = JSON.parse(gunzipSync(Buffer.from(bytes)).toString('utf-8'));
    if (Array.isArray(parsed?.messages)) {
      ok('GetObject from ai-context/ prefix (data verified)');
    } else {
      fail('GetObject from ai-context/ prefix', new Error('Unexpected: ' + JSON.stringify(parsed)));
    }
  } catch (err) {
    fail('GetObject from ai-context/ prefix', err);
  }

  // 6. Cleanup both S3 objects
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: TEST_S3_KEY }));
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: TEST_AI_CONTEXT_KEY }));
    ok('DeleteObject cleanup (memory/ + ai-context/)');
  } catch (err) {
    fail('DeleteObject cleanup', err);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('='.repeat(55));
console.log('  QuickCut AWS Storage Integration Test');
console.log('='.repeat(55));
console.log(`  Region           : ${REGION}`);
console.log(`  DDB (analysis)   : ${ANALYSIS_TABLE}`);
console.log(`  DDB (user-links) : ${USER_LINKS_TABLE}`);
console.log(`  DDB (profiles)   : ${PROFILES_TABLE}`);
console.log(`  S3 bucket        : ${S3_BUCKET}`);

await testDynamoDB();
await testProfilesDynamoDB();
await testS3();

console.log('\n' + '='.repeat(55));
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(55));

process.exit(failed > 0 ? 1 : 0);
