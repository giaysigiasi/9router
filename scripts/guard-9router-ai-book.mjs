import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoPath = path.resolve(process.argv[2] || "D:\\Github\\9router");
const bookPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repoPath, "docs", "AI_BOOK.md");

const requiredSections = [
  "## UI Roadmap",
  "## Implementation Plan",
  "## Guard Rules",
  "## Implementation Log",
  "## Scripts",
  "## Commands",
  "## Checks",
];

function fail(message) {
  console.error(`AI book guard failed: ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function changedFiles() {
  const output = git(["status", "--porcelain", "--untracked-files=all"]);
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replaceAll("\\", "/"));
}

function dashboardRoute(file) {
  const match = file.match(/^src\/app\/\(dashboard\)\/dashboard\/(.+)\/page\.js$/);
  return match ? `/dashboard/${match[1]}`.replace(/\/index$/, "") : null;
}

if (!existsSync(bookPath)) fail(`missing book: ${bookPath}`);

const book = readFileSync(bookPath, "utf8");
const missingSections = requiredSections.filter((section) => !book.includes(section));
if (missingSections.length) fail(`missing required section(s): ${missingSections.join(", ")}`);

let files;
try {
  files = changedFiles();
} catch {
  fail(`cannot inspect git repository: ${repoPath}`);
}

const governedFiles = files.filter((file) =>
  /^(src|open-sse|scripts)\//.test(file)
);

if (!governedFiles.length) {
  console.log("AI book guard passed: no governed 9router changes.");
  process.exit(0);
}

const bookModifiedAt = statSync(bookPath).mtimeMs;
const newerChanges = governedFiles.filter((file) => {
  const filePath = path.join(repoPath, file);
  return existsSync(filePath) && statSync(filePath).mtimeMs > bookModifiedAt;
});

if (newerChanges.length) {
  fail(
    `book is older than changed file(s): ${newerChanges.join(", ")}. Update ${bookPath}.`
  );
}

const changedScripts = governedFiles.filter((file) => file.startsWith("scripts/"));
const unnamedScripts = changedScripts.filter((file) => !book.includes(file));
if (unnamedScripts.length) {
  fail(`changed script(s) missing from ## Scripts: ${unnamedScripts.join(", ")}`);
}

const routes = governedFiles.map(dashboardRoute).filter(Boolean);
const undocumentedRoutes = routes.filter((route) => !book.includes(route));
if (undocumentedRoutes.length) {
  fail(
    `changed dashboard route(s) missing from ## UI Roadmap or ## Implementation Log: ${undocumentedRoutes.join(", ")}`
  );
}

console.log(
  `AI book guard passed: ${governedFiles.length} governed 9router change(s) documented.`
);