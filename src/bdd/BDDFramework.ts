/**
 * OG-19: BDD Framework Core Implementation
 *
 * Main BDD framework class that integrates Cucumber with Jest
 * Follows single responsibility principle and dependency injection
 */

import { FeatureFileLoader } from "./FeatureFileLoader";
import { StepDefinitionRegistry } from "./StepDefinitionRegistry";

export interface CucumberConfig {
  featuresPath: string;
  stepDefinitionsPath: string;
  format: string[];
  requireModule: string[];
}

export interface ScenarioStep {
  keyword: string;
  text: string;
}

export interface Scenario {
  name: string;
  steps: ScenarioStep[];
}

export interface ScenarioContext {
  scenarioName: string;
  data: Record<string, unknown>;
}

export interface ScenarioResult {
  success: boolean;
  error?: Error;
  steps: Array<{ step: ScenarioStep; success: boolean; error?: Error }>;
}

export interface FeatureMetadata {
  title: string;
  description: string;
  scenarios: string[];
}

export interface LivingDocumentation {
  features: Array<{
    name: string;
    metadata: FeatureMetadata;
  }>;
  generatedAt: Date;
}

/**
 * Core BDD Framework class
 * Integrates Cucumber with Jest for executable specifications
 */
export class BDDFramework {
  private initialized: boolean = false;
  private cucumberConfig: CucumberConfig;

  constructor(
    private featureLoader: FeatureFileLoader,
    private stepRegistry: StepDefinitionRegistry
  ) {
    this.cucumberConfig = {
      featuresPath: "features",
      stepDefinitionsPath: "test/step-definitions",
      format: ["pretty", "html:test-results/cucumber-report.html"],
      requireModule: ["ts-node/register"],
    };
    this.initialized = true;
  }

  /**
   * Check if the BDD framework is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get Cucumber configuration
   */
  getCucumberConfig(): CucumberConfig {
    return { ...this.cucumberConfig };
  }

  /**
   * Load feature files from the features directory
   */
  async loadFeatures(featuresPath: string = "features"): Promise<string[]> {
    return await this.featureLoader.loadFeatureFiles(featuresPath);
  }

  /**
   * Validate Gherkin syntax in feature file content
   */
  async validateFeatureSyntax(featureContent: string): Promise<boolean> {
    return await this.featureLoader.validateGherkinSyntax(featureContent);
  }

  /**
   * Register a Given step definition
   */
  registerGivenStep(pattern: RegExp, handler: Function): void {
    this.stepRegistry.registerStepDefinition("Given", pattern, handler);
  }

  /**
   * Register a When step definition
   */
  registerWhenStep(pattern: RegExp, handler: Function): void {
    this.stepRegistry.registerStepDefinition("When", pattern, handler);
  }

  /**
   * Register a Then step definition
   */
  registerThenStep(pattern: RegExp, handler: Function): void {
    this.stepRegistry.registerStepDefinition("Then", pattern, handler);
  }

  /**
   * Find step handler by keyword and text
   */
  findStepHandler(keyword: string, stepText: string): Function | null {
    return this.stepRegistry.findStepDefinition(keyword, stepText);
  }

  /**
   * Execute a scenario with its steps
   */
  async executeScenario(scenario: Scenario): Promise<ScenarioResult> {
    const result: ScenarioResult = {
      success: true,
      steps: [],
    };

    try {
      for (const step of scenario.steps) {
        const handler = this.findStepHandler(step.keyword, step.text);

        if (!handler) {
          throw new Error(
            `No step definition found for: ${step.keyword} ${step.text}`
          );
        }

        try {
          await handler(step.text);
          result.steps.push({ step, success: true });
        } catch (error) {
          result.steps.push({ step, success: false, error: error as Error });
          result.success = false;
          result.error = error as Error;
          break;
        }
      }
    } catch (error) {
      result.success = false;
      result.error = error as Error;
    }

    return result;
  }

  /**
   * Create isolated context for scenario execution
   */
  createScenarioContext(scenario: Scenario): ScenarioContext {
    return {
      scenarioName: scenario.name,
      data: {},
    };
  }

  /**
   * Generate living documentation from feature files
   */
  async generateLivingDocumentation(): Promise<LivingDocumentation> {
    const features = await this.loadFeatures();
    const documentation: LivingDocumentation = {
      features: [],
      generatedAt: new Date(),
    };

    for (const featurePath of features) {
      const metadata = await this.featureLoader.getFeatureMetadata(featurePath);
      documentation.features.push({
        name: featurePath,
        metadata,
      });
    }

    return documentation;
  }
}
