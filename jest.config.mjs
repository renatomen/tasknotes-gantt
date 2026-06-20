/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  preset: "ts-jest/presets/default-esm",
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
  },
  // Coverage (enabled via `--coverage`, i.e. `npm run test:coverage`).
  // V8 provider: the @swc/jest transform replaces Babel, so Babel-based
  // instrumentation never runs — V8's built-in coverage maps back through
  // swc's source maps instead.
  coverageProvider: "v8",
  coverageDirectory: "coverage",
  coverageReporters: ["lcov", "text-summary"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
};

export default config;
