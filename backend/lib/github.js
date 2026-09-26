/**
 * GitHub ingestion service.
 *
 * Fetches repository metadata, file tree, and a curated set of key file
 * contents from a public GitHub repository using the GitHub REST API.
 *
 * Optional: set GITHUB_TOKEN in .env to raise the rate limit from 60 → 5,000
 * requests/hour and to support private repositories.
 *
 * Returns a richer repoData object used by analyze.js:
 * {
 *   owner, repo, branch, description, stars, language,
 *   tree,          // flat [{path, type, size}]
 *   files,         // [{path, content, category, importance}]
 *   classifiedTree,// [{path, category, importance}] for every non-skipped blob
 *   dirStructure,  // top-level directories and notable subdirs
 *   metadata,      // raw GitHub repo metadata subset
 *   fileStats,     // counts by category, extension breakdown
 * }
 */

import fetch from "node-fetch";
import { classifyFile } from "./classifier.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

export class GitHubRateLimitError extends Error {
  constructor(response) {
    const reset = response.headers.get("x-ratelimit-reset");
    const retryAfter = response.headers.get("retry-after");
    const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : null;
    super(`GitHub API rate limit reached${retryAfter ? `; retry after ${retryAfter} seconds` : resetAt ? `; reset at ${resetAt}` : ""}.`);
    this.name = "GitHubRateLimitError";
    this.status = response.status;
    this.rateLimit = {
      limit: response.headers.get("x-ratelimit-limit"),
      remaining: response.headers.get("x-ratelimit-remaining"),
      reset,
      resetAt,
      retryAfter,
    };
  }
}

async function throwIfRateLimited(res) {
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const body = await res.clone().text();
    if (res.status === 429 || remaining === "0" || res.headers.has("retry-after") || /rate limit exceeded|secondary rate limit/i.test(body)) {
      throw new GitHubRateLimitError(res);
    }
  }
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES   = 80_000;  // skip files larger than this
const MAX_FILES_TO_READ = 40;     // max files to fetch full content for

// ---------------------------------------------------------------------------
// Directories that are almost never useful for understanding architecture
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "__pycache__", ".pytest_cache", "vendor", "target", ".idea",
  ".vscode", "coverage", ".turbo", "out", ".output", ".cache",
  "public", "static", "assets", ".nyc_output",
]);

// ---------------------------------------------------------------------------
// Key file patterns — always try to read these (high signal)
// ---------------------------------------------------------------------------

const KEY_FILE_PATTERNS = [
  /^readme(\.(md|txt|rst))?$/i,
  /^package\.json$/,
  /^pyproject\.toml$/,
  /^requirements([-_]dev)?\.txt$/i,
  /^cargo\.toml$/i,
  /^go\.mod$/,
  /^pom\.xml$/,
  /^build\.gradle(\.kts)?$/i,
  /^dockerfile(\.[\w]+)?$/i,
  /^docker-compose(\.[a-z]+)?\.ya?ml$/i,
  /^compose\.ya?ml$/i,
  /^\.env\.example$/i,
  /^\.env\.sample$/i,
  /^\.env\.template$/i,
  /^makefile$/i,
  /^gemfile$/i,
  /^setup\.py$/i,
  /^setup\.cfg$/i,
  /^tsconfig\.json$/,
  /^jest\.config\.(js|ts|json)$/,
  /^vite\.config\.(js|ts)$/,
  /^webpack\.config\.(js|ts)$/,
  /^next\.config\.(js|ts)$/,
  /^nuxt\.config\.(js|ts)$/,
  /^svelte\.config\.(js|ts)$/,
  /^tailwind\.config\.(js|ts)$/,
  /^prisma\/schema\.prisma$/,
  /^schema\.prisma$/,
  /^drizzle\.config\.(js|ts)$/,
  /^knexfile\.(js|ts)$/,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders() {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function ghHeaders() {
  return { Accept: "application/vnd.github+json", ...authHeaders() };
}

/**
 * Parse a GitHub repo URL into { owner, repo }.
 */
export function parseRepoUrl(url) {
  const cleaned = url.trim().replace(/\.git$/, "");
  const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/#?]+)/);
  if (!match) {
    throw new Error(
      `Invalid GitHub URL: "${url}". Expected format: https://github.com/owner/repo`
    );
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Fetch repository metadata (default branch, description, stars, language, topics).
 */
async function getRepoMetadata(owner, repo) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: ghHeaders(),
  });
  await throwIfRateLimited(res);
  if (res.status === 404) {
    throw new Error(
      `GitHub API error 404: Repository "${owner}/${repo}" not found or is private.`
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status} fetching repo metadata: ${body}`);
  }
  const data = await res.json();
  return {
    defaultBranch: data.default_branch || "main",
    description:   data.description || "",
    stars:         data.stargazers_count || 0,
    forks:         data.forks_count || 0,
    language:      data.language || "",
    topics:        data.topics || [],
    size:          data.size || 0,
    isPrivate:     data.private || false,
    createdAt:     data.created_at || "",
    updatedAt:     data.updated_at || "",
    license:       data.license?.spdx_id || data.license?.name || "",
    homepage:      data.homepage || "",
    openIssues:    data.open_issues_count || 0,
    watchers:      data.watchers_count || 0,
    hasWiki:       data.has_wiki || false,
    networkCount:  data.network_count || 0,
  };
}

/**
 * Fetch the full recursive file tree.
 * Returns flat list of { path, type, size } objects.
 */
async function getFileTree(owner, repo, branch) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, { headers: ghHeaders() });
  await throwIfRateLimited(res);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status} fetching file tree: ${body}`);
  }

  const data = await res.json();
  if (data.truncated) {
    console.warn(`[github] File tree for ${owner}/${repo} was truncated by GitHub (repo is very large).`);
  }

  return (data.tree || []).filter((item) => {
    const parts = item.path.split("/");
    return !parts.some((p) => SKIP_DIRS.has(p));
  });
}

