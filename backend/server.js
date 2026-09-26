/**
 * CodePilot backend server.
 *
 * Endpoints:
 *   POST /api/analyze  { repoUrl }           → structured analysis JSON
 *   POST /api/ask      { repoUrl, question }  → { answer }
 *   GET  /api/health                          → { status, provider }
 *
 * Run:
 *   npm run dev    (development, auto-restarts on file changes)
 *   npm start      (production)
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { ingestRepo, parseRepoUrl, GitHubRateLimitError } from "./lib/github.js";
import { analyzeRepo, askQuestion } from "./lib/analyze.js";

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// In-memory cache  { repoUrl → { repoData, analysis, cachedAt } }
// ---------------------------------------------------------------------------

const cache = new Map();
const inFlight = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — fine for a demo session

function getCached(repoUrl) {
  const entry = cache.get(repoUrl);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(repoUrl);
    return null;
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/health
 * Quick liveness check; also shows which AI provider is active.
 */
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    provider: process.env.AI_PROVIDER || "mock",
    cachedRepos: cache.size,
  });
});

/**
 * POST /api/analyze
 * Body: { repoUrl: "https://github.com/owner/repo" }
 *
 * 1. Validates the URL
 * 2. Serves from cache if available
 * 3. Fetches the repo via GitHub API
 * 4. Runs AI analysis
 * 5. Caches and returns the result
 */
app.post("/api/analyze", async (req, res) => {
  const { repoUrl } = req.body;

  // Validate input
  if (!repoUrl || typeof repoUrl !== "string" || !repoUrl.trim()) {
    return res.status(400).json({ error: "repoUrl is required." });
  }

  let owner, repo;
  try {
    ({ owner, repo } = parseRepoUrl(repoUrl));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Serve from cache
  const cacheKey = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[cache hit] ${owner}/${repo}`);
    return res.json({ ...cached.analysis, _cached: true });
  }

  console.log(`[analyze] ${owner}/${repo}`);

  try {
    let pending = inFlight.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const repoData = await ingestRepo(repoUrl);
        const analysis = await analyzeRepo(repoData);
        return { repoData, analysis };
      })();
      inFlight.set(cacheKey, pending);
    }
    const { repoData, analysis } = await pending;

    // Cache both the raw repo data (needed for /api/ask) and the analysis
    cache.set(cacheKey, { repoData, analysis, cachedAt: Date.now() });

    return res.json(analysis);
  } catch (err) {
    console.error(`[analyze error] ${owner}/${repo}:`, err.message);

    // Return a structured error with a human-readable message
    const status = err instanceof GitHubRateLimitError ? 429 : err.message.includes("GitHub API error 404") ? 404 : 500;
    return res.status(status).json({
      code: err instanceof GitHubRateLimitError ? "GITHUB_RATE_LIMIT" : undefined,
      error: status === 404
        ? `Repository "${owner}/${repo}" not found. Make sure it is public and the URL is correct.`
        : `Analysis failed: ${err.message}`,
      ...(err instanceof GitHubRateLimitError ? { rateLimit: err.rateLimit } : {}),
    });
  } finally {
    inFlight.delete(cacheKey);
  }
});

/**
 * POST /api/ask
 * Body: { repoUrl: string, question: string }
 *
 * Requires /api/analyze to have been called first for this repoUrl
 * (uses the cached repo context).
 */
app.post("/api/ask", async (req, res) => {
  const { repoUrl, question, contextFiles } = req.body;

  if (!repoUrl || typeof repoUrl !== "string" || !repoUrl.trim()) {
    return res.status(400).json({ error: "repoUrl is required." });
  }
  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "question is required." });
  }

  let owner, repo;
  try {
    ({ owner, repo } = parseRepoUrl(repoUrl));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const cached = getCached(`${owner.toLowerCase()}/${repo.toLowerCase()}`);
  if (!cached) {
    return res.status(400).json({
      error: `Repository "${owner}/${repo}" has not been analyzed yet. Call /api/analyze first.`,
    });
  }

  console.log(`[ask] ${owner}/${repo} — "${question.slice(0, 80)}"`);

  try {
    // contextFiles is an optional array of file paths to prioritise in the answer
    const result = await askQuestion(cached.repoData, question, contextFiles || null);
    return res.json(result);
  } catch (err) {
    console.error(`[ask error] ${owner}/${repo}:`, err.message);
    return res.status(500).json({ error: `Question failed: ${err.message}` });
  }
});

// Keep malformed JSON and other expected Express errors in the API's JSON contract.
app.use((err, _req, res, _next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 400;
  res.status(status).json({ error: status === 400 ? "Invalid JSON request body." : "Request failed." });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  const provider = process.env.AI_PROVIDER || "mock";
  console.log(`\nCodePilot backend running on http://localhost:${PORT}`);
  console.log(`AI provider: ${provider}`);
  if (provider === "mock") {
    console.log("  → Set AI_PROVIDER=groq with GROQ_API_KEY, or configure watsonx, to enable AI analysis.");
  }
  console.log("");
});
