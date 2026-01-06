#!/usr/bin/env node
/**
 * OG-39: Semantic Tag Manager
 *
 * Manages semantic tags for BDD scenarios
 * Provides validation, suggestions, and registry management
 */

import { readFileSync, existsSync } from "fs";
import yaml from "js-yaml";

const REGISTRY_PATH = ".bdd/semantic-tags.yaml";

/**
 * Load semantic tag registry
 */
function loadTagRegistry() {
  try {
    if (!existsSync(REGISTRY_PATH)) {
      throw new Error(`Tag registry not found at ${REGISTRY_PATH}`);
    }

    const content = readFileSync(REGISTRY_PATH, "utf8");
    return yaml.load(content);
  } catch (error) {
    console.error(`❌ Error loading tag registry: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Get all available tags from registry
 */
function getAllTags(registry) {
  const tags = new Set();

  // Add epic tags
  if (registry.epics) {
    Object.keys(registry.epics).forEach((tag) => tags.add(tag));
  }

  // Add feature tags
  if (registry.features) {
    Object.keys(registry.features).forEach((tag) => tags.add(tag));
  }

  // Add priority tags
  if (registry.priorities) {
    Object.keys(registry.priorities).forEach((tag) => tags.add(tag));
  }

  // Add test type tags
  if (registry.test_types) {
    Object.keys(registry.test_types).forEach((tag) => tags.add(tag));
  }

  // Add platform tags
  if (registry.platforms) {
    Object.keys(registry.platforms).forEach((tag) => tags.add(tag));
  }

  // Add component tags
  if (registry.components) {
    Object.keys(registry.components).forEach((tag) => tags.add(tag));
  }

  return Array.from(tags).sort();
}

/**
 * Validate tags against registry
 */
function validateTags(tags, registry) {
  const allValidTags = new Set(getAllTags(registry));
  const errors = [];
  const warnings = [];

  // Check if all tags are registered
  const invalidTags = tags.filter((tag) => !allValidTags.has(tag));
  if (invalidTags.length > 0) {
    errors.push(`Unregistered tags: ${invalidTags.join(", ")}`);
  }

  // Check required tags
  if (registry.validation?.required_tags) {
    for (const requiredCategory of registry.validation.required_tags) {
      const categoryTags = getCategoryTags(registry, requiredCategory);
      const hasRequiredTag = tags.some((tag) => categoryTags.includes(tag));

      if (!hasRequiredTag) {
        errors.push(`Missing required ${requiredCategory} tag`);
      }
    }
  }

  // Check mutually exclusive tags
  if (registry.validation?.mutually_exclusive) {
    for (const exclusiveGroup of registry.validation.mutually_exclusive) {
      const foundTags = tags.filter((tag) => exclusiveGroup.includes(tag));
      if (foundTags.length > 1) {
        errors.push(`Mutually exclusive tags found: ${foundTags.join(", ")}`);
      }
    }
  }

  // Check recommended combinations
  if (registry.validation?.recommended_combinations) {
    for (const combination of registry.validation.recommended_combinations) {
      const hasFirst = tags.includes(combination[0]);
      const hasSecond = tags.includes(combination[1]);

      if (hasFirst && !hasSecond) {
        warnings.push(
          `Consider adding ${combination[1]} when using ${combination[0]}`
        );
      }
    }
  }

  return { errors, warnings, valid: errors.length === 0 };
}

/**
 * Get tags for a specific category
 */
function getCategoryTags(registry, category) {
  switch (category) {
    case "epic":
      return Object.keys(registry.epics || {});
    case "feature":
      return Object.keys(registry.features || {});
    case "priority":
      return Object.keys(registry.priorities || {});
    case "test_type":
      return Object.keys(registry.test_types || {});
    case "platform":
      return Object.keys(registry.platforms || {});
    case "component":
      return Object.keys(registry.components || {});
    default:
      return [];
  }
}

/**
 * Suggest tags based on context
 */
function suggestTags(context) {
  const suggestions = {
    epic: [],
    feature: [],
    priority: ["@priority-medium"], // Default suggestion
    test_type: ["@regression"], // Default suggestion
    platform: ["@cross-platform"], // Default suggestion
  };

  // Suggest epic based on context keywords
  const contextLower = context.toLowerCase();

  if (
    contextLower.includes("gantt") ||
    contextLower.includes("chart") ||
    contextLower.includes("visual")
  ) {
    suggestions.epic.push("@epic-gantt-visualization");
  }
  if (contextLower.includes("bases") || contextLower.includes("integration")) {
    suggestions.epic.push("@epic-bases-integration");
  }
  if (contextLower.includes("task") || contextLower.includes("edit")) {
    suggestions.epic.push("@epic-task-management");
  }
  if (contextLower.includes("data") || contextLower.includes("transform")) {
    suggestions.epic.push("@epic-data-sources");
  }
  if (
    contextLower.includes("ui") ||
    contextLower.includes("user") ||
    contextLower.includes("experience")
  ) {
    suggestions.epic.push("@epic-user-experience");
  }
  if (contextLower.includes("performance") || contextLower.includes("speed")) {
    suggestions.epic.push("@epic-performance");
    suggestions.test_type = ["@performance"];
    suggestions.priority = ["@priority-high"];
  }

  // Suggest test types based on context
  if (contextLower.includes("critical") || contextLower.includes("smoke")) {
    suggestions.test_type = ["@smoke"];
    suggestions.priority = ["@priority-critical"];
  }
  if (contextLower.includes("error") || contextLower.includes("exception")) {
    suggestions.test_type.push("@regression");
  }
  if (contextLower.includes("accessibility") || contextLower.includes("a11y")) {
    suggestions.test_type.push("@accessibility");
  }

  return suggestions;
}

/**
 * Display tag information
 */
function displayTagInfo(tag, registry) {
  const categories = [
    "epics",
    "features",
    "priorities",
    "test_types",
    "platforms",
    "components",
  ];

  for (const category of categories) {
    if (registry[category] && registry[category][tag]) {
      const info = registry[category][tag];
      console.log(`\n📋 ${tag} (${category.slice(0, -1)})`);
      console.log(`   Description: ${info.description || "No description"}`);

      if (info.epic) console.log(`   Epic: ${info.epic}`);
      if (info.owner) console.log(`   Owner: ${info.owner}`);
      if (info.severity) console.log(`   Severity: ${info.severity}`);
      if (info.execution_time)
        console.log(`   Execution Time: ${info.execution_time}`);
      if (info.frequency) console.log(`   Frequency: ${info.frequency}`);
      if (info.technology) console.log(`   Technology: ${info.technology}`);
      if (info.status) console.log(`   Status: ${info.status}`);

      return;
    }
  }

  console.log(`❌ Tag not found: ${tag}`);
}

/**
 * List all tags by category
 */
function listAllTags(registry) {
  console.log("🏷️  Available Semantic Tags\n");

  const categories = [
    { name: "Epics", key: "epics", icon: "🎯" },
    { name: "Features", key: "features", icon: "⚡" },
    { name: "Priorities", key: "priorities", icon: "🔥" },
    { name: "Test Types", key: "test_types", icon: "🧪" },
    { name: "Platforms", key: "platforms", icon: "💻" },
    { name: "Components", key: "components", icon: "🔧" },
  ];

  categories.forEach((category) => {
    if (registry[category.key]) {
      console.log(`${category.icon} ${category.name}:`);
      Object.entries(registry[category.key]).forEach(([tag, info]) => {
        console.log(`   ${tag} - ${info.description || "No description"}`);
      });
      console.log("");
    }
  });
}

/**
 * Main CLI interface
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log("🏷️  OG-39: Semantic Tag Manager\n");

  if (!command || command === "--help" || command === "-h") {
    console.log("Usage: npm run tags <command> [options]\n");
    console.log("Commands:");
    console.log("  list                    List all available tags");
    console.log("  validate <tags>         Validate comma-separated tags");
    console.log("  suggest <context>       Suggest tags based on context");
    console.log("  info <tag>              Show information about a tag");
    console.log("  check-feature <file>    Validate tags in a feature file");
    console.log("\nExamples:");
    console.log("  npm run tags list");
    console.log(
      '  npm run tags validate "@epic-gantt-visualization,@priority-high"'
    );
    console.log('  npm run tags suggest "task rendering performance"');
    console.log('  npm run tags info "@epic-gantt-visualization"');
    return;
  }

  const registry = loadTagRegistry();

  switch (command) {
    case "list":
      listAllTags(registry);
      break;

    case "validate": {
      if (!args[1]) {
        console.error("❌ Please provide tags to validate");
        process.exit(1);
      }
      const tags = args[1].split(",").map((tag) => tag.trim());
      const validation = validateTags(tags, registry);

      if (validation.valid) {
        console.log("✅ All tags are valid!");
      } else {
        console.log("❌ Validation failed:");
        validation.errors.forEach((error) => console.log(`   - ${error}`));
      }

      if (validation.warnings.length > 0) {
        console.log("\n⚠️  Warnings:");
        validation.warnings.forEach((warning) =>
          console.log(`   - ${warning}`)
        );
      }
      break;
    }

    case "suggest": {
      if (!args[1]) {
        console.error("❌ Please provide context for suggestions");
        process.exit(1);
      }
      const context = args.slice(1).join(" ");
      const suggestions = suggestTags(context);

      console.log(`💡 Tag suggestions for: "${context}"\n`);
      Object.entries(suggestions).forEach(([category, tags]) => {
        if (tags.length > 0) {
          console.log(`${category}: ${tags.join(", ")}`);
        }
      });
      break;
    }

    case "info":
      if (!args[1]) {
        console.error("❌ Please provide a tag to get information about");
        process.exit(1);
      }
      displayTagInfo(args[1], registry);
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      console.error("Use --help to see available commands");
      process.exit(1);
  }
}

// Export for testing
export { loadTagRegistry, getAllTags, validateTags, suggestTags };

// Run if called directly
if (
  import.meta.url.endsWith(process.argv[1]) ||
  process.argv[1].endsWith("semantic-tag-manager.mjs")
) {
  main();
}
