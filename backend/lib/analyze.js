import { callAI } from "./aiRouter.js";
/**
 * AI analysis service.
 *
 * Provider is selected via the AI_PROVIDER environment variable:
 *
 *   AI_PROVIDER=watsonx   → IBM watsonx.ai (requires WATSONX_* credentials)
 *   AI_PROVIDER=groq      → Groq chat completions (requires GROQ_API_KEY)
 *   AI_PROVIDER=mock      → Deterministic mock enriched with real repository data
 *
 * If AI_PROVIDER=watsonx is set but credentials are missing or invalid, the
 * service logs a warning and automatically falls back to the mock provider.
 *
 * watsonx environment variables:
 *   WATSONX_API_KEY       IBM Cloud IAM API key
 *   WATSONX_PROJECT_ID    watsonx.ai project ID
 *   WATSONX_URL           Base URL, e.g. https://us-south.ml.cloud.ibm.com
 *   WATSONX_MODEL         Model ID (default: ibm/granite-3-8b-instruct)
 *
 * Response shape (flat, matches frontend normalize() contract):
 * {
 *   _provider,
 *   summary,         // string
 *   language,        // string
 *   technologies,    // string[]
 *   patterns,        // string[]
 *   architecture,    // [{name, type, path?}]
 *   keyFiles,        // [{path, category, importance, responsibility}]
 *   setup: {
 *     prerequisites, // string[]
 *     install,       // string[] (commands)
 *     commands,      // string[] (dev/run commands)
 *     environment,   // string[] (env vars)
 *   },
 *   missions,        // [{id, title, description, difficulty, files, skills}]
 *   // Extended fields (used by ask context and deeper UI):
 *   repoName,
 *   description,
 *   entryPoints,
 *   archDetail: { summary, components, patterns, relationships },
 *   repoStats: { totalFiles, testFiles, configFiles, docFiles, ... }
 * }
 */

import fetch from "node-fetch";
import { classifyFile, rankFilesForQuestion } from "./classifier.js";

// ---------------------------------------------------------------------------
// Credential validation
// ---------------------------------------------------------------------------

function validateWatsonxConfig() {
  if (!process.env.WATSONX_API_KEY || !process.env.WATSONX_API_KEY.trim()) {
    return { valid: false, reason: "WATSONX_API_KEY is not set" };
  }
  if (!process.env.WATSONX_PROJECT_ID || !process.env.WATSONX_PROJECT_ID.trim()) {
    return { valid: false, reason: "WATSONX_PROJECT_ID is not set" };
  }
  return { valid: true };
}

function resolveProvider() {
  const requested = (process.env.AI_PROVIDER || "mock").toLowerCase();

  if (requested === "groq") {
    const hasGroq = Boolean(process.env.GROQ_API_KEY?.trim());
    const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY?.trim());
    const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());

    if (hasGroq || hasOpenRouter || hasGemini) {
      return "router";
    }

    console.warn(
      "[analyze] No AI router providers are configured. Falling back to mock provider."
    );

    return "mock";
  }

  if (requested !== "watsonx") return "mock";

  const check = validateWatsonxConfig();

  if (!check.valid) {
    console.warn(
      `[analyze] AI_PROVIDER=watsonx requested but ${check.reason}. ` +
        "Falling back to mock provider."
    );
    return "mock";
  }

  return "watsonx";
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Build the analysis prompt for watsonx.
 * Includes richer repo context: metadata, classified tree, dir structure, file contents.
 */
function buildAnalysisPrompt(repoData) {
  const { owner, repo, branch, metadata, tree, classifiedTree, dirStructure, files } = repoData;

  // File tree: show classified files grouped by category for better context
  const treeByCategory = {};
  for (const f of (classifiedTree || [])) {
    if (!treeByCategory[f.category]) treeByCategory[f.category] = [];
    treeByCategory[f.category].push(f.path);
  }

  const repoIsLarge = (tree || []).length > 500;
  const repoIsHuge = (tree || []).length > 1500;

  const maxPathsPerCategory = repoIsHuge ? 4 : repoIsLarge ? 6 : 10;
  const maxTotalTreePaths = repoIsHuge ? 60 : repoIsLarge ? 90 : 140;

  const treeSection = Object.entries(treeByCategory)
    .map(([cat, paths]) => `[${cat}]\n${paths.slice(0, maxPathsPerCategory).join("\n")}`)
    .join("\n\n")
    .split("\n")
    .slice(0, maxTotalTreePaths + Object.keys(treeByCategory).length)
    .join("\n");

  const dirSection = dirStructure
    ? `Top-level directories: ${(dirStructure.topLevel || []).join(", ")}\n` +
      `Notable subdirectories: ${(dirStructure.notable || []).join(", ")}`
    : "";

  // Keep the AI prompt compact while preserving the most useful repository context.
  // Full repository intelligence remains available to the rest of CodePilot.
  const priorityPattern = /(^|\/)(README(?:\.md)?|package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|dockerfile|docker-compose(?:\.ya?ml)?|\.env\.example|tsconfig\.json|vite\.config\.[^/]+|next\.config\.[^/]+|src\/main\.[^/]+|src\/index\.[^/]+|server\.[^/]+|app\.[^/]+|index\.[^/]+)$/i;

  const categoryPriority = new Set([
    "entry-point",
    "authentication",
    "routes",
    "controllers",
    "services",
    "models",
    "database",
    "config",
    "documentation",
    "dependencies",
    "middleware",
  ]);

  const selectedFiles = [...(files || [])]
    .sort((a, b) => {
      const aScore = (priorityPattern.test(a.path) ? 100 : 0) +
        (categoryPriority.has(a.category) ? 40 : 0) +
        (a.importance === "high" ? 20 : a.importance === "medium" ? 10 : 0);
      const bScore = (priorityPattern.test(b.path) ? 100 : 0) +
        (categoryPriority.has(b.category) ? 40 : 0) +
        (b.importance === "high" ? 20 : b.importance === "medium" ? 10 : 0);
      return bScore - aScore;
    })
    .slice(0, repoIsHuge ? 6 : repoIsLarge ? 8 : 12);

  const fileText = selectedFiles
    .map((f) => `--- FILE: ${f.path} (${f.category || "unknown"}) ---\n${String(f.content || "").slice(0, repoIsHuge ? 800 : repoIsLarge ? 1000 : 1500)}`)
    .join("\n\n");

  const metaSection = metadata
    ? [
        metadata.description && `Description: ${metadata.description}`,
        metadata.language && `Primary language: ${metadata.language}`,
        metadata.topics?.length && `Topics: ${metadata.topics.join(", ")}`,
        metadata.stars && `Stars: ${metadata.stars}`,
        metadata.license && `License: ${metadata.license}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return `You are CodePilot, an expert software engineer helping a developer understand an unfamiliar GitHub repository.

Repository: ${owner}/${repo} (branch: ${branch})
${metaSection}

DIRECTORY STRUCTURE:
${dirSection}

FILES BY CATEGORY (up to 15 per category):
${treeSection || tree.filter(f => f.type === "blob").slice(0, 100).map(f => f.path).join("\n")}

KEY FILE CONTENTS:
${fileText}

Analyze this repository and respond with ONLY a valid JSON object (no markdown fences, no explanation outside the JSON) matching this exact structure:
{
  "summary": "2-3 sentence plain-English summary of what this project does",
  "language": "primary programming language",
  "technologies": ["technology1", "technology2"],
  "patterns": ["architectural or design pattern used"],
  "architecture": [
    { "name": "Component name", "type": "entry|api|logic|data|frontend|worker|config|auth", "path": "folder or file path" }
  ],
  "keyFiles": [
    { "path": "relative/file/path", "responsibility": "what this file does", "importance": "high|medium|low", "category": "entry-point|routes|controllers|services|models|middleware|config|database|tests|frontend|backend|documentation|dependencies|deployment|build|authentication|schema|component|utility|worker" }
  ],
  "entryPoints": ["path/to/entry1.js"],
  "setup": {
    "prerequisites": ["Node.js >= 18", "etc"],
    "install": ["npm install"],
    "commands": ["npm run dev", "npm test"],
    "environment": ["DATABASE_URL=...", "API_KEY=..."]
  },
  "missions": [
    {
      "id": 1,
      "title": "Mission title",
      "description": "What the developer should do",
      "difficulty": "beginner|intermediate|advanced",
      "files": ["relevant/file.js"],
      "skills": ["skill learned"]
    }
  ]
}

Rules:
- Provide 4-8 architecture nodes grounded in actual files found above
- Provide 10-20 key files from the actual file listing above
- Include 1-3 architecture relationships based on real code evidence
- Provide 2-5 entry points (files that start the application)
- Provide install/commands/environment from actual repository files (package.json scripts, .env.example, etc.)
- Provide 4-7 missions grounded in the actual repository structure
- Only include categories that are actually present in this repository
- Output only the JSON object`;
}

/**
 * Build context for Ask Codebase — select most relevant files for the question.
 * Returns at most ~8000 chars of context.
 */
function buildAskContext(repoContext, question) {
  const { files, classifiedTree } = repoContext;

  // Build classified file list from what we have
  const classifiedFiles = (files || []).map((f) => ({
    path: f.path,
    content: f.content,
    category: f.category || null,
    importance: f.importance || "low",
  }));

  // Rank by relevance to the question
  const ranked = rankFilesForQuestion(classifiedFiles, question);

  // Select top files up to token budget (~8000 chars)
  let budget = 8000;
  const selected = [];
  for (const f of ranked) {
    if (budget <= 0) break;
    const snippet = f.content.slice(0, Math.min(3000, budget));
    selected.push({ path: f.path, category: f.category, snippet });
    budget -= snippet.length;
  }

  return selected;
}

/**
 * Build the Q&A prompt with context-aware file selection.
 */
function buildAskPrompt(repoContext, question) {
  const { owner, repo } = repoContext;
  const contextFiles = buildAskContext(repoContext, question);

  const fileText = contextFiles
    .map((f) => `--- ${f.path}${f.category ? ` [${f.category}]` : ""} ---\n${f.snippet}`)
    .join("\n\n");

  return `You are CodePilot, an expert software engineer. The developer is asking about the repository ${owner}/${repo}.

RELEVANT REPOSITORY FILES (selected based on your question):
${fileText}

DEVELOPER QUESTION: ${question}

Answer concisely and accurately based on the actual code above. If the answer is not directly visible in the provided files, say so honestly rather than guessing. Keep the answer under 400 words. Format code references as \`filename\` or \`function()\`.`;
}

// ---------------------------------------------------------------------------
// Provider: watsonx
// ---------------------------------------------------------------------------

let _watsonxToken = null;
let _watsonxTokenExpiry = 0;

async function getWatsonxToken() {
  if (_watsonxToken && Date.now() < _watsonxTokenExpiry) return _watsonxToken;

  const apiKey = process.env.WATSONX_API_KEY;
  if (!apiKey) throw new Error("WATSONX_API_KEY is not set");

  const res = await fetch("https://iam.cloud.ibm.com/identity/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`,
  });

  if (res.status === 400 || res.status === 401) {
    const body = await res.text();
    throw new Error(`Invalid WATSONX_API_KEY — IAM rejected the key (${res.status}): ${body}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to get watsonx IAM token (${res.status}): ${body}`);
  }

  const data = await res.json();
  _watsonxToken = data.access_token;
  _watsonxTokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return _watsonxToken;
}

