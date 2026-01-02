I'll perform a comprehensive analysis of your obsidian-gantt repository to provide you with a
complete environment setup guide. Let me examine all the key configuration files and dependencies.

# Comprehensive Development Environment Setup Guide

Based on my analysis of your obsidian-gantt repository, here's a complete step-by-step guide to
restore your development environment from scratch:

## 1. **Package Dependencies & Installation**

### Node.js Version Requirements

- **Required**: Node.js **18+** (specified in `package.json` engines)
- **Recommended**: Node.js **20** (used in CI/CD pipeline)
- **Package Manager**: npm (package-lock.json present)

### Dependencies Overview

**Runtime Dependencies:**

- `@svar-ui/svelte-gantt`: ^2.3.0 (main Gantt chart library)
- `@cucumber/gherkin`: ^27.0.0 (BDD framework)
- `axios`: ^1.6.0 (HTTP client)
- `inquirer`: ^9.2.0 (CLI interactions)
- `simple-git`: ^3.20.0 (Git operations)

**Key Development Dependencies:**

- `svelte`: ^5.39.6 (Svelte 5 with runes)
- `vite`: ^7.1.7 (build system)
- `typescript`: ^5.9.2
- `@sveltejs/vite-plugin-svelte`: ^6.2.1
- `jest`: ^30.1.3 (testing framework)
- `eslint`: ^9.36.0 (linting)
- `prettier`: ^3.6.2 (formatting)
- `husky`: ^9.1.7 (git hooks)
- WebDriverIO suite for E2E testing

## 2. **Build System Configuration**

### Primary Build System: Vite

- **Config**: `vite.config.ts` with Svelte 5 runes enabled
- **Output**: `dist/` directory
- **Target**: ES2019, CommonJS format for Obsidian compatibility
- **External dependencies**: Obsidian APIs, CodeMirror, Electron

### Alternative Build: ESBuild

- **Config**: `scripts/build.mjs` (alternative build script)
- **Target**: ES2018, browser platform

### TypeScript Configuration

- **Target**: ES2019
- **Module**: ESNext with Bundler resolution
- **Strict mode**: Enabled with comprehensive type checking
- **Path mapping**: `@/*` → `src/*`

## 3. **Development Scripts & Automation**

### Core NPM Scripts

```bash
npm run build          # Vite production build + auto-install to vault
npm run dev            # Vite watch mode for development
npm run test           # Jest unit tests
npm run lint           # ESLint with TypeScript support
npm run typecheck      # Svelte type checking
npm run format         # Prettier formatting
npm run e2e            # WebDriverIO E2E tests
npm run e2e:local      # Local E2E with custom vault path
```

### BDD & Testing Scripts

```bash
npm run test:bdd           # Run BDD tests
npm run validate:bdd       # Validate BDD syntax
npm run detect:bdd-changes # Detect BDD file changes
npm run generate:feature   # Generate new BDD features
npm run tags               # Semantic tag management
npm run sync:assertthat    # Sync with AssertThat platform
```

### Custom Scripts in `/scripts/`

- **install-to-vault.cjs**: Auto-install plugin to test vault
- **e2e-local.mjs**: Local E2E test runner
- **build.mjs**: Alternative ESBuild configuration
- **BDD framework**: Complete BDD validation and sync system

## 4. **Environment Variables & Configuration**

### Required Environment Variables

```bash
# Test vault path (required for E2E testing)
OBSIDIAN_TEST_VAULT="C:/Users/[username]/obsidian-test-vaults/obsidian-gantt-test-vault"

# Optional: Plugin directory override
PLUGIN_DIR="path/to/plugin/root"

# BDD/AssertThat Integration (optional)
ASSERTTHAT_PROJECT_ID="your-project-id"
ASSERTTHAT_ACCESS_KEY="your-access-key"
ASSERTTHAT_SECRET_KEY="your-secret-key"
ASSERTTHAT_TOKEN="your-token"

# Jira Integration (optional)
JIRA_SERVER_URL="your-jira-url"
```

### Default Paths (hardcoded in scripts)

- **Default test vault**: `C:/Users/renato/obsidian-test-vaults/obsidian-gantt-test-vault`
- **Plugin ID**: `obsidian-gantt`
- **Build output**: `dist/`

## 5. **Development Tools & Prerequisites**

### Required Software

1. **Node.js 20+** (with npm)
2. **Git** (for version control and BDD change detection)
3. **Obsidian** (for E2E testing)
4. **Code Editor** with TypeScript/Svelte support

### Recommended IDE Extensions

- **Svelte for VS Code** (svelte.svelte-vscode)
- **TypeScript and JavaScript Language Features**
- **ESLint** (dbaeumer.vscode-eslint)
- **Prettier** (esbenp.prettier-vscode)
- **Jest** (orta.vscode-jest)
- **GitLens** (eamodio.gitlens)

### System Dependencies

- **Cross-Platform**: Supports Windows, Linux, and macOS development
- **Primary CI**: Runs on windows-latest (GitHub Actions)
- **Git hooks**: Husky for pre-commit validation
- **WebDriverIO**: For Obsidian E2E testing
- **Line Endings**: Enforced LF across all platforms via .gitattributes

