/**
 * OG-19: BDD Framework Integration Tests
 *
 * Tests for Cucumber framework integration with Jest
 * Following TDD principles - these tests should fail initially
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { BDDFramework } from "../../src/bdd/BDDFramework";
import { FeatureFileLoader } from "../../src/bdd/FeatureFileLoader";
import { StepDefinitionRegistry } from "../../src/bdd/StepDefinitionRegistry";

describe("BDD Framework Integration", () => {
  let bddFramework: BDDFramework;
  let mockFeatureLoader: jest.Mocked<FeatureFileLoader>;
  let mockStepRegistry: jest.Mocked<StepDefinitionRegistry>;

  beforeEach(() => {
    // Mock dependencies following dependency injection principles
    mockFeatureLoader = {
      loadFeatureFiles: jest.fn(),
      validateGherkinSyntax: jest.fn(),
      getFeatureMetadata: jest.fn(),
    } as jest.Mocked<FeatureFileLoader>;

    mockStepRegistry = {
      registerStepDefinition: jest.fn(),
      findStepDefinition: jest.fn(),
      getRegisteredSteps: jest.fn(),
    } as jest.Mocked<StepDefinitionRegistry>;

    bddFramework = new BDDFramework(mockFeatureLoader, mockStepRegistry);
  });

  describe("Cucumber Framework Integration", () => {
    it("should initialize Cucumber framework with Jest", () => {
      // Arrange & Act
      const isInitialized = bddFramework.isInitialized();

      // Assert
      expect(isInitialized).toBe(true);
      expect(bddFramework.getCucumberConfig()).toBeDefined();
    });

    it("should load feature files from features directory", async () => {
      // Arrange
      const expectedFeatures = [
        "features/gantt-visualization/task-rendering.feature",
        "features/bases-integration/data-mapping.feature",
      ];
      mockFeatureLoader.loadFeatureFiles.mockResolvedValue(expectedFeatures);

      // Act
      const loadedFeatures = await bddFramework.loadFeatures();

      // Assert
      expect(mockFeatureLoader.loadFeatureFiles).toHaveBeenCalledWith(
        "features"
      );
      expect(loadedFeatures).toEqual(expectedFeatures);
    });

    it("should validate Gherkin syntax in feature files", async () => {
      // Arrange
      const featureContent = `
        Feature: Task Rendering
          Scenario: Display basic task
            Given a task with title "Test Task"
            When the Gantt chart is rendered
            Then the task should be visible
      `;
      mockFeatureLoader.validateGherkinSyntax.mockResolvedValue(true);

      // Act
      const isValid = await bddFramework.validateFeatureSyntax(featureContent);

      // Assert
      expect(mockFeatureLoader.validateGherkinSyntax).toHaveBeenCalledWith(
        featureContent
      );
      expect(isValid).toBe(true);
    });
  });

  describe("Step Definition Management", () => {
    it("should register Given-When-Then step definitions", () => {
      // Arrange
      const givenStep = {
        pattern: /^a task with title "(.+)"$/,
        handler: jest.fn(),
      };
      const whenStep = {
        pattern: /^the Gantt chart is rendered$/,
        handler: jest.fn(),
      };
      const thenStep = {
        pattern: /^the task should be visible$/,
        handler: jest.fn(),
      };

      // Act
      bddFramework.registerGivenStep(givenStep.pattern, givenStep.handler);
      bddFramework.registerWhenStep(whenStep.pattern, whenStep.handler);
      bddFramework.registerThenStep(thenStep.pattern, thenStep.handler);

      // Assert
      expect(mockStepRegistry.registerStepDefinition).toHaveBeenCalledTimes(3);
      expect(mockStepRegistry.registerStepDefinition).toHaveBeenCalledWith(
        "Given",
        givenStep.pattern,
        givenStep.handler
      );
      expect(mockStepRegistry.registerStepDefinition).toHaveBeenCalledWith(
        "When",
        whenStep.pattern,
        whenStep.handler
      );
      expect(mockStepRegistry.registerStepDefinition).toHaveBeenCalledWith(
        "Then",
        thenStep.pattern,
        thenStep.handler
      );
    });

    it("should find step definitions by pattern", () => {
      // Arrange
      const stepText = 'a task with title "Test Task"';
      const expectedHandler = jest.fn();
      mockStepRegistry.findStepDefinition.mockReturnValue(expectedHandler);

      // Act
      const handler = bddFramework.findStepHandler("Given", stepText);

      // Assert
      expect(mockStepRegistry.findStepDefinition).toHaveBeenCalledWith(
        "Given",
        stepText
      );
      expect(handler).toBe(expectedHandler);
    });
  });

  describe("Scenario Execution", () => {
    it("should execute scenarios independently", async () => {
      // Arrange
      const scenario = {
        name: "Display basic task",
        steps: [
          { keyword: "Given", text: 'a task with title "Test Task"' },
          { keyword: "When", text: "the Gantt chart is rendered" },
          { keyword: "Then", text: "the task should be visible" },
        ],
      };

      const mockHandlers = [jest.fn(), jest.fn(), jest.fn()];
      mockStepRegistry.findStepDefinition
        .mockReturnValueOnce(mockHandlers[0])
        .mockReturnValueOnce(mockHandlers[1])
        .mockReturnValueOnce(mockHandlers[2]);

      // Act
      const result = await bddFramework.executeScenario(scenario);

      // Assert
      expect(result.success).toBe(true);
      expect(mockHandlers[0]).toHaveBeenCalled();
      expect(mockHandlers[1]).toHaveBeenCalled();
      expect(mockHandlers[2]).toHaveBeenCalled();
    });

    it("should isolate scenario execution contexts", async () => {
      // Arrange
      const scenario1 = { name: "Scenario 1", steps: [] };
      const scenario2 = { name: "Scenario 2", steps: [] };

      // Act
      const context1 = bddFramework.createScenarioContext(scenario1);
      const context2 = bddFramework.createScenarioContext(scenario2);

      // Assert
      expect(context1).not.toBe(context2);
      expect(context1.scenarioName).toBe("Scenario 1");
      expect(context2.scenarioName).toBe("Scenario 2");
    });
  });

  describe("Living Documentation Generation", () => {
    it("should generate documentation from feature files", async () => {
      // Arrange
      const features = ["feature1.feature", "feature2.feature"];
      mockFeatureLoader.loadFeatureFiles.mockResolvedValue(features);
      mockFeatureLoader.getFeatureMetadata.mockResolvedValue({
        title: "Task Rendering",
        description: "Tests for task rendering functionality",
        scenarios: ["Display basic task", "Display task with dependencies"],
      });

      // Act
      const documentation = await bddFramework.generateLivingDocumentation();

      // Assert
      expect(documentation).toBeDefined();
      expect(documentation.features).toHaveLength(2);
      expect(mockFeatureLoader.getFeatureMetadata).toHaveBeenCalledTimes(2);
    });
  });
});
