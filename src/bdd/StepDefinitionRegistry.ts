/**
 * OG-19: Step Definition Registry Implementation
 *
 * Manages registration and lookup of BDD step definitions
 * Follows single responsibility principle
 */

export interface StepDefinition {
  keyword: string;
  pattern: RegExp;
  handler: Function;
}

/**
 * Registry for BDD step definitions (Given, When, Then)
 */
export class StepDefinitionRegistry {
  private stepDefinitions: Map<string, StepDefinition[]> = new Map();

  constructor() {
    // Initialize maps for each step type
    this.stepDefinitions.set("Given", []);
    this.stepDefinitions.set("When", []);
    this.stepDefinitions.set("Then", []);
    this.stepDefinitions.set("And", []);
    this.stepDefinitions.set("But", []);
  }

  /**
   * Register a step definition for a specific keyword
   */
  registerStepDefinition(
    keyword: string,
    pattern: RegExp,
    handler: Function
  ): void {
    if (!this.stepDefinitions.has(keyword)) {
      this.stepDefinitions.set(keyword, []);
    }

    const stepDef: StepDefinition = {
      keyword,
      pattern,
      handler,
    };

    this.stepDefinitions.get(keyword)!.push(stepDef);
  }

  /**
   * Find a step definition that matches the given keyword and text
   */
  findStepDefinition(keyword: string, stepText: string): Function | null {
    const steps = this.stepDefinitions.get(keyword);

    if (!steps) {
      return null;
    }

    for (const stepDef of steps) {
      if (stepDef.pattern.test(stepText)) {
        return stepDef.handler;
      }
    }

    return null;
  }

  /**
   * Get all registered step definitions for a keyword
   */
  getRegisteredSteps(keyword?: string): StepDefinition[] {
    if (keyword) {
      return this.stepDefinitions.get(keyword) || [];
    }

    // Return all step definitions
    const allSteps: StepDefinition[] = [];
    for (const steps of this.stepDefinitions.values()) {
      allSteps.push(...steps);
    }
    return allSteps;
  }

  /**
   * Clear all step definitions (useful for testing)
   */
  clear(): void {
    for (const keyword of this.stepDefinitions.keys()) {
      this.stepDefinitions.set(keyword, []);
    }
  }

  /**
   * Get count of registered step definitions
   */
  getStepCount(): number {
    let count = 0;
    for (const steps of this.stepDefinitions.values()) {
      count += steps.length;
    }
    return count;
  }

  /**
   * Check if a step definition exists for the given keyword and pattern
   */
  hasStepDefinition(keyword: string, pattern: RegExp): boolean {
    const steps = this.stepDefinitions.get(keyword);

    if (!steps) {
      return false;
    }

    return steps.some((stepDef) => stepDef.pattern.source === pattern.source);
  }
}
