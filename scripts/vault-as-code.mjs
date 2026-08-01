/**
 * "Vault as code" (#161 U6 repro) — a SELF-CONTAINED generator that recreates a
 * vault's folders, note frontmatter, `.base` files, and relationships
 * INDISTINGUISHABLY from the original — with EMPTY note bodies.
 *
 * Three subcommands:
 *   extract  <vaultPath> <fixturePath>   — consult the original ONCE; bake its
 *                                          structure (folders + per-note frontmatter
 *                                          block + base files) into a fixture file.
 *   generate <fixturePath> <outVault>    — THE ALGORITHM: recreate the vault purely
 *                                          from the baked fixture. Never reads the
 *                                          original; delete the original and this
 *                                          still works.
 *   verify   <fixturePath> <vaultPath>   — fidelity gate: generate from the fixture
 *                                          and diff against the original — every
 *                                          path present, every frontmatter byte
 *                                          equal, bodies empty. (Reads the original
 *                                          for verification ONLY.)
 *
 * The fixture is the "code": commit it + this script and the vault regenerates with
 * no access to the private original. Only note BODIES are dropped; frontmatter,
 * folder tree, and the link graph are reproduced exactly.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules", ".smart-env"]);

// Plugin configs to replicate (relative to the vault). TaskNotes' data.json carries
// the field mappings + task-identification settings that DRIVE the relationship
// graph (e.g. projects→"in", taskPropertyName→"isActionable"); without them no
// parents resolve. `.base` files are captured by the walk; these are not.
const PLUGIN_CONFIGS = [
  ".obsidian/plugins/tasknotes/data.json",
  ".obsidian/plugins/tasknotes-gantt/data.json",
];

// Secret keys in TaskNotes' data.json — emptied (by original type) so the fixture
// is committable. Structural settings (fieldMapping, customStatuses, customPriorities,
// taskIdentificationMethod, taskPropertyName/Value, savedViews) are KEPT — they drive
// the graph + filtering, contain no secrets.
// Only SECRET-BEARING keys (tokens, URLs, calendar IDs, captured data) — emptied by
// type. Boolean feature flags (e.g. basesPOCLogs/basesAdvancedDataLogs/enableBasesPOC)
// are NOT secrets and are deliberately excluded: emptyLike can't blank a boolean, so
// listing them would only trip the verify redaction check on a harmless `false`.
const TASKNOTES_SECRET_KEYS = new Set([
  "apiAuthToken", "lemonSqueezyLicenseKey",
  "googleOAuthClientId", "googleOAuthClientSecret", "microsoftOAuthClientId", "microsoftOAuthClientSecret",
  "googleCalendarSyncTokens", "microsoftCalendarSyncTokens", "googleCalendarSyncQueue",
  "enabledGoogleCalendars", "enabledMicrosoftCalendars", "icsIntegration",
  "webhooks",
]);

/** Empty a value preserving its JSON type (string→"", array→[], object→{}, else unchanged). */
function emptyLike(v) {
  if (typeof v === "string") return "";
  if (Array.isArray(v)) return [];
  if (v && typeof v === "object") return {};
  return v;
}

/** Redact secrets from a TaskNotes data.json object in place; returns it. */
function redactTaskNotesData(obj) {
  for (const k of Object.keys(obj)) if (TASKNOTES_SECRET_KEYS.has(k)) obj[k] = emptyLike(obj[k]);
  return obj;
}

/** Read + redact the configured plugin configs from a vault. Returns [{p, c}]. */
function capturePluginConfigs(vaultPath) {
  const out = [];
  for (const rel of PLUGIN_CONFIGS) {
    const abs = path.join(vaultPath, rel.split("/").join(path.sep));
    let raw; try { raw = fs.readFileSync(abs, "utf8"); } catch { continue; }
    if (rel.includes("/tasknotes/")) {
      try { raw = JSON.stringify(redactTaskNotesData(JSON.parse(raw)), null, 2); } catch { /* keep raw if unparseable */ }
    }
    out.push({ p: rel, c: raw });
  }
  return out;
}