async function callWatsonx(prompt) {
  const token = await getWatsonxToken();
  const baseUrl = (process.env.WATSONX_URL || "https://us-south.ml.cloud.ibm.com").replace(/\/$/, "");
  const model = process.env.WATSONX_MODEL || "ibm/granite-3-8b-instruct";
  const projectId = process.env.WATSONX_PROJECT_ID;

  if (!projectId) throw new Error("WATSONX_PROJECT_ID is not set");

  const res = await fetch(`${baseUrl}/ml/v1/text/generation?version=2023-05-29`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_id: model,
      project_id: projectId,
      input: prompt,
      parameters: {
        decoding_method: "greedy",
        max_new_tokens: 4096,
        repetition_penalty: 1.05,
      },
    }),
  });

  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    throw new Error(`watsonx authentication failed (${res.status}): ${body}`);
  }
  if (res.status === 429) {
    throw new Error("watsonx rate limit exceeded — please wait a moment and try again");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`watsonx API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const text = data?.results?.[0]?.generated_text;
  if (!text) throw new Error("watsonx returned no generated text");
  return text;
}

async function callGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("GROQ_API_KEY is not set");
  }

  let res;

  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 8192,
      }),
    });
  } catch {
    throw new Error("Groq service is unreachable");
  }

  if (res.status === 429) {
    throw new Error(
      "Groq rate limit reached. CodePilot stopped the request to prevent additional usage. Please try again later."
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Groq authentication failed (${res.status}). Check the GROQ_API_KEY configuration.`
    );
  }

  if (!res.ok) {
    throw new Error(`Groq API request failed (${res.status})`);
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  console.log("[groq-debug]", JSON.stringify(data, null, 2));

  const text =
    typeof message?.content === "string" && message.content.trim()
      ? message.content
      : typeof message?.reasoning_content === "string" &&
          message.reasoning_content.trim()
        ? message.reasoning_content
        : typeof data?.choices?.[0]?.text === "string"
          ? data.choices[0].text
          : "";

  if (!text.trim()) {
    throw new Error("Groq returned no usable generated text");
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Provider: mock — enriched with real repository data
// ---------------------------------------------------------------------------

/**
 * Build a mock analysis that uses the actual repository data.
 * Reads real file classifications, dir structure, and metadata to produce
 * a response that is grounded in the repository.
 *
 * Returns the flat shape the frontend normalize() expects.
 */
function callMock(repoData) {
  const { owner, repo, branch, metadata, classifiedTree, dirStructure, files, fileStats } = repoData;

  // Use real metadata when available
  const language   = metadata?.language || "JavaScript";
  const description = metadata?.description || "";
  const topics     = metadata?.topics || [];

  // Derive tech stack from files and metadata
  const technologies = deriveTechStack(files, metadata, classifiedTree);

  // Build real file entries from classifiedTree
  const keyFiles = buildImportantFiles(files, classifiedTree);

  // Build real architecture nodes from directory structure and classified files
  const architecture = buildArchitectureNodes(classifiedTree, dirStructure, files);

  // Identify actual entry points
  const entryPoints = classifiedTree
    ? classifiedTree.filter(f => f.category === "entry-point").map(f => f.path).slice(0, 5)
    : [];

  // Build architectural patterns
  const patterns = deriveArchPatterns(classifiedTree, dirStructure);

  // Build setup steps from real files
  const setup = buildSetupGuide(owner, repo, files, metadata);

  // Build missions from real structure
  const missions = buildMissions(owner, repo, classifiedTree, dirStructure, files);

  // Build arch detail for deeper context
  const archDetail = buildArchDetail(classifiedTree, dirStructure, files);

  // Summary — use description if available
  const summary = description
    ? `${description}`
    : `${owner}/${repo} is a ${language} project${topics.length ? ` focused on ${topics.slice(0,3).join(", ")}` : ""}.`;

  // Repo stats
  const repoStats = fileStats || {};

  return JSON.stringify({
    summary,
    language,
    technologies,
    patterns,
    architecture,
    keyFiles,
    entryPoints,
    setup,
    missions,
    repoName: `${owner}/${repo}`,
    description,
    archDetail,
    repoStats,
    _provider: "mock",
  });
}

// ---------------------------------------------------------------------------
// Mock builder helpers
// ---------------------------------------------------------------------------

function deriveTechStack(files, metadata, classifiedTree) {
  const stack = new Set();
  if (metadata?.language) stack.add(metadata.language);

  // Add topics that are known technology names (filter out generic words)
  if (metadata?.topics) {
    const TECH_TOPICS = {
      typescript: "TypeScript", javascript: "JavaScript", python: "Python",
      golang: "Go", rust: "Rust", ruby: "Ruby", java: "Java", kotlin: "Kotlin",
      "c#": "C#", cpp: "C++", swift: "Swift", php: "PHP",
      react: "React", vue: "Vue.js", angular: "Angular", svelte: "Svelte",
      nextjs: "Next.js", nuxtjs: "Nuxt.js", gatsby: "Gatsby",
      express: "Express", fastify: "Fastify", nestjs: "NestJS",
      django: "Django", flask: "Flask", fastapi: "FastAPI",
      graphql: "GraphQL", rest: "REST API", grpc: "gRPC",
      postgresql: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB", redis: "Redis",
      docker: "Docker", kubernetes: "Kubernetes", terraform: "Terraform",
      monorepo: "Monorepo", turborepo: "Turborepo",
      prisma: "Prisma", drizzle: "Drizzle ORM",
      tailwindcss: "Tailwind CSS", shadcn: "shadcn/ui",
      electron: "Electron", tauri: "Tauri",
      // Language-level topics are technologies
      "node.js": "Node.js", nodejs: "Node.js", deno: "Deno", bun: "Bun",
    };
    // Only add topics that are recognized as technology names
    metadata.topics.forEach(t => {
      const key = t.toLowerCase().replace(/[-_]/g, "");
      if (TECH_TOPICS[key]) {
        stack.add(TECH_TOPICS[key]);
      }
      // Also add if it matches the primary language exactly (handles edge cases)
    });
  }

  // Infer from package.json content
  const pkgFile = files?.find(f => f.path === "package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const knownFrameworks = {
        "react": "React",
        "react-dom": "React",
        "vue": "Vue.js",
        "@vue/core": "Vue.js",
        "svelte": "Svelte",
        "@angular/core": "Angular",
        "express": "Express",
        "fastify": "Fastify",
        "koa": "Koa",
        "@hapi/hapi": "Hapi",
        "next": "Next.js",
        "nuxt": "Nuxt.js",
        "gatsby": "Gatsby",
        "remix": "Remix",
        "@remix-run/node": "Remix",
        "typeorm": "TypeORM",
        "mongoose": "Mongoose",
        "sequelize": "Sequelize",
        "prisma": "Prisma",
        "@prisma/client": "Prisma",
        "drizzle-orm": "Drizzle ORM",
        "knex": "Knex.js",
        "jest": "Jest",
        "mocha": "Mocha",
        "vitest": "Vitest",
        "@playwright/test": "Playwright",
        "cypress": "Cypress",
        "typescript": "TypeScript",
        "webpack": "Webpack",
        "vite": "Vite",
        "rollup": "Rollup",
        "esbuild": "esbuild",
        "tailwindcss": "Tailwind CSS",
        "styled-components": "Styled Components",
        "@tanstack/react-query": "TanStack Query",
        "zustand": "Zustand",
        "redux": "Redux",
        "@reduxjs/toolkit": "Redux Toolkit",
        "axios": "Axios",
        "graphql": "GraphQL",
        "apollo-server": "Apollo Server",
        "@apollo/server": "Apollo Server",
        "socket.io": "Socket.io",
        "ws": "WebSockets",
        "bull": "Bull Queue",
        "bullmq": "BullMQ",
        "redis": "Redis",
        "ioredis": "Redis",
        "pg": "PostgreSQL",
        "mysql2": "MySQL",
        "sqlite3": "SQLite",
        "better-sqlite3": "SQLite",
        "mongodb": "MongoDB",
        "zod": "Zod",
        "yup": "Yup",
        "passport": "Passport.js",
        "jsonwebtoken": "JWT",
        "bcrypt": "bcrypt",
        "bcryptjs": "bcrypt",
        "dotenv": "dotenv",
        "cors": "CORS",
        "helmet": "Helmet",
        "winston": "Winston",
        "pino": "Pino",
        "stripe": "Stripe",
        "@sentry/node": "Sentry",
        "sharp": "Sharp",
        "multer": "Multer",
        "nodemailer": "Nodemailer",
      };
      for (const [depKey, label] of Object.entries(knownFrameworks)) {
        if (depKey in deps) stack.add(label);
      }

      // Add Node.js if JavaScript/TypeScript and has package.json
      if (metadata?.language === "JavaScript" || metadata?.language === "TypeScript" ||
          "typescript" in deps) {
        stack.add("Node.js");
      }
    } catch { /* ignore */ }
  }

  // Infer from requirements.txt
  const reqFile = files?.find(f => /^requirements([-_]dev)?\.txt$/i.test(f.path.split("/").pop()));
  if (reqFile) {
    const lines = reqFile.content.split("\n").map(l => l.trim().toLowerCase()).filter(Boolean);
    const pyFrameworks = {
      "django": "Django", "flask": "Flask", "fastapi": "FastAPI",
      "sqlalchemy": "SQLAlchemy", "celery": "Celery", "redis": "Redis",
      "pytest": "pytest", "pydantic": "Pydantic", "uvicorn": "Uvicorn",
      "gunicorn": "Gunicorn", "alembic": "Alembic",
    };
    for (const [kw, label] of Object.entries(pyFrameworks)) {
      if (lines.some(l => l.startsWith(kw))) stack.add(label);
    }
    if (metadata?.language === "Python") stack.add("Python");
  }

  // Infer from go.mod
  const goMod = files?.find(f => f.path === "go.mod");
  if (goMod) {
    stack.add("Go");
    const goContent = goMod.content;
    if (goContent.includes("gin-gonic/gin")) stack.add("Gin");
    if (goContent.includes("gorilla/mux")) stack.add("Gorilla Mux");
    if (goContent.includes("labstack/echo")) stack.add("Echo");
    if (goContent.includes("gofiber/fiber")) stack.add("Fiber");
  }

  // Infer from Cargo.toml
  const cargoToml = files?.find(f => /^cargo\.toml$/i.test(f.path.split("/").pop()));
  if (cargoToml) {
    stack.add("Rust");
    const cargoContent = cargoToml.content;
    if (cargoContent.includes("actix-web")) stack.add("Actix Web");
    if (cargoContent.includes("axum")) stack.add("Axum");
    if (cargoContent.includes("tokio")) stack.add("Tokio");
  }

  // Infer from Docker/compose files
  const hasDockerfile = files?.some(f => /^dockerfile/i.test(f.path.split("/").pop()));
  const hasCompose = files?.some(f => /^(docker-compose|compose)\./i.test(f.path.split("/").pop()));
  if (hasDockerfile || hasCompose) stack.add("Docker");
  if (hasCompose) stack.add("Docker Compose");

  // Infer from Prisma schema
  const prismaFile = files?.find(f => /prisma/i.test(f.path) && /\.prisma$/.test(f.path));
  if (prismaFile && !stack.has("Prisma")) stack.add("Prisma");

  // Infer from GraphQL files
  if (classifiedTree?.some(f => f.category === "schema" && /\.(graphql|gql)$/.test(f.path))) {
    stack.add("GraphQL");
  }

  return [...stack].filter(Boolean).slice(0, 15);
}

