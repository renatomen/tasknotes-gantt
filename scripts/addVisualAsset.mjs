/**
 * Land a produced visual artifact (a ce-demo-reel GIF, a recording, a screenshot)
 * into `docs/media/` under the visual-assets convention and print the pinned
 * markdown reference. The deterministic bridge between "a capture tool produced a
 * file" and "the repo references it correctly" — source-agnostic, so it works
 * regardless of who produced the artifact.
 *
 * Usage:
 *   node scripts/addVisualAsset.mjs <source> <feature-slug> [--theme dark|light] \
 *        [--ref <tag|branch|sha>] [--ext <ext>]
 *
 * `--ext` defaults to the source file's extension; `--ref` defaults to the current
 * git branch (or the commit SHA when on the default branch, to keep the reference
 * immutable). Prints the `![alt](rawUrl)` to paste into a PR body or release note.
 *
 * @module scripts/addVisualAsset
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { assetPath, rawUrl } from "./visualAssets.mjs";

/**
 * Parse CLI argv (already sliced past `node script`).
 * @param {string[]} argv
 * @returns {{source?:string, slug?:string, theme?:string, ref?:string, ext?:string}}
 */
export function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--theme") opts.theme = argv[++i];
    else if (a === "--ref") opts.ref = argv[++i];
    else if (a === "--ext") opts.ext = argv[++i];
    else positional.push(a);
  }
  const out = { source: positional[0], slug: positional[1], ...opts };
  // Drop undefined positionals so callers can `toEqual` cleanly.
  if (out.source === undefined) delete out.source;
  if (out.slug === undefined) delete out.slug;
  return out;
}

/**
 * Compute the committed destination path and the pinned markdown reference. Pure.
 * @param {{source:string, slug:string, theme?:"light"|"dark", ext?:string, ref:string}} args
 * @returns {{destPath:string, url:string, markdown:string}}
 */
export function planAsset({ source, slug, theme, ext, ref }) {
  if (!source) throw new Error("addVisualAsset: a source file is required");
  const resolvedExt = ext || path.extname(source).replace(/^\./, "");
  if (!resolvedExt) {
    throw new Error(`addVisualAsset: cannot infer an extension from "${source}"; pass --ext`);
  }
  const destPath = assetPath(slug, { theme, ext: resolvedExt }); // throws on empty slug
  const url = rawUrl(destPath, ref); // throws on empty ref
  const alt = theme ? `${slug} (${theme})` : slug;
  return { destPath, url, markdown: `![${alt}](${url})` };
}

/** Best-effort default ref: the current branch, or the commit SHA on main/master. */
function defaultRef() {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"]).toString().trim();
    if (branch && !["main", "master", "HEAD"].includes(branch)) return branch;
    return execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
  } catch {
    return null;
  }
}

function main(argv) {
  const args = parseArgs(argv);
  const ref = args.ref || defaultRef();
  if (!ref) {
    throw new Error("addVisualAsset: could not determine a ref; pass --ref <tag|branch|sha>");
  }
  const absSource = path.resolve(process.cwd(), args.source ?? "");
  if (!args.source || !fs.existsSync(absSource)) {
    throw new Error(`addVisualAsset: source file not found: ${args.source ?? "(none)"}`);
  }
  const { destPath, markdown } = planAsset({ ...args, ref });
  const absDest = path.resolve(process.cwd(), destPath);
  fs.mkdirSync(path.dirname(absDest), { recursive: true });
  fs.copyFileSync(absSource, absDest);
  console.log(`✓ ${args.source} → ${destPath}`);
  console.log(markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
