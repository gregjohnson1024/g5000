#!/usr/bin/env node
/**
 * lint-overhaul.mjs — Phase-0 enforcement scaffold
 *
 * Scans packages/web/src for new-code violations of the g5000 ui-overhaul
 * coding standards. ALWAYS exits 0 (non-blocking) — Phase 7 will tighten
 * to exit 1. Run via: npm run lint:overhaul
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCAN_ROOT = join(__dirname, '..', 'packages', 'web', 'src');

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
// Report
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
const hasAny = Object.values(violations).some((v) => v.length > 0);

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  g5000 overhaul lint — Phase 0 (non-blocking, exit 0)       ║');
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
  console.log('  All checks clean. Ready for Phase 7 tightening to --exit-code 1.');
} else {
  console.log(
    `  Total: ${totalViolations} violation${totalViolations === 1 ? '' : 's'} across ${files.length} files scanned.`,
  );
  console.log('  Non-blocking (Phase 0). Phase 7 will set exit 1 to enforce these.');
}
console.log('');

// Always exit 0 in Phase 0.
process.exit(0);