function buildImportantFiles(files, classifiedTree) {
  const result = [];
  const seen = new Set();

  // Priority order: source/logic files first, then config/docs
  const readOrder = [
    "entry-point", "authentication", "routes", "controllers", "services",
    "schema", "models", "middleware", "database", "utility", "worker",
    "frontend", "component", "tests", "dependencies", "config", "documentation", "deployment",
  ];

  // Track how many of each category we've added to avoid monorepo flooding
  const catCounts = {};
  const MAX_PER_CATEGORY = {
    "config": 3,
    "documentation": 2,
    "deployment": 2,
    "dependencies": 2,
    "tests": 4,
    "backend": 5,
  };

  const sortedFiles = [...(files || [])].sort((a, b) => {
    const ai = readOrder.indexOf(a.category);
    const bi = readOrder.indexOf(b.category);
    // Within same category, sort by importance (high first)
    if (ai === bi) {
      const importanceScore = { high: 3, medium: 2, low: 1 };
      return (importanceScore[b.importance] || 1) - (importanceScore[a.importance] || 1);
    }
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const f of sortedFiles) {
    if (seen.has(f.path)) continue;
    const cat = f.category || "backend";
    const max = MAX_PER_CATEGORY[cat];
    if (max && (catCounts[cat] || 0) >= max) continue;

    seen.add(f.path);
    catCounts[cat] = (catCounts[cat] || 0) + 1;
    const hint = f.responsibilityHint || (f.category ? `${f.category} file` : "Source file");
    result.push({
      path: f.path,
      responsibility: hint,
      importance: f.importance || "medium",
      category: cat,
    });
  }

  // Then: high-importance classified files we know about (not yet read)
  // Prioritize source categories over config/doc
  const classifiedSorted = [...(classifiedTree || [])]
    .filter(f => !seen.has(f.path) && f.importance === "high")
    .sort((a, b) => {
      const ai = readOrder.indexOf(a.category);
      const bi = readOrder.indexOf(b.category);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  for (const f of classifiedSorted) {
    if (result.length >= 25) break;
    seen.add(f.path);
    result.push({
      path: f.path,
      responsibility: f.responsibilityHint || `${f.category} file`,
      importance: f.importance,
      category: f.category,
    });
  }

  return result.slice(0, 25);
}

/**
 * Build architecture nodes as {name, type, path} for the constellation UI.
 * Maps each significant layer/module to a node with a display name and type.
 */
function buildArchitectureNodes(classifiedTree, dirStructure, files) {
  if (!classifiedTree) {
    return [
      { name: "Application", type: "entry" },
      { name: "Routes", type: "api" },
      { name: "Services", type: "logic" },
      { name: "Data", type: "data" },
      { name: "UI", type: "frontend" },
    ];
  }

  const nodes = [];
  const seen = new Set();
  const cats = new Set(classifiedTree.map(f => f.category));

  // Category → display name + type
  const nodeMap = {
    "entry-point":    { name: "Entry Point",     type: "entry" },
    "authentication": { name: "Authentication",  type: "auth" },
    "routes":         { name: "API Routes",       type: "api" },
    "controllers":    { name: "Controllers",      type: "logic" },
    "services":       { name: "Services",         type: "logic" },
    "middleware":     { name: "Middleware",        type: "logic" },
    "models":         { name: "Models",           type: "data" },
    "schema":         { name: "Schema",           type: "data" },
    "database":       { name: "Database",         type: "data" },
    "frontend":       { name: "Frontend UI",      type: "frontend" },
    "component":      { name: "Components",       type: "frontend" },
    "worker":         { name: "Workers",          type: "worker" },
    "tests":          { name: "Test Suite",       type: "test" },
    "config":         { name: "Configuration",    type: "config" },
    "deployment":     { name: "Deployment",       type: "config" },
  };

  // Priority order for the constellation
  const priority = [
    "entry-point", "authentication", "routes", "controllers", "services",
    "middleware", "models", "schema", "database", "frontend", "component",
    "worker", "config", "tests",
  ];

  for (const cat of priority) {
    if (!cats.has(cat)) continue;
    if (seen.has(cat)) continue;
    if (!nodeMap[cat]) continue;

    // Find representative path for this category
    const rep = classifiedTree.find(f => f.category === cat);
    const pathParts = rep?.path?.split("/");
    const nodePath = pathParts?.length > 1 ? pathParts[0] + "/" : rep?.path || "";

    nodes.push({
      name: nodeMap[cat].name,
      type: nodeMap[cat].type,
      path: nodePath,
    });
    seen.add(cat);

    if (nodes.length >= 8) break;
  }

  // Add top-level directories as additional context nodes if we don't have enough
  if (nodes.length < 4 && dirStructure?.topLevel) {
    const dirToType = {
      src: "entry", lib: "logic", app: "entry", api: "api", ui: "frontend",
      frontend: "frontend", backend: "logic", server: "api", web: "frontend",
    };
    for (const d of dirStructure.topLevel) {
      if (nodes.length >= 6) break;
      const nodeName = d.charAt(0).toUpperCase() + d.slice(1);
      if (!seen.has(d)) {
        nodes.push({ name: nodeName, type: dirToType[d.toLowerCase()] || "logic", path: d + "/" });
        seen.add(d);
      }
    }
  }

  // Fallback
  if (nodes.length === 0) {
    return [
      { name: "Application", type: "entry" },
      { name: "Logic", type: "logic" },
      { name: "Data", type: "data" },
    ];
  }

  return nodes.slice(0, 10);
}

/**
 * Build a detailed architecture object for the archDetail field.
 */
function buildArchDetail(classifiedTree, dirStructure, files) {
  if (!classifiedTree) return { summary: "", components: [], patterns: [], relationships: [] };

  const cats = new Set(classifiedTree.map(f => f.category));

  // Components (more detailed version of nodes)
  const componentMap = {
    "entry-point":    (path) => ({ name: "Application Entry",  role: "Initializes and starts the application", path }),
    "authentication": (path) => ({ name: "Authentication",     role: "Login, sessions, tokens, access control", path }),
    "routes":         (path) => ({ name: "API Routes",          role: "HTTP endpoint definitions", path }),
    "controllers":    (path) => ({ name: "Controllers",         role: "Request/response handlers", path }),
    "services":       (path) => ({ name: "Services",            role: "Core business logic layer", path }),
    "models":         (path) => ({ name: "Models",              role: "Data schemas and structures", path }),
    "schema":         (path) => ({ name: "Schema",              role: "Data shapes, GraphQL/Prisma schemas", path }),
    "middleware":     (path) => ({ name: "Middleware",          role: "Request processing pipeline", path }),
    "database":       (path) => ({ name: "Database",            role: "Data persistence layer", path }),
    "frontend":       (path) => ({ name: "Frontend UI",         role: "User interface views and pages", path }),
    "component":      (path) => ({ name: "UI Components",       role: "Reusable interface building blocks", path }),
    "worker":         (path) => ({ name: "Workers/Jobs",        role: "Background and async processing", path }),
    "tests":          (path) => ({ name: "Test Suite",          role: "Automated tests", path }),
    "config":         (path) => ({ name: "Configuration",       role: "Application settings and environment", path }),
    "deployment":     (path) => ({ name: "Deployment",          role: "Containerization/deployment config", path }),
  };

  const components = [];
  const compSeen = new Set();
  for (const [cat, maker] of Object.entries(componentMap)) {
    if (!cats.has(cat) || compSeen.has(cat)) continue;
    const rep = classifiedTree.find(f => f.category === cat);
    const pathParts = rep?.path?.split("/");
    const repPath = pathParts?.length > 1 ? pathParts[0] + "/" : rep?.path || "";
    components.push(maker(repPath));
    compSeen.add(cat);
    if (components.length >= 10) break;
  }

  // Relationships
  const rels = [];
  if (cats.has("entry-point") && cats.has("middleware")) {
    rels.push({ from: "Application Entry", to: "Middleware", description: "Application registers middleware on startup" });
  }
  if (cats.has("entry-point") && cats.has("routes")) {
    rels.push({ from: "Application Entry", to: "API Routes", description: "Application mounts route handlers" });
  }
  if (cats.has("routes") && cats.has("controllers")) {
    rels.push({ from: "API Routes", to: "Controllers", description: "Routes delegate request handling to controllers" });
  }
  if (cats.has("routes") && !cats.has("controllers") && cats.has("services")) {
    rels.push({ from: "API Routes", to: "Services", description: "Routes call service layer directly for business logic" });
  }
  if (cats.has("controllers") && cats.has("services")) {
    rels.push({ from: "Controllers", to: "Services", description: "Controllers call service layer for business logic" });
  }
  if ((cats.has("routes") || cats.has("controllers")) && cats.has("authentication")) {
    rels.push({ from: "Middleware", to: "Authentication", description: "Middleware enforces authentication on protected routes" });
  }
  if (cats.has("services") && (cats.has("models") || cats.has("schema"))) {
    rels.push({ from: "Services", to: cats.has("models") ? "Models" : "Schema", description: "Services interact with data models" });
  }
  if ((cats.has("models") || cats.has("schema")) && cats.has("database")) {
    rels.push({ from: cats.has("models") ? "Models" : "Schema", to: "Database", description: "Models map to database tables/collections" });
  }

  // Arch summary
  const topDirs = (dirStructure?.topLevel || []).slice(0, 6).join(", ");
  const notableSubs = (dirStructure?.notable || []).slice(0, 5).join(", ");
  const summary = [
    topDirs && `Top-level structure: ${topDirs}.`,
    notableSubs && `Key subsystems: ${notableSubs}.`,
    components.length && `Identified ${components.length} architectural components.`,
  ].filter(Boolean).join(" ");

  return {
    summary,
    components: components.slice(0, 8),
    patterns: deriveArchPatterns(classifiedTree, dirStructure),
    relationships: rels.slice(0, 6),
  };
}

function buildRelationships(classifiedTree, dirStructure) {
  if (!classifiedTree) return [];
  const cats = new Set(classifiedTree.map(f => f.category));
  const rels = [];

  if (cats.has("routes") && cats.has("controllers")) {
    rels.push({ from: "routes", to: "controllers", description: "Routes delegate request handling to controllers" });
  }
  if (cats.has("controllers") && cats.has("services")) {
    rels.push({ from: "controllers", to: "services", description: "Controllers call service layer for business logic" });
  }
  if (cats.has("services") && cats.has("models")) {
    rels.push({ from: "services", to: "models", description: "Services interact with data models" });
  }
  if (cats.has("entry-point") && cats.has("middleware")) {
    rels.push({ from: "entry-point", to: "middleware", description: "Application registers middleware on startup" });
  }
  if (cats.has("entry-point") && cats.has("routes")) {
    rels.push({ from: "entry-point", to: "routes", description: "Application mounts route handlers" });
  }
  if (cats.has("models") && cats.has("database")) {
    rels.push({ from: "models", to: "database", description: "Models map to database tables/collections" });
  }

  return rels.slice(0, 5);
}

function deriveArchPatterns(classifiedTree, dirStructure) {
  if (!classifiedTree) return ["Modular"];
  const cats = new Set(classifiedTree.map(f => f.category));
  const patterns = [];

  if (cats.has("routes") && cats.has("controllers") && cats.has("models")) patterns.push("MVC");
  if (cats.has("routes") && cats.has("services")) patterns.push("Service Layer");
  if (cats.has("middleware")) patterns.push("Middleware Pipeline");
  if (cats.has("models") && cats.has("database")) patterns.push("Repository/ORM");
  if (cats.has("frontend") || cats.has("component")) {
    if (cats.has("routes") || cats.has("services")) patterns.push("Client-Server");
  }
  if (cats.has("authentication")) patterns.push("Authentication Middleware");
  if (cats.has("worker")) patterns.push("Background Jobs");
  if (cats.has("schema") && classifiedTree.some(f => /\.(graphql|gql)$/.test(f.path))) {
    patterns.push("GraphQL API");
  }
  if (classifiedTree.some(f => f.path.includes("monorepo") || f.path.includes("packages/"))) {
    patterns.push("Monorepo");
  }

  return patterns.length > 0 ? patterns.slice(0, 6) : ["Modular"];
}

function buildSetupGuide(owner, repo, files, metadata) {
  const prereqs = [];
  const install = [];
  const commands = [];
  const environment = [];

  const lang = metadata?.language || "";
  const hasPkg = files?.some(f => f.path === "package.json");
  const hasDockerfile = files?.some(f => /^dockerfile/i.test(f.path.split("/").pop()));
  const hasDockerCompose = files?.some(f => /^(docker-compose|compose)\./i.test(f.path.split("/").pop()));
  const hasEnvExample = files?.find(f => /^\.env(\.(example|sample|template))?$/i.test(f.path.split("/").pop()) && f.content);
  const hasMakefile = files?.some(f => /^makefile$/i.test(f.path.split("/").pop()));
  const hasPyRequirements = files?.some(f => /^requirements([-_]dev)?\.txt$/i.test(f.path.split("/").pop()));
  const hasGoMod = files?.some(f => f.path === "go.mod");
  const hasCargoToml = files?.some(f => /^cargo\.toml$/i.test(f.path.split("/").pop()));
  const hasPyProject = files?.some(f => /^pyproject\.toml$/.test(f.path));

  // Prerequisites
  if (hasPkg || lang === "JavaScript" || lang === "TypeScript") {
    prereqs.push("Node.js >= 18");
    // Detect package manager from lockfiles
    const hasPnpm = files?.some(f => f.path.includes("pnpm-lock"));
    const hasYarn = files?.some(f => f.path.includes("yarn.lock"));
    if (hasPnpm) prereqs.push("pnpm (npm install -g pnpm)");
    else if (hasYarn) prereqs.push("yarn (npm install -g yarn)");
    else prereqs.push("npm");
  }
  if (lang === "Python" || hasPyRequirements || hasPyProject) {
    prereqs.push("Python >= 3.8", "pip or uv");
  }
  if (lang === "Go" || hasGoMod) {
    prereqs.push("Go >= 1.20");
  }
  if (lang === "Rust" || hasCargoToml) {
    prereqs.push("Rust (latest stable)", "cargo");
  }
  if (hasDockerCompose) {
    prereqs.push("Docker and Docker Compose");
  } else if (hasDockerfile) {
    prereqs.push("Docker");
  }

  if (prereqs.length === 0) prereqs.push("See README for prerequisites");

  // Git clone always first
  install.push(`git clone https://github.com/${owner}/${repo}`);
  install.push(`cd ${repo}`);

  // Environment setup
  if (hasEnvExample) {
    install.push("cp .env.example .env");
    install.push("# Edit .env with your local values");
  }

  // Package installation
  if (hasDockerCompose) {
    install.push("docker compose up --build");
  } else if (hasPkg) {
    // Detect actual package manager from lockfiles
    const pnpmLock = files?.find(f => f.path.includes("pnpm-lock"));
    const yarnLock = files?.find(f => f.path.includes("yarn.lock"));
    if (pnpmLock) install.push("pnpm install");
    else if (yarnLock) install.push("yarn install");
    else install.push("npm install");
  } else if (hasPyRequirements) {
    install.push("pip install -r requirements.txt");
  } else if (hasPyProject) {
    install.push("pip install -e .");
  } else if (hasGoMod) {
    install.push("go mod download");
  } else if (hasCargoToml) {
    install.push("cargo build");
  }

  // Extract env vars from .env.example
  if (hasEnvExample?.content) {
    const lines = hasEnvExample.content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Z_][A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) {
        const varName = m[1];
        const exampleVal = m[2];
        // Skip common/obvious vars
        if (["NODE_ENV", "PORT"].includes(varName)) continue;
        environment.push(exampleVal ? `${varName}=${exampleVal}` : `${varName}=`);
      }
    }
  }

  if (environment.length === 0 && hasEnvExample) {
    environment.push("# See .env.example for required environment variables");
  }

  // Commands from package.json scripts
  const pkgFile = files?.find(f => f.path === "package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      const pnpmLock = files?.find(f => f.path.includes("pnpm-lock"));
      const yarnLock = files?.find(f => f.path.includes("yarn.lock"));
      const pkgMgr = pnpmLock ? "pnpm" : yarnLock ? "yarn" : "npm";
      const runner = pkgMgr === "npm" ? "npm run" : pkgMgr;

      if (pkg.scripts?.dev) commands.push(`${runner} dev`);
      else if (pkg.scripts?.start) commands.push(`${runner === "npm run" ? "npm" : pkgMgr} start`);

      if (pkg.scripts?.build) commands.push(`${runner} build`);
      if (pkg.scripts?.test) commands.push(`${runner === "npm run" ? "npm" : pkgMgr} test`);
      if (pkg.scripts?.lint) commands.push(`${runner} lint`);
      if (pkg.scripts?.["type-check"] || pkg.scripts?.typecheck) commands.push(`${runner} type-check`);
    } catch { /* ignore */ }
  }

  if (hasDockerCompose && commands.length === 0) {
    commands.push("docker compose up");
    commands.push("docker compose down");
  }

  if (hasMakefile) {
    commands.push("make");
    commands.push("make help  # (if available)");
  }

  if (lang === "Python" || hasPyRequirements) {
    if (commands.length === 0) commands.push("python -m uvicorn main:app --reload  # if FastAPI/Uvicorn");
    commands.push("pytest");
  }

  if (lang === "Go" || hasGoMod) {
    if (commands.length === 0) commands.push("go run .");
    commands.push("go test ./...");
  }

  if (lang === "Rust" || hasCargoToml) {
    if (commands.length === 0) commands.push("cargo run");
    commands.push("cargo test");
  }

  // Deduplicate
  const uniqInstall = [...new Set(install)];
  const uniqCommands = [...new Set(commands)].slice(0, 6);
  const uniqEnv = [...new Set(environment)].slice(0, 15);

  return { prerequisites: prereqs, install: uniqInstall, commands: uniqCommands, environment: uniqEnv };
}