/** Capture the leading frontmatter BLOCK verbatim (incl. the `---` fences), BOM
 * stripped, or null if the note has none. Obsidian rule: starts at byte 0 (after an
 * optional BOM) with `---`, ends at the next line that is exactly `---` or `...`. */
function extractFrontmatterBlock(content) {
  let s = content;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (!/^---\r?\n/.test(s)) return null;
  // Capture through the closing fence (incl. trailing fence spaces) but NOT the
  // newline after it — so a note whose frontmatter sits at EOF with no trailing
  // newline compares equal to the regenerated one (generate appends the body
  // separator). Normalize CRLF→LF so capture is line-ending-agnostic.
  const m = s.replace(/\r\n/g, "\n").match(/^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*/);
  return m ? m[0] : null;
}

function toPosixPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function readDirectoryEntriesOrEmpty(vaultPath, relativeDirectory) {
  try {
    return fs.readdirSync(path.join(vaultPath, relativeDirectory), { withFileTypes: true });
  } catch {
    return [];
  }
}

function readUtf8OrEmpty(vaultPath, relativePath) {
  try {
    return fs.readFileSync(path.join(vaultPath, relativePath), "utf8");
  } catch {
    return "";
  }
}

function scanFile(vaultPath, relativePath, scanResult) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".md") {
    const content = readUtf8OrEmpty(vaultPath, relativePath);
    scanResult.notes.push({
      p: toPosixPath(relativePath),
      fm: extractFrontmatterBlock(content) ?? "",
    });
    return;
  }
  if (extension === ".base") {
    scanResult.bases.push({
      p: toPosixPath(relativePath),
      c: readUtf8OrEmpty(vaultPath, relativePath),
    });
  }
}

function scanDirectory(vaultPath, relativeDirectory, scanResult) {
  if (relativeDirectory) scanResult.folders.push(toPosixPath(relativeDirectory));
  const entries = readDirectoryEntriesOrEmpty(vaultPath, relativeDirectory);
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) scanDirectory(vaultPath, relativePath, scanResult);
      continue;
    }
    scanFile(vaultPath, relativePath, scanResult);
  }
}

/** Walk a vault collecting every directory, every `.md` (path + frontmatter block),
 * and every `.base` (path + verbatim content). */
function scanVault(vaultPath) {
  const scanResult = {
    folders: [],
    notes: [],
    bases: [],
  };
  scanDirectory(vaultPath, "", scanResult);
  return scanResult;
}

function cmdExtract(vaultPath, fixturePath) {
  const data = scanVault(vaultPath);
  const pluginConfigs = capturePluginConfigs(vaultPath);
  const fixture = {
    schema: "vault-as-code/2",
    sourceBasename: path.basename(path.resolve(vaultPath)),
    folders: data.folders,
    notes: data.notes,
    bases: data.bases,
    pluginConfigs,            // [{p, c}] — TaskNotes data.json redacted of secrets
    stats: {
      folders: data.folders.length,
      notes: data.notes.length,
      notesWithFm: data.notes.filter((n) => n.fm).length,
      bases: data.bases.length,
      pluginConfigs: pluginConfigs.length,
    },
  };
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), "utf8");
  const kb = (fs.statSync(fixturePath).size / 1024).toFixed(0);
  console.log(`[extract] ${vaultPath} → ${fixturePath} (${kb} KB)`);
  console.log(`[extract] folders=${fixture.stats.folders} notes=${fixture.stats.notes} (withFm=${fixture.stats.notesWithFm}) bases=${fixture.stats.bases} pluginConfigs=${fixture.stats.pluginConfigs} [${pluginConfigs.map((x) => x.p).join(", ")}]`);
}

