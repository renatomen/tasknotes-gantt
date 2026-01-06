import esbuild from "esbuild";
import fs from "node:fs/promises";

const isWatch = process.argv.includes("--watch");

await fs.mkdir("dist", { recursive: true });

const options = {
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  sourcemap: true,
  target: ["es2018"],
  jsx: "automatic",
  loader: { ".ts": "ts", ".tsx": "tsx", ".css": "text" },
  external: ["obsidian", "electron", "fs", "path", "os"],
};

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[build] Watching...");
} else {
  await esbuild.build(options);
  console.log("[build] Done");
}

// Copy static assets (do not fail build if missing)
for (const file of ["manifest.json", "styles.css"]) {
  try {
    await fs.copyFile(file, `dist/${file}`);
  } catch {
    console.warn(`[build] Optional asset missing: ${file}`);
  }
}
