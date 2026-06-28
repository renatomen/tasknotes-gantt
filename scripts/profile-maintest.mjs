/**
 * ONE-TIME reference profiler (#161 U6 repro generator).
 *
 * Reads a real vault EXACTLY ONCE and emits a STRUCTURAL PROFILE (no real text
 * content — only shapes, distributions, and graph statistics) that a separate
 * generator algorithm consumes to synthesize a fidelity-equivalent vault. The
 * generated vault has the same folder structure, file counts, frontmatter field
 * shapes, status/date/priority distributions, and relationship-link density as the
 * source — with SYNTHETIC values — so the Base query + TaskNotes relationship graph
 * (and thus the #161 loop) reproduce without copying any private data.
 *
 * Usage: node scripts/profile-maintest.mjs <vaultPath> [outProfile.json]
 * Referenced ONCE to parameterize the generator; never read again after.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules", ".smart-env"]);
const vaultPath = process.argv[2];
const outPath = process.argv[3] ?? path.join("test", "fixtures", "maintest-profile.json");
if (!vaultPath) { console.error("usage: node scripts/profile-maintest.mjs <vaultPath> [out.json]"); process.exit(1); }

/** Extract the leading YAML frontmatter block (Obsidian rules: starts at byte 0 after
 * optional BOM with `---`, ends at the next line that is exactly `---` or `...`). */
function extractFrontmatter(content) {
  let s = content;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip BOM
  if (!/^---\r?\n/.test(s)) return null;
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  return m ? m[1] : null;
}

function isWikiLink(v) { return typeof v === "string" && /\[\[.+?\]\]/.test(v); }
function classifyValue(v) {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return "date";
  if (Array.isArray(v)) return "array";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return "number";
  if (typeof v === "string") {
    if (isWikiLink(v)) return "link";
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
    return "string";
  }
  return typeof v;
}

const profile = {
  source: path.resolve(vaultPath),
  fileCount: 0,
  withFrontmatter: 0,
  noFrontmatter: 0,
  parseErrors: 0,
  folders: {},                 // relDir -> file count
  fieldFrequency: {},          // field -> count of notes that have it
  fieldValueType: {},          // field -> {type -> count}
  enumValues: {},              // field -> {value -> count}  (for low-cardinality string/link fields)
  linkFields: {},              // field -> {outDegreeHistogram, internalTargets, externalTargets}
  archetypes: {},              // sorted-field-signature -> count
  basenameLen: {},             // length bucket -> count
};

const ENUM_CANDIDATES = new Set(["status", "priority", "type", "tags", "kind", "category"]);
const enumScratch = {};        // field -> Map(value->count) (capped)

