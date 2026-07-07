#!/usr/bin/env node
/**
 * lint-overhaul.mjs — overhaul enforcement scaffold
 *
 * DEFAULT (no flags): scans packages/web/src for ALL violations of the g5000
 * ui-overhaul coding standards. Always exits 0 (non-blocking). Run via:
 *   npm run lint:overhaul
 *
 * STRICT (--strict flag): scans ONLY files that are NEW on this branch (added
 * or renamed since the develop merge-base) plus the known-clean primitive dirs
 * (components/ui, components/charts). Exits 1 if any hex/tiny-text violations
 * are found in those files, skipping comment lines for precision. Run via:
 *   npm run lint:overhaul:strict
 *
 * Phase 7 addition: --strict mode is the enforcement gate for new code.
 * The full-tree scan remains non-blocking (exit 0) to preserve legacy
 * allowances for ~216 pre-existing violations in un-migrated files.
 *
 * Detected violations:
 *   1. Raw hex colours in .tsx files  (#rrggbb, #rgb, #rrggbbaa, #rgba)
 *   2. Tiny text Tailwind utilities   text-[9px], text-[10px], text-[11px]
 *   3. Browser dialogs                window.confirm/alert/prompt + bare forms
 *   4. new EventSource( outside the shared SSE store (see EVENTSOURCE_ALLOWLIST)
 *   5. Internal <a href="/…">         (excluding /api/ and download attributes)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCAN_ROOT = join(__dirname, '..', 'packages', 'web', 'src');
const REPO_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

const STRICT = process.argv.includes('--strict');

// ---------------------------------------------------------------------------
// EventSource allowlist — files permitted to create EventSource directly.
// The shared SSE hook (use-sse.ts) is the canonical wrapper; all other
// callers should go through it or a similar context provider. Files NOT in
// this list that contain `new EventSource(` are violations.
// ---------------------------------------------------------------------------
const EVENTSOURCE_ALLOWLIST = new Set([
  'hooks/use-sse.ts',
  // SseStoreProvider owns the ONE shared EventSource('/api/stream') for the app;
  // it is the canonical wrapper the rest of the app should route through.
  'components/SseStoreProvider.tsx',
  // use-mast-control.ts connects to a different SSE endpoint (/api/mast/stream)
  // that is not part of the shared /api/stream; it may stay direct.
  'hooks/use-mast-control.ts',
]);

// ---------------------------------------------------------------------------
// Known-clean primitive dirs — strict mode always gates these even if git
// cannot determine new-file scope. Both dirs were certified clean of hex and
// tiny-text in Phase 7 (P7-1). Any regression here exits 1 in strict mode.
// ---------------------------------------------------------------------------
const STRICT_CLEAN_DIRS = [
  join(SCAN_ROOT, 'components', 'ui'),
  join(SCAN_ROOT, 'components', 'charts'),
];

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Hex colour: #RGB, #RRGGBB, #RGBA, #RRGGBBAA (3, 4, 6, or 8 hex digits).
// Anchored on both ends so we don't match things like #0f172a inside a longer
// identifier.  We don't filter comments here — keep it simple; the count will
// include commented-out code, which is fine for a baseline reporter.
const RE_HEX = /#[0-9a-fA-F]{3,8}\b/g;

// Tailwind arbitrary tiny-text utilities that violate the overhaul's minimum
// font-size contract.
const RE_TINY_TEXT = /text-\[(9|10|11)px\]/g;

// Browser dialog APIs. Matches:
//   window.confirm(   window.alert(   window.prompt(
//   confirm(          alert(          prompt(
// The bare forms are flagged even though they're technically valid JS globals;
// in a Next.js RSC/client context they're always window.* and should be
// replaced with proper modal UI.
const RE_DIALOG = /(?:window\.)?(confirm|alert|prompt)\s*\(/g;

// new EventSource(  — the shared store wraps this; direct use is a violation
// unless the file is on the allowlist.
const RE_EVENTSOURCE = /new\s+EventSource\s*\(/g;

// Internal navigation <a href="/<path>"> — should be <Link href="…"> instead.
// Allowlist:
//   /api/  — API links (download links, raw file links) stay as <a>
//   download — <a href="…" download> attributes stay as <a>
const RE_INTERNAL_A = /<a\s[^>]*href="\/(?!api\/)[^"]*"[^>]*>/g;

// But filter out lines that also contain 'download' attribute
function isDownloadAnchor(line) {
  return /\bdownload\b/.test(line);
}

// ---------------------------------------------------------------------------
// Comment-line detector (used by strict mode for precision)
// ---------------------------------------------------------------------------

/**
 * Returns true if the line is a comment and should be skipped in strict mode.
 * Covers: `// …`, `/* …`, ` * …` (block comment continuation lines).
 * We only use this in strict mode — the full-tree scan keeps the "include
 * commented-out code" behaviour for a simple, conservative baseline count.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
}

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

/** @returns {string[]} absolute paths of all .tsx and .ts files under dir */
function walk(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full));
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (ext === '.tsx' || ext === '.ts') results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Git helpers (used in strict mode to identify new files)
// ---------------------------------------------------------------------------