## 6. **Step-by-Step Setup Instructions**

### Phase 1: Initial Environment Setup

```bash
# 1. Verify Node.js version
node --version  # Should be 18+ (recommend 20+)

# 2. Clone repository (if not already done)
git clone <repository-url>
cd obsidian-gantt

# 3. Install dependencies
npm ci  # Use ci for exact lock file versions

# 4. Setup git hooks
npm run prepare  # Initializes Husky
```

### Phase 2: Create Test Vault

```bash
# Create test vault directory (adjust path for your system)
mkdir -p "C:/Users/[your-username]/obsidian-test-vaults/obsidian-gantt-test-vault"

# Or set custom path via environment variable
export OBSIDIAN_TEST_VAULT="/path/to/your/test/vault"
```

### Phase 3: Verify Build System

```bash
# 1. Run TypeScript compilation check
npm run typecheck

# 2. Run linting
npm run lint

# 3. Run unit tests
npm run test

# 4. Build the plugin
npm run build

# 5. Verify build output
ls dist/  # Should contain: main.js, manifest.json, styles.css
```

### Phase 4: Test E2E Setup

```bash
# 1. Install Obsidian (if not already installed)
# Download from: https://obsidian.md/

# 2. Run local E2E tests
npm run e2e:local

# 3. Verify plugin installation in test vault
# Check: [test-vault]/.obsidian/plugins/obsidian-gantt/
```

### Phase 5: Development Workflow Verification

```bash
# 1. Start development mode
npm run dev  # Should watch files and auto-rebuild

# 2. Test formatting
npm run format

# 3. Test BDD validation (if using BDD features)
npm run validate:bdd

# 4. Test git hooks
git add .
git commit -m "test: verify setup"  # Should run pre-commit hooks
```

## 7. **Configuration Files Summary**

### Core Configuration Files

- **package.json**: Dependencies and scripts
- **vite.config.ts**: Primary build configuration
- **tsconfig.json**: TypeScript compilation settings
- **eslint.config.mjs**: ESLint rules and settings
- **jest.config.mjs**: Jest testing configuration
- **svelte.config.js**: Svelte 5 with runes enabled

### Cross-Platform Configuration Files

- **.gitattributes**: Enforces LF line endings across all platforms
- **.editorconfig**: Consistent editor settings for all team members
- **.prettierrc.json**: Explicit formatting rules with LF line endings
- **Environment**: No .env files (uses environment variables)

## 8. **Cross-Platform Development**

### Line Ending Configuration

The repository is configured for consistent cross-platform development:

- **All platforms use LF line endings** (enforced by `.gitattributes`)
- **Git configuration**: `core.autocrlf=false` and `core.eol=lf` (set locally)
- **Prettier configuration**: Explicit `endOfLine: "lf"` setting
- **EditorConfig**: Standardizes editor behavior across IDEs

### For New Collaborators

When cloning the repository:

```bash
# The repository will automatically configure line endings
git clone <repository-url>
cd obsidian-gantt

# Verify git configuration (should show LF settings)
git config --local --list | grep -E "(core\.autocrlf|core\.eol)"

# Install dependencies and verify formatting
npm ci
npm run format  # Should show all files as "(unchanged)"
```

### Platform-Specific Notes

- **Windows**: Uses LF line endings (not the Windows default CRLF)
- **Linux/Mac**: Uses native LF line endings (no conversion needed)
- **All platforms**: Consistent formatting via Prettier and EditorConfig

This prevents the common issue where different platforms create massive diffs due to line ending differences.

## 9. **Troubleshooting Common Issues**

### Build Issues

- Ensure Node.js 18+ is installed
- Clear `node_modules` and run `npm ci` if dependency issues
- Check that `dist/` directory is created and contains expected files

### E2E Test Issues

- Verify Obsidian is installed and accessible
- Ensure test vault directory exists and is writable
- Check `OBSIDIAN_TEST_VAULT` environment variable

### Git Hook Issues

- Run `npm run prepare` to reinstall Husky hooks
- Verify `.husky/pre-commit` file exists and is executable

### TypeScript Issues

- Run `npm run typecheck` to verify Svelte type checking
- Bases API types are defined locally in `src/bases/register.ts` (official API 1.10.0+)

## 9. **Final Verification Checklist**

✅ **Node.js 20+ installed**  
✅ **Dependencies installed via `npm ci`**  
✅ **Test vault directory created**  
✅ **Build succeeds (`npm run build`)**  
✅ **Tests pass (`npm test`)**  
✅ **Linting passes (`npm run lint`)**  
✅ **Type checking passes (`npm run typecheck`)**  
✅ **Git hooks working (pre-commit)**  
✅ **E2E tests can run (`npm run e2e:local`)**  
✅ **Development mode works (`npm run dev`)**

This setup will give you a fully functional development environment for the obsidian-gantt project
with all build processes, testing, and automation scripts working correctly.