function buildMissions(owner, repo, classifiedTree, dirStructure, files) {
  if (!classifiedTree) return defaultMissions(owner, repo);

  const cats = new Set(classifiedTree.map(f => f.category));
  const missions = [];
  let id = 1;

  // Mission 1: always — understand entry point
  const entryFiles = classifiedTree.filter(f => f.category === "entry-point").map(f => f.path);
  const configFiles = classifiedTree.filter(f => f.category === "config").map(f => f.path);
  missions.push({
    id: id++,
    title: "Find the application entry point",
    description: "Locate and read the main application entry point to understand how the application initializes, what middleware or plugins are registered, and how it starts. Look for bootstrap patterns and startup configuration.",
    difficulty: "beginner",
    files: [...entryFiles.slice(0, 2), ...configFiles.slice(0, 1)],
    skills: ["codebase orientation", "application bootstrapping"],
  });

  // Mission 2: trace an API request (if routes exist)
  if (cats.has("routes") || cats.has("controllers")) {
    const routeFiles = classifiedTree.filter(f => f.category === "routes").map(f => f.path);
    const controllerFiles = classifiedTree.filter(f => f.category === "controllers").map(f => f.path);
    const serviceFiles = classifiedTree.filter(f => f.category === "services").map(f => f.path);
    missions.push({
      id: id++,
      title: "Trace an API request end-to-end",
      description: "Pick one endpoint from the routes and follow the code path from the route definition through the controller and service (if any) to the response. Understand what happens at each step, including any middleware that runs.",
      difficulty: "intermediate",
      files: [...routeFiles.slice(0, 2), ...controllerFiles.slice(0, 1), ...serviceFiles.slice(0, 1)],
      skills: ["request lifecycle", "route handling", "HTTP flow"],
    });
  }

  // Mission 3: explore authentication if auth files are present
  // Prefer classified authentication files; fall back to path-keyword matches
  // but exclude CI scripts, docs, config, and build files
  const skipAuthDirs = /(\.github|scripts|docs?|ci|config|deploy|test|spec|__tests__)\//i;
  const authFiles = [
    // Highest quality: files explicitly classified as authentication
    ...classifiedTree.filter(f => f.category === "authentication" && !skipAuthDirs.test(f.path)),
    // Fallback: source files with auth-related names (not in skip dirs)
    ...classifiedTree.filter(f =>
      f.category !== "authentication" &&
      f.category !== "documentation" &&
      f.category !== "build" &&
      f.category !== "config" &&
      !skipAuthDirs.test(f.path) &&
      (f.path.toLowerCase().includes("auth") ||
       f.path.toLowerCase().includes("login") ||
       f.path.toLowerCase().includes("session") ||
       f.path.toLowerCase().includes("jwt"))
    ),
  ].map(f => f.path).filter((v, i, a) => a.indexOf(v) === i); // dedupe
  if (authFiles.length > 0) {
    missions.push({
      id: id++,
      title: "Understand authentication and authorization",
      description: "Find authentication-related files and understand how the application handles login, sessions, or tokens. Identify how access control is enforced and which routes are protected.",
      difficulty: "intermediate",
      files: authFiles.slice(0, 4),
      skills: ["security", "authentication flow", "JWT/sessions"],
    });
  }

  // Mission 4: database layer (if db/models/schema exist)
  if (cats.has("database") || cats.has("models") || cats.has("schema")) {
    const dbFiles = [
      ...classifiedTree.filter(f => f.category === "database").map(f => f.path),
      ...classifiedTree.filter(f => f.category === "models").map(f => f.path),
      ...classifiedTree.filter(f => f.category === "schema").map(f => f.path),
    ];
    missions.push({
      id: id++,
      title: "Explore the data layer",
      description: "Locate the database configuration and models/schemas. Understand how data is structured, stored, and queried. Look for migrations if they exist and understand the entity relationships.",
      difficulty: "intermediate",
      files: dbFiles.slice(0, 4),
      skills: ["data modeling", "database access", "ORM/migrations"],
    });
  }

  // Mission 5: run tests (if tests exist)
  if (cats.has("tests")) {
    const testFiles = classifiedTree.filter(f => f.category === "tests").map(f => f.path);
    const pkgFile = files?.find(f => f.path === "package.json");
    let testCommand = null;
    if (pkgFile) {
      try {
        const pkg = JSON.parse(pkgFile.content);
        if (pkg.scripts?.test) testCommand = "npm test";
      } catch { /* ignore */ }
    }
    missions.push({
      id: id++,
      title: "Run the test suite and understand coverage",
      description: `Find and run the automated tests. Read a few test files to understand what is being tested and how tests are structured.${testCommand ? ` Start with \`${testCommand}\` to verify everything passes.` : ""}`,
      difficulty: "beginner",
      files: testFiles.slice(0, 3),
      skills: ["testing", "quality assurance", "TDD"],
    });
  }

  // Mission 6: understand a key service or feature (if services exist)
  if (cats.has("services")) {
    const svcFiles = classifiedTree.filter(f => f.category === "services").map(f => f.path);
    missions.push({
      id: id++,
      title: "Understand a core service",
      description: "Pick the most important service file and understand its responsibilities. Trace how it interacts with the data layer and how other parts of the system call it.",
      difficulty: "intermediate",
      files: svcFiles.slice(0, 3),
      skills: ["business logic", "service layer", "separation of concerns"],
    });
  }

  // Mission 7: make a first contribution
  const bestChangeCandidate = classifiedTree.find(f =>
    f.category === "services" || f.category === "utility" || f.category === "routes"
  );
  if (missions.length < 6) {
    missions.push({
      id: id++,
      title: "Make a first safe change",
      description: "Identify a simple improvement — a helpful comment, a small refactor, or a new utility function. Make the change, run the tests, and verify nothing broke. This mission builds contributor confidence.",
      difficulty: "beginner",
      files: bestChangeCandidate ? [bestChangeCandidate.path] : [],
      skills: ["contribution workflow", "code modification", "git"],
    });
  }

  return missions.slice(0, 7);
}

function defaultMissions(owner, repo) {
  return [
    {
      id: 1,
      title: "Read the README",
      description: "Start by reading the README to understand what this project does and how to get started.",
      difficulty: "beginner",
      files: ["README.md"],
      skills: ["project orientation"],
    },
    {
      id: 2,
      title: "Explore the file structure",
      description: "Browse the top-level directories and understand how the code is organized.",
      difficulty: "beginner",
      files: [],
      skills: ["codebase navigation"],
    },
  ];
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

function extractJson(raw) {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new Error(
      "Could not parse AI response as JSON. Raw output: " + raw.slice(0, 300)
    );
  }
}

/**
 * Validate and normalize the analysis output.
 *
 * The frontend's normalize() function does:
 *   {...fallback, ...d, technologies: d?.technologies||[], ...}
 *
 * So ALL fields must be at the TOP LEVEL of the response.
 * This function maps any nested structure to the flat shape.
 */
function normalizeAnalysis(data, provider, repoData) {
  // Handle watsonx responses that may return nested overview/architecture shapes
  // by flattening them to the top-level shape the frontend expects.

  // Extract fields — support both flat (mock) and nested (watsonx prompt) shapes
  const summary = data?.summary ||
    data?.overview?.summary ||
    (repoData?.metadata?.description || `${repoData?.owner}/${repoData?.repo} repository`);

  const language = data?.language ||
    data?.overview?.language ||
    repoData?.metadata?.language || "";

  const repoName = data?.repoName ||
    data?.overview?.repoName ||
    (repoData ? `${repoData.owner}/${repoData.repo}` : "");

  const description = data?.description ||
    data?.overview?.purpose ||
    repoData?.metadata?.description || "";

  // Technologies — support both flat array and nested techStack
  let technologies = data?.technologies ||
    data?.overview?.techStack || [];
  if (!Array.isArray(technologies)) technologies = [];

  // Patterns — support both flat array and nested
  let patterns = data?.patterns ||
    data?.architecture?.patterns || [];
  if (!Array.isArray(patterns)) patterns = [];

  // Architecture nodes — must be [{name, type}] for the constellation UI
  // Support both flat array and nested components
  let architectureRaw = data?.architecture;
  let architecture = [];

  if (Array.isArray(architectureRaw)) {
    // Already flat array (mock format or correctly shaped)
    architecture = architectureRaw;
  } else if (architectureRaw?.components && Array.isArray(architectureRaw.components)) {
    // Nested watsonx format — map components to flat nodes
    architecture = architectureRaw.components.map(c => ({
      name: c.name || c.role || "Module",
      type: c.type || c.category || "logic",
      path: c.path || "",
    }));
  }

  // Key files — support both keyFiles and files
  let keyFiles = data?.keyFiles || data?.files || [];
  if (!Array.isArray(keyFiles)) keyFiles = [];

  // Entry points
  let entryPoints = data?.entryPoints || [];
  if (!Array.isArray(entryPoints)) entryPoints = [];

  // Setup — must have { prerequisites, install, commands, environment }
  let setupRaw = data?.setup || data?.setupGuide || {};
  let setup = {
    prerequisites: [],
    install: [],
    commands: [],
    environment: [],
  };

  if (setupRaw) {
    // Support flat setup shape
    setup.prerequisites = Array.isArray(setupRaw.prerequisites) ? setupRaw.prerequisites : [];
    setup.install = Array.isArray(setupRaw.install) ? setupRaw.install : [];
    setup.commands = Array.isArray(setupRaw.commands) ? setupRaw.commands : [];
    setup.environment = Array.isArray(setupRaw.environment) ? setupRaw.environment : [];

    // Support legacy shape from watsonx: steps[] and envVars[]
    if (setup.install.length === 0 && Array.isArray(setupRaw.steps)) {
      setup.install = setupRaw.steps
        .filter(s => s.command)
        .map(s => s.command)
        .slice(0, 6);
    }
    if (setup.environment.length === 0 && Array.isArray(setupRaw.envVars)) {
      setup.environment = setupRaw.envVars.map(v => v.name + (v.description ? `  # ${v.description}` : ""));
    }
  }

  // Missions
  let missions = data?.missions || [];
  if (!Array.isArray(missions)) missions = [];

  // archDetail — the richer nested architecture data
  const archDetail = data?.archDetail || {
    summary: data?.architecture?.summary || "",
    components: Array.isArray(data?.architecture?.components) ? data.architecture.components : [],
    patterns,
    relationships: Array.isArray(data?.architecture?.relationships) ? data.architecture.relationships : [],
  };

  // Repo stats
  const repoStats = data?.repoStats || repoData?.fileStats || {};

  const normalized = {
    _provider: provider,
    // --- Top-level fields the frontend normalize() reads directly ---
    summary,
    language,
    technologies: technologies.slice(0, 15),
    patterns: patterns.slice(0, 8),
    architecture: architecture.slice(0, 10),
    keyFiles: keyFiles.slice(0, 25),
    setup,
    missions,
    // --- Extended fields ---
    repoName,
    description,
    entryPoints,
    archDetail,
    repoStats,
  };

  // Coerce arrays
  if (!Array.isArray(normalized.setup.prerequisites)) normalized.setup.prerequisites = [];
  if (!Array.isArray(normalized.setup.install))       normalized.setup.install = [];
  if (!Array.isArray(normalized.setup.commands))      normalized.setup.commands = [];
  if (!Array.isArray(normalized.setup.environment))   normalized.setup.environment = [];

  // Ensure repoName
  if (!normalized.repoName && repoData) {
    normalized.repoName = `${repoData.owner}/${repoData.repo}`;
  }

  // Ensure language from metadata if still missing
  if (!normalized.language && repoData?.metadata?.language) {
    normalized.language = repoData.metadata.language;
  }

  // Ensure key files have required fields
  normalized.keyFiles = normalized.keyFiles.map(f => ({
    path: f.path || "",
    responsibility: f.responsibility || f.responsibilityHint || f.role || "",
    importance: ["high", "medium", "low"].includes(f.importance) ? f.importance : "medium",
    category: f.category || "backend",
  })).filter(f => f.path);

  // Ensure architecture nodes have required fields
  normalized.architecture = normalized.architecture.map(n => ({
    name: n.name || n.title || "Module",
    type: n.type || n.category || "logic",
    path: n.path || "",
  }));

  // Ensure missions have required fields
  normalized.missions = normalized.missions.map((m, i) => ({
    id: m.id || i + 1,
    title: m.title || `Mission ${i + 1}`,
    description: m.description || "",
    difficulty: ["beginner", "intermediate", "advanced"].includes(m.difficulty) ? m.difficulty : "beginner",
    files: Array.isArray(m.files) ? m.files : [],
    skills: Array.isArray(m.skills) ? m.skills : [],
  }));

  return normalized;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a repository and return structured JSON.
 * repoData comes from ingestRepo() in github.js.
 */
export async function analyzeRepo(repoData) {
  let provider = resolveProvider();
  let raw;

  if (provider === "watsonx") {
    console.log(
      `[analyze] Using watsonx provider (model: ${
        process.env.WATSONX_MODEL || "ibm/granite-3-8b-instruct"
      })`
    );

    raw = await callWatsonx(buildAnalysisPrompt(repoData));
  } else if (provider === "router") {
    console.log("[analyze] Using multi-provider AI router");

    const result = await callAI(buildAnalysisPrompt(repoData));

    raw = result.text;
    provider = result.provider;

    console.log(
      `[analyze] AI provider selected: ${result.provider} (${result.model})`
    );
  } else {
    console.log(
      `[analyze] Using mock provider (AI_PROVIDER=${
        process.env.AI_PROVIDER || "mock"
      })`
    );

    raw = callMock(repoData);
  }

  const parsed = extractJson(raw);
  return normalizeAnalysis(parsed, provider, repoData);
}

/**
 * Answer a question about a repository using cached context.
 * repoContext comes from the server's in-memory cache.
 *
 * Returns a structured object:
 *   { answer, relevantFiles, selectionReason, provider, isMock }
 */
export async function askQuestion(repoContext, question, contextOverride) {
  let provider = resolveProvider();
  let isMock = provider === "mock";

  // Build a lookup for category by path from classifiedTree (covers all repo files)
  const categoryByPath = new Map();
  for (const f of (repoContext.classifiedTree || [])) {
    categoryByPath.set(f.path, f.category || null);
  }

  // Build context — use caller-supplied files first, then auto-select
  let contextFiles;
  // Extra priority-only entries (paths in contextOverride that have no fetched content)
  let extraPriorityFiles = [];

  if (contextOverride && Array.isArray(contextOverride) && contextOverride.length > 0) {
    // Caller provided prioritised file paths — resolve them from fetched files cache
    const fetchedByPath = new Map(
      (repoContext.files || []).map(f => [f.path, f])
    );
    const prioritySet = new Set(contextOverride);

    // Files that have full content
    const prioritisedWithContent = contextOverride
      .filter(p => fetchedByPath.has(p))
      .map(p => {
        const f = fetchedByPath.get(p);
        return { path: f.path, content: f.content || "", category: categoryByPath.get(f.path) || f.category || null };
      });

    // Files that are in classifiedTree but content wasn't fetched — still surface them in relevantFiles
    extraPriorityFiles = contextOverride
      .filter(p => !fetchedByPath.has(p) && categoryByPath.has(p))
      .map(p => ({ path: p, category: categoryByPath.get(p) }));

    const rest = (repoContext.files || [])
      .filter(f => !prioritySet.has(f.path))
      .map(f => ({ path: f.path, content: f.content || "", category: categoryByPath.get(f.path) || f.category || null }));

    // Also run the standard ranker on the remainder so we still fill the budget
    const rankedRest = rankFilesForQuestion(rest, question);
    const merged = [...prioritisedWithContent, ...rankedRest];
    let budget = 8000;
    const selected = [];
    for (const f of merged) {
      if (budget <= 0) break;
      const snippet = f.content.slice(0, Math.min(3000, budget));
      selected.push({ path: f.path, category: f.category, snippet });
      budget -= snippet.length;
    }
    contextFiles = selected;
  } else {
    contextFiles = buildAskContext(repoContext, question);
  }

  // relevantFiles = priority files (content or not) first, then context files
  const contextFilePaths = new Set(contextFiles.map(f => f.path));
  const relevantFiles = [
    ...extraPriorityFiles,
    ...contextFiles.map(f => ({ path: f.path, category: f.category || null })),
  ].filter((f, i, arr) => arr.findIndex(x => x.path === f.path) === i); // dedupe

  const selectionReason = contextOverride && contextOverride.length > 0
    ? "Files were prioritised from the associated mission context, supplemented by keyword relevance ranking."
    : "Files were selected by keyword relevance ranking against the question text.";

  if (
    provider === "watsonx" ||
    provider === "groq" ||
    provider === "router"
  ) {
    // Build a prompt using the already-selected context files
    const { owner, repo } = repoContext;

    const fileText = contextFiles
      .map(
        f =>
          `--- ${f.path}${f.category ? ` [${f.category}]` : ""} ---\n${f.snippet}`
      )
      .join("\n\n");

    // Include repo overview context
    const meta = repoContext.metadata;

    const overviewContext = [
      meta?.description && `Repository: ${owner}/${repo} — ${meta.description}`,
      meta?.language && `Primary language: ${meta.language}`,
      meta?.topics?.length && `Topics: ${meta.topics.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = `You are CodePilot, an expert software engineer. The developer is asking about the repository ${owner}/${repo}.

REPOSITORY OVERVIEW:

${overviewContext}

RELEVANT REPOSITORY FILES (selected based on your question):

${fileText}

DEVELOPER QUESTION: ${question}

Answer concisely and accurately based on the actual code above. If the answer is not directly visible in the provided files, say so honestly rather than guessing. Keep the answer under 400 words. Format code references as \`filename\` or \`function()\`.`;

    let raw;
    let responseProvider = provider;

    try {
      if (provider === "router") {
        const result = await callAI(prompt);

        raw = result.text;
        responseProvider = result.provider;

        console.log(
          `[ask] AI provider selected: ${result.provider} (${result.model})`
        );
      } else if (provider === "groq") {
        raw = await callGroq(prompt);
      } else {
        raw = await callWatsonx(prompt);
      }
    } catch (err) {
      throw err;
    }

    return {
      answer: raw.trim(),
      relevantFiles,
      selectionReason,
      provider: responseProvider,
      isMock: false,
    };
  }

  // Mock provider — produce a repository-grounded but clearly labelled response
  const { owner, repo } = repoContext;
  const fileList = relevantFiles.length > 0
    ? relevantFiles.map(f => `• ${f.path}${f.category ? ` (${f.category})` : ""}`).join("\n")
    : "• No files indexed yet";

  // Build a useful snippet summary from the top context file
  const topFile = contextFiles[0];
  let snippetHint = "";
  if (topFile && topFile.snippet && topFile.snippet.length > 0) {
    const lines = topFile.snippet.split("\n").slice(0, 8).join("\n");
    snippetHint = `\n\nFirst lines of \`${topFile.path}\`:\n\`\`\`\n${lines}\n\`\`\``;
  }

  // Include repository overview context
  const meta = repoContext.metadata;
  const repoDesc = meta?.description ? ` — ${meta.description}` : "";
  const repoLang = meta?.language ? ` (${meta.language})` : "";
  const repoTopics = meta?.topics?.length ? `\n**Topics:** ${meta.topics.join(", ")}` : "";

  const answer =
    `⚠️ **Mock provider** — this is not a real AI response. Set \`AI_PROVIDER=watsonx\` with valid credentials in \`backend/.env\` to get real answers.\n\n` +
    `**Repository:** \`${owner}/${repo}\`${repoDesc}${repoLang}${repoTopics}\n` +
    `**Your question:** "${question}"\n\n` +
    `**Most relevant files identified for this question:**\n${fileList}` +
    snippetHint + `\n\n` +
    `These files were selected because their paths and content match keywords from your question. ` +
    `A real AI model would read their content and give you a precise, grounded answer.`;

  return {
    answer,
    relevantFiles,
    selectionReason,
    provider: "mock",
    isMock: true,
  };
}