/**
 * Returns the set of absolute paths (within packages/web/src) for files that
 * are NEW on this branch (added or renamed since the develop merge-base).
 * Falls back to an empty Set if git is unavailable or fails.
 *
 * @returns {Set<string>}
 */
function getNewFilesFromGit() {
  try {
    const mergeBase = execSync('git merge-base HEAD develop', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const diffOutput = execSync(`git diff --name-only --diff-filter=AR ${mergeBase} HEAD`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const absSet = new Set();
    for (const line of diffOutput.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const absPath = join(REPO_ROOT, trimmed);
      // Only care about web/src .ts/.tsx files
      if (absPath.startsWith(SCAN_ROOT) && (trimmed.endsWith('.ts') || trimmed.endsWith('.tsx'))) {
        absSet.add(absPath);
      }
    }
    return absSet;
  } catch {
    // git unavailable or branch has no develop to diff against — fall through
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Violation collector
// ---------------------------------------------------------------------------

/**
 * @typedef {{ file: string; line: number; col: number; text: string }} Hit
 */

/** @type {Record<string, Hit[]>} */
const violations = {
  hex: [],
  tinyText: [],
  dialog: [],
  eventSource: [],
  internalAnchor: [],
};

const files = walk(SCAN_ROOT);

for (const absPath of files) {
  const relPath = relative(SCAN_ROOT, absPath).replace(/\\/g, '/');
  const isTsx = absPath.endsWith('.tsx');
  let source;
  try {
    source = readFileSync(absPath, 'utf8');
  } catch {
    continue;
  }

  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 1. Hex colours — TSX only (avoid flagging non-visual utility code)
    if (isTsx) {
      let m;
      RE_HEX.lastIndex = 0;
      while ((m = RE_HEX.exec(line)) !== null) {
        violations.hex.push({ file: relPath, line: lineNum, col: m.index + 1, text: m[0] });
      }
    }

    // 2. Tiny text — both .ts and .tsx (Tailwind can appear in either)
    {
      let m;
      RE_TINY_TEXT.lastIndex = 0;
      while ((m = RE_TINY_TEXT.exec(line)) !== null) {
        violations.tinyText.push({ file: relPath, line: lineNum, col: m.index + 1, text: m[0] });
      }
    }

    // 3. Browser dialogs — both .ts and .tsx
    {
      let m;
      RE_DIALOG.lastIndex = 0;
      while ((m = RE_DIALOG.exec(line)) !== null) {
        violations.dialog.push({
          file: relPath,
          line: lineNum,
          col: m.index + 1,
          text: m[0].trimEnd(),
        });
      }
    }

    // 4. EventSource — both .ts and .tsx, filtered by allowlist
    {
      let m;
      RE_EVENTSOURCE.lastIndex = 0;
      while ((m = RE_EVENTSOURCE.exec(line)) !== null) {
        if (!EVENTSOURCE_ALLOWLIST.has(relPath)) {
          violations.eventSource.push({
            file: relPath,
            line: lineNum,
            col: m.index + 1,
            text: m[0].trimEnd(),
          });
        }
      }
    }

    // 5. Internal <a href> — TSX only; skip download anchors
    if (isTsx) {
      let m;
      RE_INTERNAL_A.lastIndex = 0;
      while ((m = RE_INTERNAL_A.exec(line)) !== null) {
        if (!isDownloadAnchor(line)) {
          violations.internalAnchor.push({
            file: relPath,
            line: lineNum,
            col: m.index + 1,
            text: m[0].slice(0, 60),
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report (full-tree, always exit 0)
// ---------------------------------------------------------------------------

const RULE_LABELS = {
  hex: 'Raw hex colours in .tsx',
  tinyText: 'Tiny text utilities (text-[9|10|11]px)',
  dialog: 'Browser dialogs (confirm/alert/prompt)',
  eventSource: 'new EventSource( outside shared SSE store',
  internalAnchor: 'Internal <a href="/…"> (use <Link>)',
};

const RULE_WHY = {
  hex: 'Use Tailwind/CSS design tokens instead',
  tinyText: 'Below minimum legible size; use text-xs (12px) minimum',
  dialog: 'Use proper modal UI; these block the main thread',
  eventSource: 'Route through hooks/use-sse.ts or equivalent shared provider',
  internalAnchor: 'Client-side navigation: import Link from "next/link"',
};

let totalViolations = 0;

if (!STRICT) {
  // -------------------------------------------------------------------------
  // Default mode: full-tree scan, non-blocking
  // -------------------------------------------------------------------------

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  g5000 overhaul lint — full-tree scan (non-blocking, exit 0) ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  for (const [key, hits] of Object.entries(violations)) {
    const label = RULE_LABELS[key];
    const why = RULE_WHY[key];
    const count = hits.length;
    totalViolations += count;

    if (count === 0) {
      console.log(`  ✓  ${label} — 0`);
      continue;
    }

    console.log(`  ✗  ${label}`);
    console.log(`     ${count} occurrence${count === 1 ? '' : 's'} — ${why}`);

    // Group hits by file for a concise display
    /** @type {Map<string, Hit[]>} */
    const byFile = new Map();
    for (const hit of hits) {
      if (!byFile.has(hit.file)) byFile.set(hit.file, []);
      byFile.get(hit.file).push(hit);
    }
    for (const [file, fileHits] of byFile) {
      const locs = fileHits.map((h) => h.line).join(',');
      console.log(`     ${file}  (lines: ${locs})`);
    }
    console.log('');
  }

  console.log('');
  if (totalViolations === 0) {
    console.log('  All checks clean.');
  } else {
    console.log(
      `  Total: ${totalViolations} violation${totalViolations === 1 ? '' : 's'} across ${files.length} files scanned.`,
    );
    console.log('  Non-blocking (legacy allowances). Use --strict to gate new code.');
  }
  console.log('');

  process.exit(0);
}

// ---------------------------------------------------------------------------
// STRICT mode: gate new files only (exit 1 on violations)
// ---------------------------------------------------------------------------

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  g5000 overhaul lint — STRICT (new files + clean dirs)      ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

// Identify the set of files to enforce. Uses two complementary scopes:
//   A) Git-diff scope: files added/renamed on this branch vs develop merge-base
//   B) Clean-dir scope: components/ui and components/charts (Phase 7 certified)
// The union of A ∪ B is gated; A catches all new work, B protects clean primitives.

const newFileSet = getNewFilesFromGit();
const cleanDirFiles = new Set(STRICT_CLEAN_DIRS.flatMap(walk));

if (newFileSet.size === 0 && cleanDirFiles.size === 0) {
  console.log('  No files in scope (git unavailable and clean-dirs empty). Exiting 0.');
  console.log('');
  process.exit(0);
}

const strictScope = new Set([...newFileSet, ...cleanDirFiles]);

console.log(`  Scope: ${newFileSet.size} new-branch files + ${cleanDirFiles.size} clean-dir files`);
console.log(`         (${strictScope.size} unique files gated)`);
if (newFileSet.size === 0) {
  console.log('  Note: git merge-base with develop unavailable; gating clean dirs only.');
}
console.log('');

// Scan strict scope for hex + tiny-text only (comment lines skipped for precision).
// Other rules (dialog, EventSource, internalAnchor) remain full-tree / non-blocking
// in this phase — add them here when those categories are also fully migrated.

/** @type {Hit[]} */
const strictHex = [];
/** @type {Hit[]} */
const strictTinyText = [];

for (const absPath of strictScope) {
  const relPath = relative(SCAN_ROOT, absPath).replace(/\\/g, '/');
  const isTsx = absPath.endsWith('.tsx');
  let source;
  try {
    source = readFileSync(absPath, 'utf8');
  } catch {
    continue;
  }

  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip comment lines — strict mode is precise; comments are documentation.
    if (isCommentLine(line)) continue;

    // 1. Hex colours — TSX only
    if (isTsx) {
      let m;
      RE_HEX.lastIndex = 0;
      while ((m = RE_HEX.exec(line)) !== null) {
        strictHex.push({ file: relPath, line: lineNum, col: m.index + 1, text: m[0] });
      }
    }

    // 2. Tiny text — both .ts and .tsx
    {
      let m;
      RE_TINY_TEXT.lastIndex = 0;
      while ((m = RE_TINY_TEXT.exec(line)) !== null) {
        strictTinyText.push({ file: relPath, line: lineNum, col: m.index + 1, text: m[0] });
      }
    }
  }
}

// Report strict findings
const strictTotal = strictHex.length + strictTinyText.length;

for (const [label, hits, why] of [
  [RULE_LABELS.hex, strictHex, RULE_WHY.hex],
  [RULE_LABELS.tinyText, strictTinyText, RULE_WHY.tinyText],
]) {
  if (hits.length === 0) {
    console.log(`  ✓  ${label} — 0 in new/clean files`);
    continue;
  }
  console.log(`  ✗  ${label}`);
  console.log(
    `     ${hits.length} occurrence${hits.length === 1 ? '' : 's'} in new/clean files — ${why}`,
  );
  const byFile = new Map();
  for (const hit of hits) {
    if (!byFile.has(hit.file)) byFile.set(hit.file, []);
    byFile.get(hit.file).push(hit);
  }
  for (const [file, fileHits] of byFile) {
    for (const h of fileHits) {
      console.log(`     ${file}:${h.line}:${h.col}  ${h.text}`);
    }
  }
  console.log('');
}

console.log('');
if (strictTotal === 0) {
  console.log('  ✓  Strict gate passed — no raw-hex or tiny-text in new/clean files.');
  console.log('');
  process.exit(0);
} else {
  console.log(
    `  ✗  Strict gate FAILED — ${strictTotal} violation${strictTotal === 1 ? '' : 's'} in new/clean scope.`,
  );
  console.log('     Replace raw hex with design tokens; use text-xs (12px) minimum.');
  console.log('');
  process.exit(1);
}