/**
 * Fetch raw content of a single file (base64 decoded), with size guard.
 * Returns null on error or if file is too large.
 */
async function getFileContent(owner, repo, branch, path, maxBytes = MAX_FILE_BYTES) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `${GITHUB_RAW}/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  const length = Number(res.headers.get("content-length"));
  if (length && length > maxBytes) return null;
  const content = await res.text();
  return Buffer.byteLength(content, "utf8") <= maxBytes ? content : null;
}

/**
 * Build a directory structure summary from the file tree.
 * Returns top-level dirs, notable subdirs, and full directory list.
 */
function buildDirStructure(tree) {
  const topDirs = new Set();
  const allDirs = new Set();
  const allDirPaths = new Set();

  for (const item of tree) {
    const parts = item.path.split("/");
    if (parts.length >= 1) topDirs.add(parts[0]);
    if (parts.length >= 2) allDirs.add(parts[0] + "/" + parts[1]);
    // Collect all unique directory paths
    for (let i = 1; i < parts.length; i++) {
      allDirPaths.add(parts.slice(0, i).join("/"));
    }
  }

  return {
    topLevel: [...topDirs].filter((d) => !SKIP_DIRS.has(d)),
    notable:  [...allDirs]
      .filter((d) => {
        const seg = d.split("/").pop();
        return !SKIP_DIRS.has(seg) && INTERESTING_DIRS.has(seg);
      })
      .slice(0, 30),
    allDirs: [...allDirPaths].filter(d => {
      const seg = d.split("/").pop();
      return !SKIP_DIRS.has(seg);
    }).slice(0, 50),
  };
}

const INTERESTING_DIRS = new Set([
  "src", "lib", "app", "api", "routes", "route", "controllers", "controller",
  "services", "service", "models", "model", "middleware", "middlewares",
  "db", "database", "migrations", "seeds", "repositories", "schemas", "schema",
  "tests", "test", "spec", "specs", "__tests__", "e2e",
  "config", "configs", "configuration",
  "docs", "documentation",
  "components", "views", "pages", "ui", "frontend",
  "utils", "helpers", "hooks", "context",
  "bin", "cmd", "scripts",
  "auth", "authentication",
  "workers", "jobs", "queues",
  "types", "interfaces",
  "core", "shared", "common",
  "handlers", "resolvers",
  "prisma", "drizzle",
]);

/**
 * Select which files to read, in priority order:
 * 1. Key files (README, manifests, configs) — always read
 * 2. Files classified as high-importance entry points, routes, controllers, etc.
 * 3. Top-level source files not already selected
 * 4. Interesting nested source files
 *
 * Cap at MAX_FILES_TO_READ total.
 */
function selectFilesToRead(tree) {
  const blobs = tree.filter(
    (f) => f.type === "blob" && typeof f.size === "number" && f.size < MAX_FILE_BYTES
  );

  // Priority 1: key files by name pattern
  // For deeply nested files (>2 path segments), only match patterns that use full path
  // This prevents tsconfig.json in every package from flooding the read list
  const ROOT_ONLY_PATTERNS = new Set([
    /^tsconfig\.json$/,
    /^jest\.config\.(js|ts|json)$/,
    /^vite\.config\.(js|ts)$/,
    /^webpack\.config\.(js|ts)$/,
    /^next\.config\.(js|ts)$/,
    /^nuxt\.config\.(js|ts)$/,
  ].map(p => p.source));

  // Track how many tsconfig-style files we add (cap to 3 total)
  let configFilesAdded = 0;
  const CONFIG_FILE_CAP = 3;

  const keyFiles = blobs.filter((f) => {
    const name = f.path.split("/").pop();
    const depth = f.path.split("/").length;
    // For nested config files, apply stricter limits
    if (depth > 2) {
      const isRootOnlyPattern = ROOT_ONLY_PATTERNS.has(
        [...KEY_FILE_PATTERNS].find(p => p.test(name))?.source
      );
      if (isRootOnlyPattern) {
        if (configFilesAdded >= CONFIG_FILE_CAP) return false;
        configFilesAdded++;
      }
    }
    return KEY_FILE_PATTERNS.some((pat) => pat.test(f.path) || pat.test(name));
  });

  const keyPaths = new Set(keyFiles.map((f) => f.path));

  // Priority 2: classify remaining blobs and pick high-importance ones
  const classified = blobs
    .filter((f) => !keyPaths.has(f.path))
    .map((f) => {
      const result = classifyFile(f.path);
      return result ? { ...f, ...result } : null;
    })
    .filter(Boolean);

  const highImportance = classified
    .filter((f) => f.importance === "high" && f.category !== "documentation")
    .sort((a, b) => {
      // Prefer entry points, auth, routes first
      const order = [
        "entry-point", "authentication", "routes", "controllers", "services",
        "models", "schema", "middleware", "database", "config", "utility", "worker",
      ];
      const ai = order.indexOf(a.category);
      const bi = order.indexOf(b.category);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  // Priority 3: medium-importance classified files
  const mediumImportance = classified
    .filter((f) => f.importance === "medium" && f.category !== "documentation")
    .sort((a, b) => {
      const order = ["routes", "services", "models", "schema", "middleware", "tests", "frontend", "component"];
      const ai = order.indexOf(a.category);
      const bi = order.indexOf(b.category);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  // Priority 4: top-level source files as fallback
  const topLevel = blobs.filter(
    (f) => !keyPaths.has(f.path) && !f.path.includes("/")
  );

  // Combine without duplicates, cap to limit
  const seen = new Set(keyPaths);
  const result = [...keyFiles];

  for (const f of [...highImportance, ...mediumImportance, ...topLevel]) {
    if (result.length >= MAX_FILES_TO_READ) break;
    if (!seen.has(f.path)) {
      seen.add(f.path);
      result.push(f);
    }
  }

  return result;
}

/**
 * Classify all blobs in the tree (without reading content) for the
 * structured overview returned to analyze.js.
 */
function classifyTree(tree) {
  return tree
    .filter((f) => f.type === "blob")
    .map((f) => {
      const result = classifyFile(f.path);
      if (!result) return null;
      return { path: f.path, size: f.size || 0, ...result };
    })
    .filter(Boolean);
}

/**
 * Build file statistics from the tree.
 */
function buildFileStats(tree, classifiedTree) {
  const blobs = tree.filter(f => f.type === "blob");
  
  // Extension breakdown
  const extCounts = {};
  for (const f of blobs) {
    const ext = f.path.split(".").pop()?.toLowerCase() || "none";
    extCounts[ext] = (extCounts[ext] || 0) + 1;
  }
  
  // Top extensions (sorted by count)
  const topExtensions = Object.entries(extCounts)
    .filter(([ext]) => !["lock", "map", "png", "jpg", "gif", "svg", "ico", "woff", "woff2", "ttf"].includes(ext))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ext, count]) => ({ ext, count }));

  // Category breakdown
  const catCounts = {};
  for (const f of classifiedTree) {
    catCounts[f.category] = (catCounts[f.category] || 0) + 1;
  }

  return {
    totalFiles: blobs.length,
    sourceFiles: classifiedTree.filter(f => !["documentation", "dependencies", "build", "deployment", "config"].includes(f.category)).length,
    testFiles: catCounts["tests"] || 0,
    configFiles: catCounts["config"] || 0,
    docFiles: catCounts["documentation"] || 0,
    topExtensions,
    categoryBreakdown: catCounts,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ingest a GitHub repository.
 *
 * Returns:
 * {
 *   owner, repo, branch,
 *   metadata: { description, stars, language, topics, license, … },
 *   tree,            // full filtered file tree [{path, type, size}]
 *   classifiedTree,  // [{path, category, importance, responsibilityHint}]
 *   dirStructure,    // { topLevel, notable, allDirs }
 *   files,           // [{path, content, category, importance}] — full content
 *   fileStats,       // { totalFiles, testFiles, configFiles, … }
 * }
 */
export async function ingestRepo(repoUrl) {
  const { owner, repo } = parseRepoUrl(repoUrl);

  const metadata = await getRepoMetadata(owner, repo);
  const { defaultBranch: branch } = metadata;

  const tree = await getFileTree(owner, repo, branch);
  const toRead = selectFilesToRead(tree);
  const dirStructure = buildDirStructure(tree);
  const classifiedTree = classifyTree(tree);
  const fileStats = buildFileStats(tree, classifiedTree);

  const files = new Array(toRead.length);
  let next = 0;
  async function readWorker() {
    while (next < toRead.length) {
      const index = next++;
      const f = toRead[index];
      const content = await getFileContent(owner, repo, branch, f.path);
      if (content !== null) {
        const classification = classifyFile(f.path, content);
        files[index] = {
          path: f.path,
          content,
          category: classification?.category || f.category || null,
          importance: classification?.importance || f.importance || "low",
          responsibilityHint: classification?.responsibilityHint || null,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, toRead.length) }, readWorker));
  const readableFiles = files.filter(Boolean);

  console.log(
    `[github] Ingested ${owner}/${repo} — ${tree.length} files in tree, ` +
    `${readableFiles.length} files read, ${classifiedTree.length} classified`
  );

  return { owner, repo, branch, metadata, tree, classifiedTree, dirStructure, files: readableFiles, fileStats };
}
