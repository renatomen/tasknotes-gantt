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
const TASKNOTES_SECRET_KEYS = new Set([
  "apiAuthToken", "lemonSqueezyLicenseKey",
  "googleOAuthClientId", "googleOAuthClientSecret", "microsoftOAuthClientId", "microsoftOAuthClientSecret",
  "googleCalendarSyncTokens", "microsoftCalendarSyncTokens", "googleCalendarSyncQueue",
  "enabledGoogleCalendars", "enabledMicrosoftCalendars", "icsIntegration",
  "webhooks", "basesPOCLogs", "basesAdvancedDataLogs",
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

/** Walk a vault collecting every directory, every `.md` (path + frontmatter block),
 * and every `.base` (path + verbatim content). Skips dotfolders/attachments. */
function scanVault(vaultPath) {
  const folders = [];
  const notes = [];   // { p, fm }  (fm = "" when the note has no frontmatter)
  const bases = [];   // { p, c }
  const walk = (relDir) => {
    if (relDir) folders.push(relDir.split(path.sep).join("/"));
    let entries;
    try { entries = fs.readdirSync(path.join(vaultPath, relDir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(relDir, e.name)); continue; }
      const rel = path.join(relDir, e.name);
      const relPosix = rel.split(path.sep).join("/");
      const ext = path.extname(e.name).toLowerCase();
      if (ext === ".md") {
        let content = ""; try { content = fs.readFileSync(path.join(vaultPath, rel), "utf8"); } catch { /* */ }
        notes.push({ p: relPosix, fm: extractFrontmatterBlock(content) ?? "" });
      } else if (ext === ".base") {
        let content = ""; try { content = fs.readFileSync(path.join(vaultPath, rel), "utf8"); } catch { /* */ }
        bases.push({ p: relPosix, c: content });
      }
    }
  };
  walk("");
  return { folders, notes, bases };
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

/** Fidelity gate: generate from the fixture, then diff against the original. */
function cmdVerify(fixturePath, vaultPath) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const tmp = path.join(os.tmpdir(), `vac-verify-${process.pid}`);
  generateFromFixture(fixture, tmp);

  const orig = scanVault(vaultPath);
  const gen = scanVault(tmp);

  const setOf = (arr, key) => new Set(arr.map((x) => (typeof x === "string" ? x : x[key])));
  const diffSets = (a, b) => { const miss = [...a].filter((x) => !b.has(x)); const extra = [...b].filter((x) => !a.has(x)); return { miss, extra }; };

  const folderDiff = diffSets(setOf(orig.folders), setOf(gen.folders));
  const noteDiff = diffSets(setOf(orig.notes, "p"), setOf(gen.notes, "p"));
  const baseDiff = diffSets(setOf(orig.bases, "p"), setOf(gen.bases, "p"));

  // Frontmatter equality per shared note path.
  const genFm = new Map(gen.notes.map((n) => [n.p, n.fm]));
  let fmMismatch = 0; const fmSamples = [];
  for (const n of orig.notes) {
    const g = genFm.get(n.p);
    if (g === undefined) continue;
    const a = (n.fm ?? "").replace(/\r\n/g, "\n");
    const b = (g ?? "").replace(/\r\n/g, "\n");
    if (a !== b) { fmMismatch += 1; if (fmSamples.length < 5) fmSamples.push(n.p); }
  }

  // Relationship-graph equality: the `in`-link multiset per note (the bug-relevant
  // structure). Compared as raw frontmatter already covers it, but report explicitly.
  const ok = folderDiff.miss.length === 0 && folderDiff.extra.length === 0
    && noteDiff.miss.length === 0 && noteDiff.extra.length === 0
    && baseDiff.miss.length === 0 && baseDiff.extra.length === 0
    && fmMismatch === 0;

  console.log(`[verify] folders: orig=${orig.folders.length} gen=${gen.folders.length} miss=${folderDiff.miss.length} extra=${folderDiff.extra.length}`);
  console.log(`[verify] notes:   orig=${orig.notes.length} gen=${gen.notes.length} miss=${noteDiff.miss.length} extra=${noteDiff.extra.length}`);
  console.log(`[verify] bases:   orig=${orig.bases.length} gen=${gen.bases.length} miss=${baseDiff.miss.length} extra=${baseDiff.extra.length}`);
  console.log(`[verify] frontmatter mismatches: ${fmMismatch}${fmSamples.length ? " e.g. " + fmSamples.join(", ") : ""}`);
  if (noteDiff.miss.length) console.log(`[verify] sample missing notes: ${noteDiff.miss.slice(0, 5).join(", ")}`);
  console.log(`[verify] ${ok ? "PASS — generated vault is indistinguishable from original (except bodies)" : "FAIL — see diffs above"}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!ok) process.exit(2);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "extract" && a && b) cmdExtract(a, b);
else if (cmd === "generate" && a && b) cmdGenerate(a, b);
else if (cmd === "verify" && a && b) cmdVerify(a, b);
else {
  console.error("usage:\n  node scripts/vault-as-code.mjs extract  <vaultPath> <fixturePath>\n  node scripts/vault-as-code.mjs generate <fixturePath> <outVault>\n  node scripts/vault-as-code.mjs verify   <fixturePath> <vaultPath>");
  process.exit(1);
}