/** THE ALGORITHM — recreate the vault from the fixture alone (no original access). */
function generateFromFixture(fixture, outVault) {
  fs.rmSync(outVault, { recursive: true, force: true });
  fs.mkdirSync(outVault, { recursive: true });
  for (const rel of fixture.folders) fs.mkdirSync(path.join(outVault, rel), { recursive: true });
  for (const n of fixture.notes) {
    const out = path.join(outVault, n.p);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // Frontmatter verbatim + EMPTY body. A note without frontmatter → empty file.
    fs.writeFileSync(out, n.fm ? (n.fm.endsWith("\n") ? n.fm : n.fm + "\n") : "", "utf8");
  }
  for (const b of fixture.bases) {
    const out = path.join(outVault, b.p);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, b.c, "utf8");
  }
  for (const pc of fixture.pluginConfigs ?? []) {
    const out = path.join(outVault, pc.p.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, pc.c, "utf8");
  }
}

function cmdGenerate(fixturePath, outVault) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  generateFromFixture(fixture, outVault);
  console.log(`[generate] ${fixturePath} → ${outVault}: ${fixture.notes.length} notes, ${fixture.folders.length} folders, ${fixture.bases.length} bases (bodies empty)`);
}

function toValueSet(items, key) {
  return new Set(items.map((item) => (typeof item === "string" ? item : item[key])));
}

function diffSets(original, generated) {
  const miss = [...original].filter((value) => !generated.has(value));
  const extra = [...generated].filter((value) => !original.has(value));
  return { miss, extra };
}

function compareVaultPaths(original, generated) {
  return {
    folders: {
      originalCount: original.folders.length,
      generatedCount: generated.folders.length,
      ...diffSets(toValueSet(original.folders), toValueSet(generated.folders)),
    },
    notes: {
      originalCount: original.notes.length,
      generatedCount: generated.notes.length,
      ...diffSets(toValueSet(original.notes, "p"), toValueSet(generated.notes, "p")),
    },
    bases: {
      originalCount: original.bases.length,
      generatedCount: generated.bases.length,
      ...diffSets(toValueSet(original.bases, "p"), toValueSet(generated.bases, "p")),
    },
  };
}

function normalizeLineEndings(value) {
  return (value ?? "").replace(/\r\n/g, "\n");
}

function compareFrontmatter(originalNotes, generatedNotes) {
  const generatedFrontmatter = new Map(generatedNotes.map((note) => [note.p, note.fm]));
  let mismatchCount = 0;
  const samples = [];
  for (const note of originalNotes) {
    const generated = generatedFrontmatter.get(note.p);
    if (generated === undefined) continue;
    if (normalizeLineEndings(note.fm) === normalizeLineEndings(generated)) continue;
    mismatchCount += 1;
    if (samples.length < 5) samples.push(note.p);
  }
  return { mismatchCount, samples };
}

function readGeneratedPluginConfig(generatedVaultPath, relativePath) {
  try {
    return fs.readFileSync(
      path.join(generatedVaultPath, relativePath.split("/").join(path.sep)),
      "utf8",
    );
  } catch {
    return undefined;
  }
}

function pluginConfigMatches(generatedContent, fixtureContent) {
  return (
    generatedContent !== undefined
    && normalizeLineEndings(generatedContent) === normalizeLineEndings(fixtureContent)
  );
}

