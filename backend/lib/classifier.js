/**
 * File classifier — assigns category, importance, and responsibility hints
 * based on file path patterns, file name, and (optionally) content signals.
 *
 * Categories:
 *   entry-point | config | routes | controllers | services | models |
 *   middleware | tests | documentation | frontend | backend | database |
 *   build | deployment | dependencies | authentication | schema |
 *   utility | component | worker | example
 */

// ---------------------------------------------------------------------------
// Pattern tables
// ---------------------------------------------------------------------------

/** Path/name patterns → category.
 * pathOnly: true means the pattern is tested against the full path only (not the bare filename).
 * Use pathOnly for patterns that rely on path structure to avoid false positives.
 */
const CATEGORY_PATTERNS = [
  // Entry points — pathOnly because index.ts/main.ts exist in many subdirectories
  { pattern: /^(src\/|lib\/)?index\.(js|ts|mjs|cjs)$/i,        category: "entry-point",    importance: "high", pathOnly: true },
  { pattern: /^(src\/|lib\/)?main\.(js|ts|mjs|py|go|rs)$/i,    category: "entry-point",    importance: "high", pathOnly: true },
  { pattern: /^(src\/)?app\.(js|ts|mjs|py)$/i,                  category: "entry-point",    importance: "high", pathOnly: true },
  { pattern: /^server\.(js|ts|mjs|py)$/i,                       category: "entry-point",    importance: "high", pathOnly: true },
  { pattern: /^(src\/)?server\.(js|ts|mjs|py)$/i,               category: "entry-point",    importance: "high", pathOnly: true },
  { pattern: /^(bin|cmd)\//i,                                    category: "entry-point",    importance: "high" },
  { pattern: /^src\/index\.(jsx|tsx)$/i,                         category: "entry-point",    importance: "high", pathOnly: true },
  // A top-level index in any "src" or package root (at most 2 levels deep) is an entry
  { pattern: /^[^/]+\/src\/index\.(js|ts|mjs|tsx|jsx)$/i,       category: "entry-point",    importance: "high", pathOnly: true },

  // Authentication
  { pattern: /(\/|^)auth\//i,                                    category: "authentication", importance: "high" },
  { pattern: /(\/|^)authentication\//i,                          category: "authentication", importance: "high" },
  { pattern: /auth\.(js|ts|py|go|rb)$/i,                        category: "authentication", importance: "high" },
  { pattern: /(passport|jwt|oauth|session)\.(js|ts|py)$/i,      category: "authentication", importance: "high" },
  { pattern: /login\.(js|ts|py|jsx|tsx)$/i,                     category: "authentication", importance: "high" },

  // Configuration
  { pattern: /^\.env(\.example|\.sample|\.template|\.local)?$/i, category: "config",        importance: "high" },
  { pattern: /\.(config|conf|cfg|ini)\.(js|ts|json|yaml|yml|toml)$/i, category: "config",   importance: "medium" },
  { pattern: /^(webpack|rollup|vite|babel|jest|vitest|eslint|prettier|tsconfig|jsconfig)\./i, category: "config", importance: "medium" },
  { pattern: /^(docker-compose|compose)\.(ya?ml)$/i,            category: "deployment",     importance: "high" },
  { pattern: /^dockerfile(\.[\w]+)?$/i,                          category: "deployment",     importance: "high" },
  { pattern: /\.(github|gitlab)\//i,                             category: "build",          importance: "low" },
  { pattern: /^(\.github\/workflows|\.circleci|\.travis\.yml|jenkinsfile)/i, category: "build", importance: "medium" },
  { pattern: /^makefile$/i,                                      category: "build",          importance: "medium" },

  // Dependencies / manifests
  { pattern: /^package\.json$/i,                                 category: "dependencies",   importance: "high" },
  { pattern: /^(requirements|requirements-dev|constraints)\.txt$/i, category: "dependencies", importance: "high" },
  { pattern: /^(pyproject|setup)\.toml$/i,                      category: "dependencies",   importance: "high" },
  { pattern: /^cargo\.toml$/i,                                   category: "dependencies",   importance: "high" },
  { pattern: /^go\.(mod|sum)$/i,                                 category: "dependencies",   importance: "high" },
  { pattern: /^pom\.xml$/i,                                      category: "dependencies",   importance: "high" },
  { pattern: /^(build\.gradle|settings\.gradle)/i,               category: "dependencies",   importance: "high" },
  { pattern: /^gemfile$/i,                                       category: "dependencies",   importance: "high" },

  // Documentation
  { pattern: /^readme(\.(md|txt|rst))?$/i,                      category: "documentation",  importance: "high" },
  { pattern: /^(docs?|documentation)\//i,                        category: "documentation",  importance: "medium" },
  { pattern: /\.(md|rst)$/i,                                     category: "documentation",  importance: "low" },
  { pattern: /^(changelog|license|contributing|code_of_conduct|authors)\.(md|txt)?$/i, category: "documentation", importance: "low" },

  // Routes / API
  { pattern: /(\/|^)routes?\//i,                                 category: "routes",         importance: "high" },
  { pattern: /(\/|^)router(s)?\.(js|ts|py)$/i,                  category: "routes",         importance: "high" },
  { pattern: /route[s]?\.(js|ts|py)$/i,                         category: "routes",         importance: "high" },
  { pattern: /(\/|^)api\//i,                                     category: "routes",         importance: "high" },
  { pattern: /api\.(js|ts|py)$/i,                               category: "routes",         importance: "high" },
  { pattern: /(\/|^)handlers?\//i,                               category: "routes",         importance: "high" },
  { pattern: /handler\.(js|ts|py)$/i,                           category: "routes",         importance: "high" },

  // Controllers
  { pattern: /(\/|^)controllers?\//i,                            category: "controllers",    importance: "high" },
  { pattern: /controller\.(js|ts|py|rb|java)$/i,                category: "controllers",    importance: "high" },
  { pattern: /\.controller\.(js|ts)$/i,                         category: "controllers",    importance: "high" },

  // Services
  { pattern: /(\/|^)services?\//i,                               category: "services",       importance: "high" },
  { pattern: /service\.(js|ts|py|rb|java)$/i,                   category: "services",       importance: "high" },
  { pattern: /\.service\.(js|ts)$/i,                            category: "services",       importance: "high" },

  // Models / Schema
  { pattern: /(\/|^)models?\//i,                                 category: "models",         importance: "high" },
  { pattern: /model\.(js|ts|py|rb|java)$/i,                     category: "models",         importance: "high" },
  { pattern: /\.model\.(js|ts)$/i,                              category: "models",         importance: "high" },
  { pattern: /(\/|^)(entity|entities)\//i,                       category: "models",         importance: "high" },
  { pattern: /(\/|^)schema(s)?\//i,                              category: "schema",         importance: "high" },
  { pattern: /schema\.(js|ts|py|json|graphql|gql)$/i,           category: "schema",         importance: "high" },
  { pattern: /\.(graphql|gql)$/i,                               category: "schema",         importance: "high" },
  { pattern: /\.prisma$/i,                                       category: "schema",         importance: "high" },

  // Middleware
  { pattern: /(\/|^)middlewares?\//i,                            category: "middleware",     importance: "high" },
  { pattern: /middleware\.(js|ts|py)$/i,                        category: "middleware",     importance: "high" },
  { pattern: /\.middleware\.(js|ts)$/i,                         category: "middleware",     importance: "high" },

  // Database
  { pattern: /(\/|^)(db|database|migrations?|seeds?|repositories?|repos?)\//i, category: "database", importance: "high" },
  { pattern: /(db|database)\.(js|ts|py|json)$/i,                category: "database",       importance: "high" },
  { pattern: /\.(sql)$/i,                                       category: "database",       importance: "medium" },
  { pattern: /knexfile\.(js|ts)$/i,                              category: "database",       importance: "high" },
  { pattern: /drizzle\.config\.(js|ts)$/i,                       category: "database",       importance: "high" },

  // Tests
  { pattern: /(\/|^)(__tests__|test|tests|spec|specs|e2e)\//i,  category: "tests",          importance: "medium" },
  { pattern: /\.(test|spec)\.(js|ts|jsx|tsx|py|rb)$/i,         category: "tests",          importance: "medium" },
  { pattern: /test_.*\.(py|rb)$/i,                              category: "tests",          importance: "medium" },
  { pattern: /cypress\.config\.(js|ts)$/i,                       category: "tests",          importance: "medium" },
  { pattern: /playwright\.config\.(js|ts)$/i,                    category: "tests",          importance: "medium" },

  // Frontend / Components
  { pattern: /(\/|^)(src\/components?|components?|ui)\//i,      category: "component",      importance: "medium" },
  { pattern: /(\/|^)(views?|pages?)\//i,                         category: "frontend",       importance: "medium" },
  { pattern: /\.(jsx|tsx|vue|svelte)$/i,                        category: "frontend",       importance: "medium" },
  { pattern: /\.(css|scss|sass|less|styl)$/i,                   category: "frontend",       importance: "low" },

  // Utilities / Helpers
  { pattern: /(\/|^)(utils?|helpers?|lib|common|shared)\//i,    category: "utility",        importance: "medium" },
  { pattern: /(util|helper|common)\.(js|ts|py)$/i,              category: "utility",        importance: "medium" },

  // Workers / Background jobs
  { pattern: /(\/|^)(workers?|jobs?|queues?|tasks?)\//i,        category: "worker",         importance: "medium" },
  { pattern: /(worker|job|queue|task)\.(js|ts|py)$/i,           category: "worker",         importance: "medium" },

  // Examples
  { pattern: /(\/|^)(examples?|demos?|samples?)\//i,             category: "example",        importance: "low" },

  // Deployment
  { pattern: /\.(tf|hcl)$/i,                                    category: "deployment",     importance: "medium" },
  { pattern: /kubernetes|k8s\//i,                                category: "deployment",     importance: "medium" },
  { pattern: /helm\//i,                                          category: "deployment",     importance: "medium" },
  { pattern: /\.(yaml|yml)$/i,                                   category: "config",         importance: "low" },
];

/** Keywords that bump a file's importance to "high" if found in its path */
const HIGH_IMPORTANCE_KEYWORDS = [
  "auth", "authentication", "authorization", "security",
  "payment", "billing", "webhook",
  "api", "gateway", "core",
];

// ---------------------------------------------------------------------------
// Responsibility hints by category
// ---------------------------------------------------------------------------

const RESPONSIBILITY_HINTS = {
  "entry-point":     "Application entry point — initializes and starts the application",
  "config":          "Configuration — controls application settings and environment",
  "routes":          "Routes/API — defines URL endpoints and maps them to handlers",
  "controllers":     "Controller — handles HTTP request/response logic",
  "services":        "Service — contains core business logic",
  "models":          "Model/schema — defines data structures",
  "schema":          "Schema — defines data shapes, validation rules, or database structure",
  "middleware":      "Middleware — processes requests before they reach route handlers",
  "database":        "Database — manages data storage and queries",
  "tests":           "Tests — automated tests for application logic",
  "documentation":   "Documentation — describes the project or how to use it",
  "frontend":        "Frontend — user interface component or view",
  "component":       "UI Component — reusable interface building block",
  "dependencies":    "Dependencies manifest — lists project packages and versions",
  "build":           "Build/CI — automates building, testing, or deploying",
  "deployment":      "Deployment — defines containerization or deployment configuration",
  "authentication":  "Authentication — handles login, sessions, tokens, and access control",
  "utility":         "Utility/Helper — shared helper functions and common utilities",
  "worker":          "Worker/Job — background processing or async job handling",
  "example":         "Example — demonstrates how to use the system",
};

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a single file given its path (and optional content snippet).
 * Returns { category, importance, responsibilityHint }.
 * Returns null if the file should be skipped (binary-looking or insignificant).
 */
export function classifyFile(path, contentSnippet = "") {
  const lower = path.toLowerCase();
  const name = path.split("/").pop().toLowerCase();

  // Skip obviously unhelpful files
  if (/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|mp3|pdf|zip|tar|gz|min\.js|min\.css|map)$/.test(lower)) {
    return null;
  }
  if (/package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock/.test(lower)) {
    return null;
  }
  // Skip deeply nested node_modules, vendor etc.
  if (/node_modules|\.git\/|vendor\//.test(lower)) {
    return null;
  }

  let category = null;
  let importance = "low";

  for (const rule of CATEGORY_PATTERNS) {
    // pathOnly rules are only tested against the full path (not just the filename)
    const matches = rule.pathOnly
      ? rule.pattern.test(path)
      : (rule.pattern.test(path) || rule.pattern.test(name));
    if (matches) {
      category = rule.category;
      importance = rule.importance;
      break;
    }
  }

  // Keyword boost — only bump importance, not change category (except for auth paths without category)
  if (HIGH_IMPORTANCE_KEYWORDS.some((kw) => lower.includes(kw))) {
    importance = "high";
    // Only set auth category for files that don't already have one and have auth-related names
    // Do NOT override documentation, deployment, config, dependencies categories
    const noOverrideCategories = new Set(["documentation", "deployment", "config", "dependencies", "build", "tests"]);
    if (!category && !noOverrideCategories.has(category) &&
        (lower.includes("auth") || lower.includes("login") || lower.includes("session"))) {
      category = "authentication";
    }
  }

  // Content-based signals: only for JS/TS/Python/Go/Rust source files (not docs/config/etc.)
  const isSourceFile = /\.(js|ts|mjs|cjs|jsx|tsx|py|go|rs|rb|java|cs|php|swift|kt)$/.test(lower);
  if (contentSnippet && isSourceFile) {
    if (!category) {
      if (/express\(\)|fastapi|flask\.Flask|gin\.New|http\.ListenAndServe|new Koa|Fastify\(/.test(contentSnippet)) {
        category = "entry-point";
        importance = "high";
      } else if (/router\.(get|post|put|delete|patch|use)\s*\(/.test(contentSnippet)) {
        category = "routes";
        importance = "high";
      } else if (/mongoose\.model|sequelize\.define|@Entity|class.*extends.*Model/.test(contentSnippet)) {
        category = "models";
        importance = "high";
      } else if (/passport\.|jwt\.sign|bcrypt\.|jsonwebtoken/.test(contentSnippet)) {
        category = "authentication";
        importance = "high";
      }
    } else if (!["documentation", "deployment", "config", "dependencies", "build"].includes(category)) {
      // Only upgrade to auth for actual source files that aren't structural/config files
      if (/passport\.|jwt\.sign|bcrypt\.|jsonwebtoken|verifyToken/.test(contentSnippet)) {
        category = "authentication";
        importance = "high";
      }
    }
  }

  // If still no category but it's a source file, mark as "backend" (generic)
  if (!category && /\.(js|ts|mjs|py|go|rs|rb|java|cs|php|swift|kt)$/.test(lower)) {
    category = "backend";
    importance = "low";
  }

  if (!category) return null;

  const responsibilityHint = RESPONSIBILITY_HINTS[category] || null;
  return { category, importance, responsibilityHint };
}

/**
 * Given a classified file list, return scoring for importance for
 * Ask Codebase context selection.
 */
export function rankFilesForQuestion(classifiedFiles, question) {
  const q = question.toLowerCase();

  // Map question keywords to preferred categories
  const topicRules = [
    { keywords: ["auth", "login", "logout", "session", "jwt", "token", "password", "oauth", "sign in", "sign up"],
      preferCategories: ["authentication", "middleware", "routes", "controllers", "config", "services"] },
    { keywords: ["database", "db", "sql", "query", "model", "schema", "migration", "orm", "prisma", "mongoose"],
      preferCategories: ["database", "schema", "models", "services", "config"] },
    { keywords: ["route", "endpoint", "api", "url", "path", "http", "rest", "graphql"],
      preferCategories: ["routes", "controllers", "entry-point", "schema"] },
    { keywords: ["test", "spec", "unit", "integration", "coverage", "e2e"],
      preferCategories: ["tests"] },
    { keywords: ["deploy", "docker", "container", "ci", "pipeline", "build", "kubernetes"],
      preferCategories: ["deployment", "build", "config"] },
    { keywords: ["config", "configuration", "env", "environment", "settings", "secret"],
      preferCategories: ["config", "dependencies"] },
    { keywords: ["entry", "start", "bootstrap", "main", "server", "init"],
      preferCategories: ["entry-point", "config"] },
    { keywords: ["middleware"],
      preferCategories: ["middleware", "entry-point"] },
    { keywords: ["frontend", "ui", "component", "view", "page", "react", "vue", "css"],
      preferCategories: ["frontend", "component", "routes"] },
    { keywords: ["service", "business", "logic"],
      preferCategories: ["services", "controllers"] },
    { keywords: ["worker", "job", "queue", "background", "task", "async"],
      preferCategories: ["worker", "services"] },
  ];

  let preferCategories = [];
  for (const rule of topicRules) {
    if (rule.keywords.some((kw) => q.includes(kw))) {
      preferCategories = preferCategories.concat(rule.preferCategories);
    }
  }

  // Score each file
  const scored = classifiedFiles.map((f) => {
    let score = 0;
    if (f.importance === "high") score += 3;
    else if (f.importance === "medium") score += 1;

    const catIndex = preferCategories.indexOf(f.category);
    if (catIndex !== -1) {
      score += (preferCategories.length - catIndex) * 2;
    }

    // Keyword match against path itself
    const pathLower = f.path.toLowerCase();
    for (const kw of q.split(/\s+/)) {
      if (kw.length > 3 && pathLower.includes(kw)) score += 2;
    }

    return { ...f, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}
