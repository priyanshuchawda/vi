import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const CASES_PATH = path.resolve(process.cwd(), "test/ai-eval/cases.json");
const SINGLE_RUN_SCRIPT = path.resolve(process.cwd(), "scripts/ai-eval/run-bedrock-eval.mjs");
const OUTPUT_DIR = path.resolve(process.cwd(), "test-output/ai-evals");

function parseArgs(argv) {
  const args = {
    suite: "",
    cases: "",
    maxCases: 0,
    model: process.env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0",
    failOnContract: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--suite" && argv[i + 1]) args.suite = argv[++i];
    else if (token === "--cases" && argv[i + 1]) args.cases = argv[++i];
    else if (token === "--max-cases" && argv[i + 1]) args.maxCases = Number(argv[++i]) || 0;
    else if (token === "--model" && argv[i + 1]) args.model = argv[++i];
    else if (token === "--fail-on-contract") args.failOnContract = true;
  }
  return args;
}

function runSingleCase(caseId, model) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [SINGLE_RUN_SCRIPT, "--case", caseId, "--model", model],
      { cwd: process.cwd(), env: process.env },
    );
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Case ${caseId} failed with code ${code}\n${stderr}`));
      }
      resolve({ stdout });
    });
  });
}

function pickCases(allCases, args) {
  let selected = allCases;
  if (args.suite) {
    selected = selected.filter((c) => c.suite === args.suite);
  }
  if (args.cases) {
    const set = new Set(args.cases.split(",").map((x) => x.trim()).filter(Boolean));
    selected = selected.filter((c) => set.has(c.id));
  }
  if (args.maxCases > 0) {
    selected = selected.slice(0, args.maxCases);
  }
  return selected;
}

async function latestResultForCase(caseId) {
  try {
    const files = await fs.readdir(OUTPUT_DIR);
    const matches = files
      .filter((name) => name.startsWith(`${caseId}-`) && name.endsWith(".json"))
      .sort();
    if (matches.length === 0) return null;
    const last = matches[matches.length - 1];
    const data = JSON.parse(await fs.readFile(path.join(OUTPUT_DIR, last), "utf-8"));
    return { file: last, data };
  } catch {
    return null;
  }
}

async function run() {
  const args = parseArgs(process.argv);
  const allCases = JSON.parse(await fs.readFile(CASES_PATH, "utf-8"));
  const selectedCases = pickCases(allCases, args);

  if (selectedCases.length === 0) {
    throw new Error("No matching cases. Use --suite or --cases with valid IDs.");
  }

  const summary = {
    timestamp: new Date().toISOString(),
    model: args.model,
    total: selectedCases.length,
    passedContract: 0,
    failedContract: 0,
    avgKeywordScore: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    results: [],
  };

  for (const c of selectedCases) {
    await runSingleCase(c.id, args.model);
    const result = await latestResultForCase(c.id);
    if (!result) {
      summary.results.push({ id: c.id, error: "missing_result_file" });
      continue;
    }
    const usage = result.data.usage || {};
    const contractValid = c.expectJson
      ? Boolean(result.data.contractValidation?.valid)
      : true;
    const keywordScore = Number(result.data.keywordEvaluation?.score || 0);
    summary.results.push({
      id: c.id,
      suite: c.suite,
      contractValid,
      keywordScore,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      totalTokens: usage.totalTokens || 0,
      outputFile: result.file,
    });
    if (contractValid) summary.passedContract += 1;
    else summary.failedContract += 1;
    summary.totalInputTokens += usage.inputTokens || 0;
    summary.totalOutputTokens += usage.outputTokens || 0;
    summary.totalTokens += usage.totalTokens || 0;
  }

  summary.avgKeywordScore =
    summary.results.length > 0
      ? summary.results.reduce((acc, r) => acc + Number(r.keywordScore || 0), 0) / summary.results.length
      : 0;

  const summaryFile = `batch-summary-${Date.now()}.json`;
  const summaryPath = path.join(OUTPUT_DIR, summaryFile);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");

  console.log("\n=== BATCH SUMMARY ===");
  console.log(`Model: ${summary.model}`);
  console.log(`Cases: ${summary.total}`);
  console.log(`Contract pass: ${summary.passedContract}/${summary.total}`);
  console.log(`Avg keyword score: ${summary.avgKeywordScore.toFixed(2)}`);
  console.log(`Tokens: in=${summary.totalInputTokens} out=${summary.totalOutputTokens} total=${summary.totalTokens}`);
  console.log(`Saved: ${summaryPath}`);

  if (args.failOnContract && summary.failedContract > 0) {
    process.exit(2);
  }
}

run().catch((err) => {
  console.error(`Batch eval failed: ${err.message}`);
  process.exit(1);
});