// Graph capture: parent-forest via `in` links (note.in = parentProperty).
const noteRecords = [];        // {base, inTargets:[basename], actionable:bool, hasDate:bool, status}
function linkTargets(v) {
  const out = [];
  for (const item of (Array.isArray(v) ? v : [v])) {
    if (typeof item !== "string") continue;
    const m = item.match(/\[\[([^\]|#]+)/);
    if (m) out.push(path.basename(m[1].trim()));
  }
  return out;
}

function walk(relDir) {
  const abs = path.join(vaultPath, relDir);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  let fileCountHere = 0;
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(relDir, e.name)); continue; }
    if (path.extname(e.name).toLowerCase() !== ".md") continue;
    fileCountHere += 1;
    profile.fileCount += 1;
    const rel = path.join(relDir, e.name);
    let content;
    try { content = fs.readFileSync(path.join(vaultPath, rel), "utf8"); } catch { continue; }
    const lenBucket = String(Math.min(80, Math.round(e.name.length / 10) * 10));
    profile.basenameLen[lenBucket] = (profile.basenameLen[lenBucket] ?? 0) + 1;
    const fmText = extractFrontmatter(content);
    if (fmText === null) { profile.noFrontmatter += 1; continue; }
    let fm;
    try { fm = yaml.load(fmText); } catch { profile.parseErrors += 1; continue; }
    if (!fm || typeof fm !== "object" || Array.isArray(fm)) { profile.noFrontmatter += 1; continue; }
    profile.withFrontmatter += 1;
    const fields = Object.keys(fm).sort();
    const sig = fields.join(",");
    profile.archetypes[sig] = (profile.archetypes[sig] ?? 0) + 1;
    noteRecords.push({
      base: path.basename(e.name, ".md"),
      inTargets: fm.in !== undefined ? linkTargets(fm.in) : [],
      actionable: fm.isActionable === true,
      hasDate: fm.scheduled instanceof Date || fm.due instanceof Date || fm.start instanceof Date,
      status: typeof fm.status === "string" ? fm.status : null,
    });
    for (const [k, v] of Object.entries(fm)) {
      profile.fieldFrequency[k] = (profile.fieldFrequency[k] ?? 0) + 1;
      const t = classifyValue(v);
      (profile.fieldValueType[k] ??= {})[t] = (profile.fieldValueType[k][t] ?? 0) + 1;
      // Link field stats
      const vals = Array.isArray(v) ? v : [v];
      const links = vals.filter(isWikiLink);
      if (links.length > 0 || t === "link") {
        const lf = (profile.linkFields[k] ??= { outDeg: {}, total: 0 });
        const deg = String(links.length);
        lf.outDeg[deg] = (lf.outDeg[deg] ?? 0) + 1;
        lf.total += links.length;
      }
      // Enum capture for low-cardinality fields
      if (ENUM_CANDIDATES.has(k) || t === "string" || t === "bool") {
        const m = (enumScratch[k] ??= new Map());
        for (const item of vals) {
          if (typeof item === "string" || typeof item === "boolean") {
            const key = String(item).slice(0, 60);
            if (m.size < 200) m.set(key, (m.get(key) ?? 0) + 1);
          }
        }
      }
    }
  }
  if (fileCountHere > 0 || relDir === "") profile.folders[relDir || "/"] = fileCountHere;
}

walk("");

// Keep enum distributions only for genuinely low-cardinality fields (≤40 distinct).
for (const [k, m] of Object.entries(enumScratch)) {
  if (m.size <= 40) profile.enumValues[k] = Object.fromEntries(m);
}

// Parent-forest graph stats: resolve `in` links → in-degree (children) per note,
// and how many ACTIONABLE notes have children (the Show-all expansion driver).
{
  const baseSet = new Set(noteRecords.map((n) => n.base));
  const inDegree = new Map();           // base -> child count
  let internalLinks = 0; let externalLinks = 0;
  for (const n of noteRecords) {
    for (const t of n.inTargets) {
      if (baseSet.has(t)) { inDegree.set(t, (inDegree.get(t) ?? 0) + 1); internalLinks += 1; }
      else externalLinks += 1;
    }
  }
  const inDegHist = {};
  for (const n of noteRecords) { const d = inDegree.get(n.base) ?? 0; const b = d >= 10 ? "10+" : String(d); inDegHist[b] = (inDegHist[b] ?? 0) + 1; }
  const actionable = noteRecords.filter((n) => n.actionable);
  const actionableStatusDist = {};
  for (const n of actionable) { const s = n.status ?? "(none)"; actionableStatusDist[s] = (actionableStatusDist[s] ?? 0) + 1; }
  profile.actionableStatusDist = actionableStatusDist;
  const actionableWithChildren = actionable.filter((n) => (inDegree.get(n.base) ?? 0) > 0).length;
  const actionableWithDate = actionable.filter((n) => n.hasDate).length;
  // Approx the Base's matched set: isActionable && status not in the excluded set.
  // The excluded statuses are vault-specific (a private taxonomy), so they are NOT
  // hardcoded here (property-agnostic core principle) — pass them via
  // OG_PROFILE_EXCLUDED_STATUSES (comma-separated). Unset → no status exclusion, so
  // matchedSetApprox over-counts; that's fine for a generic structural profile.
  const EXCLUDED = new Set((process.env.OG_PROFILE_EXCLUDED_STATUSES ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const matchedApprox = actionable.filter((n) => !n.status || !EXCLUDED.has(n.status)).length;
  profile.graph = {
    notesWithFm: noteRecords.length,
    internalInLinks: internalLinks,
    externalInLinks: externalLinks,
    inDegreeHistogram: inDegHist,
    actionableCount: actionable.length,
    actionableWithChildren,
    actionableWithDate,
    matchedSetApprox: matchedApprox,
  };
}

// Sort archetypes + fields by frequency for readability; keep top archetypes.
const topArchetypes = Object.entries(profile.archetypes).sort((a, b) => b[1] - a[1]).slice(0, 40);
profile.archetypes = Object.fromEntries(topArchetypes);
profile.distinctArchetypes = topArchetypes.length;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(profile, null, 2), "utf8");

// Human summary
const fld = Object.entries(profile.fieldFrequency).sort((a, b) => b[1] - a[1]);
console.log(`[PROFILE] ${profile.fileCount} md files; ${profile.withFrontmatter} with frontmatter, ${profile.noFrontmatter} without, ${profile.parseErrors} parse errors`);
console.log(`[PROFILE] folders: ${Object.keys(profile.folders).length}; distinct archetypes (top): ${profile.distinctArchetypes}`);
console.log(`[PROFILE] top fields: ${fld.slice(0, 25).map(([k, c]) => `${k}(${c})`).join(", ")}`);
console.log(`[PROFILE] link fields: ${Object.entries(profile.linkFields).map(([k, v]) => `${k}(total=${v.total})`).join(", ")}`);
console.log(`[PROFILE] enum fields captured: ${Object.keys(profile.enumValues).join(", ")}`);
console.log(`[PROFILE] wrote ${outPath}`);