function isEmptySecretValue(value) {
  if (value === "" || value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function findTaskNotesSecretLeaks(content) {
  const leaks = [];
  try {
    const data = JSON.parse(content);
    for (const key of TASKNOTES_SECRET_KEYS) {
      if (!isEmptySecretValue(data[key])) leaks.push(`SECRET:${key}`);
    }
  } catch {
    return leaks;
  }
  return leaks;
}

// scanVault omits `.obsidian`, so plugin configs need their own round-trip check;
// TaskNotes field mappings drive the relationship graph reproduced by the fixture.
function comparePluginConfigs(pluginConfigs, generatedVaultPath) {
  let mismatchCount = 0;
  let secretLeakCount = 0;
  const samples = [];
  for (const pluginConfig of pluginConfigs) {
    const generatedContent = readGeneratedPluginConfig(
      generatedVaultPath,
      pluginConfig.p,
    );
    if (!pluginConfigMatches(generatedContent, pluginConfig.c)) {
      mismatchCount += 1;
      if (samples.length < 5) samples.push(pluginConfig.p);
    }
    if (!pluginConfig.p.includes("/tasknotes/")) continue;
    const leaks = findTaskNotesSecretLeaks(pluginConfig.c);
    secretLeakCount += leaks.length;
    samples.push(...leaks);
  }
  return {
    capturedCount: pluginConfigs.length,
    mismatchCount,
    secretLeakCount,
    samples,
  };
}

function pathComparisonPassed(comparison) {
  return comparison.miss.length === 0 && comparison.extra.length === 0;
}

function verificationPassed(pathComparisons, frontmatterComparison, pluginConfigComparison) {
  return (
    pathComparisonPassed(pathComparisons.folders)
    && pathComparisonPassed(pathComparisons.notes)
    && pathComparisonPassed(pathComparisons.bases)
    && frontmatterComparison.mismatchCount === 0
    && pluginConfigComparison.mismatchCount === 0
    && pluginConfigComparison.secretLeakCount === 0
  );
}

function reportVerification(
  pathComparisons,
  frontmatterComparison,
  pluginConfigComparison,
  passed,
) {
  const { folders, notes, bases } = pathComparisons;
  console.log(`[verify] folders: orig=${folders.originalCount} gen=${folders.generatedCount} miss=${folders.miss.length} extra=${folders.extra.length}`);
  console.log(`[verify] notes:   orig=${notes.originalCount} gen=${notes.generatedCount} miss=${notes.miss.length} extra=${notes.extra.length}`);
  console.log(`[verify] bases:   orig=${bases.originalCount} gen=${bases.generatedCount} miss=${bases.miss.length} extra=${bases.extra.length}`);
  console.log(`[verify] frontmatter mismatches: ${frontmatterComparison.mismatchCount}${frontmatterComparison.samples.length ? " e.g. " + frontmatterComparison.samples.join(", ") : ""}`);
  console.log(`[verify] pluginConfigs: ${pluginConfigComparison.capturedCount} captured, mismatches=${pluginConfigComparison.mismatchCount}, secretLeaks=${pluginConfigComparison.secretLeakCount}${pluginConfigComparison.samples.length ? " e.g. " + pluginConfigComparison.samples.join(", ") : ""}`);
  if (notes.miss.length) console.log(`[verify] sample missing notes: ${notes.miss.slice(0, 5).join(", ")}`);
  console.log(`[verify] ${passed ? "PASS — generated vault is indistinguishable from original (except bodies)" : "FAIL — see diffs above"}`);
}

/** Fidelity gate: generate from the fixture, then diff against the original. */
function cmdVerify(fixturePath, vaultPath) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const tmp = path.join(os.tmpdir(), `vac-verify-${process.pid}`);
  generateFromFixture(fixture, tmp);

  const original = scanVault(vaultPath);
  const generated = scanVault(tmp);
  const pathComparisons = compareVaultPaths(original, generated);
  // Raw frontmatter equality also covers the relationship graph that drives the repro.
  const frontmatterComparison = compareFrontmatter(original.notes, generated.notes);
  const pluginConfigComparison = comparePluginConfigs(fixture.pluginConfigs ?? [], tmp);
  const passed = verificationPassed(
    pathComparisons,
    frontmatterComparison,
    pluginConfigComparison,
  );

  reportVerification(
    pathComparisons,
    frontmatterComparison,
    pluginConfigComparison,
    passed,
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!passed) process.exit(2);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "extract" && a && b) cmdExtract(a, b);
else if (cmd === "generate" && a && b) cmdGenerate(a, b);
else if (cmd === "verify" && a && b) cmdVerify(a, b);
else {
  console.error("usage:\n  node scripts/vault-as-code.mjs extract  <vaultPath> <fixturePath>\n  node scripts/vault-as-code.mjs generate <fixturePath> <outVault>\n  node scripts/vault-as-code.mjs verify   <fixturePath> <vaultPath>");
  process.exit(1);
}
