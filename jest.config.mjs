/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  // ESM is configured directly below (extensionsToTreatAsEsm + the @swc/jest
  // transform + the .mjs moduleNameMapper), so no ts-jest preset is needed —
  // @swc/jest does all transformation.
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.(t|j)sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          target: "es2020",
        },
        module: { type: "es6" },
      },
    ],
    "^.+\\.mjs$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "ecmascript" },
          target: "es2020",
        },
        module: { type: "es6" },
      },
    ],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "mjs"],
  roots: ["<rootDir>/src", "<rootDir>/test", "<rootDir>/scripts"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.mjs$": "$1",
    // `obsidian` is provided by the host app at runtime, not as an npm package.
    // Units that extend an Obsidian class at runtime (e.g. FocusTaskModal) map to
    // a minimal mock; type-only imports elsewhere are erased and never hit this.
    "^obsidian$": "<rootDir>/test/__mocks__/obsidian.ts",
  },
  // Coverage (enabled via `--coverage`, i.e. `npm run test:coverage`).
  // V8 provider: the @swc/jest transform replaces Babel, so Babel-based
  // instrumentation never runs — V8's built-in coverage maps back through
  // swc's source maps instead.
  coverageProvider: "v8",
  coverageDirectory: "coverage",
  coverageReporters: ["lcov", "text-summary"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    // Non-executable / non-unit-testable, kept in sync with
    // sonar.coverage.exclusions (jest globs .ts only, so the *.svelte entry
    // there has no jest equivalent). Type-only declarations, barrel
    // re-exports, and thin Obsidian wiring exercised by e2e. Logic-dense
    // files (register.ts, views) are NOT excluded — their logic is being
    // extracted into tested modules (plan U2/U5), not hidden.
    "!src/**/types/**",
    "!src/**/types.ts",
    "!src/**/index.ts",
    "!src/main.ts",
    "!src/bases/GanttBasesView.ts",
    // Generated at build time (no source to test) — its only logic lives in the
    // generator, which IS unit-tested (test/unit/releaseNotesBundle.test.ts).
    "!src/releaseNotes.ts",
    // Thin Obsidian view/settings wiring, e2e-tested (test/specs/whats-new.e2e.ts),
    // with all decision logic extracted to tested pure modules
    // (releaseNotesExpand.ts, releaseNoteLinks.ts, settings.ts) — same category
    // as GanttBasesView.ts above.
    "!src/release/ReleaseNotesView.ts",
    "!src/release/GanttSettingTab.ts",
  ],
};

export default config;
