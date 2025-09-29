/**
 * OG-19: Cucumber Configuration
 *
 * Configuration for Cucumber BDD framework integration
 */

module.exports = {
  default: {
    requireModule: ["ts-node/register"],
    require: ["test/step-definitions/**/*.ts"],
    format: ["pretty", "html:test-results/cucumber-report.html"],
    paths: ["features/**/*.feature"],
    dryRun: false,
    strict: true,
  },
  dry: {
    requireModule: ["ts-node/register"],
    require: ["test/step-definitions/**/*.ts"],
    format: ["pretty"],
    paths: ["features/**/*.feature"],
    dryRun: true,
    strict: true,
  },
};
