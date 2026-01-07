import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  GherkinParseError,
  FeatureValidationError,
} from "../../scripts/errors/SyncErrors.mjs";

// Mock @cucumber/gherkin
const mockGherkin = {
  generateMessages: jest.fn(),
  makeSourceEnvelope: jest.fn(),
};

jest.mock("@cucumber/gherkin", () => mockGherkin);

/** Gherkin tag structure */
interface GherkinTag {
  name: string;
}

/** Gherkin step structure */
interface GherkinStep {
  keyword: string;
  text: string;
}

/** Gherkin scenario structure */
interface GherkinScenario {
  name: string;
  tags?: GherkinTag[];
  steps?: GherkinStep[];
}

/** Gherkin rule structure */
interface GherkinRule {
  name: string;
  children?: GherkinChild[];
}

/** Gherkin child element (scenario or rule) */
interface GherkinChild {
  scenario?: GherkinScenario;
  rule?: GherkinRule;
}

/** Gherkin feature structure */
interface GherkinFeature {
  name: string;
  description?: string;
  tags?: GherkinTag[];
  children?: GherkinChild[];
  language?: string;
}

/** Gherkin document structure */
interface GherkinDocument {
  feature?: GherkinFeature;
}

/** Gherkin message structure */
interface GherkinMessage {
  gherkinDocument?: GherkinDocument;
}

/** Scenario metadata */
interface ScenarioMetadata {
  name: string;
  tags: string[];
  steps: number;
  type: string;
  rule?: string;
}

/** Feature metadata */
interface FeatureMetadata {
  name: string;
  description: string;
  tags: string[];
  scenarios: ScenarioMetadata[];
  language: string;
}

/** Validation result */
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata: FeatureMetadata | null;
}

/** Batch validation result */
interface BatchValidationResult {
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  totalErrors: number;
  totalWarnings: number;
  details: (ValidationResult & { filePath: string })[];
}

// GherkinValidator implementation for testing
class GherkinValidator {
  private uuidFn: () => string;

  constructor() {
    this.uuidFn = () => Math.random().toString(36).substring(2, 15);
  }

  async validateFeatureFile(filePath: string): Promise<ValidationResult> {
    try {
      const fs = await import("fs/promises");
      const content = await fs.readFile(filePath, "utf8");
      return this.validateFeatureContent(content, filePath);
    } catch (error) {
      throw new FeatureValidationError(
        `Failed to read feature file: ${filePath}`,
        filePath,
        [(error as Error).message]
      );
    }
  }

  async validateFeatureContent(
    content: string,
    sourcePath = "unknown"
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      metadata: null,
    };

    try {
      // Import Gherkin components dynamically
      const gherkin = await import("@cucumber/gherkin");
      const { generateMessages, makeSourceEnvelope } = gherkin;

      // Create source envelope and parse the feature file
      const sourceEnvelope = makeSourceEnvelope(content, sourcePath);
      const messages = generateMessages(
        sourceEnvelope.source.data,
        sourceEnvelope.source.uri,
        sourceEnvelope.source.mediaType,
        {
          includeSource: false,
          includeGherkinDocument: true,
          newId: this.uuidFn,
        }
      );

      // Find the GherkinDocument message
      const gherkinDocumentMessage = (messages as GherkinMessage[]).find(
        (message: GherkinMessage) => message.gherkinDocument
      );
      const gherkinDocument = gherkinDocumentMessage?.gherkinDocument;

      // Extract feature information from AST
      if (gherkinDocument && gherkinDocument.feature) {
        result.metadata = this.extractFeatureDataFromAST(
          gherkinDocument.feature
        );
        this.validateFeatureStructure(gherkinDocument.feature, result);
      } else {
        result.isValid = false;
        result.errors.push("No valid feature found in file");
      }
    } catch (error) {
      throw new GherkinParseError(
        `Gherkin parse error in ${sourcePath}`,
        sourcePath,
        (error as Error).message
      );
    }

    return result;
  }

  extractFeatureDataFromAST(feature: any): any {
    const metadata = {
      name: feature.name || "",
      description: feature.description || "",
      tags: feature.tags ? feature.tags.map((tag: any) => tag.name) : [],
      scenarios: [] as any[],
      language: feature.language || "en",
    };

    // Extract scenarios from AST
    if (feature.children) {
      feature.children.forEach((child: any) => {
        if (child.scenario) {
          const scenario = child.scenario;
          metadata.scenarios.push({
            name: scenario.name || "",
            tags: scenario.tags
              ? scenario.tags.map((tag: any) => tag.name)
              : [],
            steps: scenario.steps ? scenario.steps.length : 0,
            type: "scenario",
          });
        } else if (child.rule) {
          // Handle rules containing scenarios
          const rule = child.rule;
          if (rule.children) {
            rule.children.forEach((ruleChild: any) => {
              if (ruleChild.scenario) {
                const scenario = ruleChild.scenario;
                metadata.scenarios.push({
                  name: scenario.name || "",
                  tags: scenario.tags
                    ? scenario.tags.map((tag: any) => tag.name)
                    : [],
                  steps: scenario.steps ? scenario.steps.length : 0,
                  type: "scenario",
                  rule: rule.name,
                });
              }
            });
          }
        }
      });
    }

    return metadata;
  }

  validateFeatureStructure(feature: any, result: any): void {
    // Validate feature has a name
    if (!feature.name || feature.name.trim() === "") {
      result.warnings.push("Feature should have a descriptive name");
    }

    // Validate feature has scenarios
    if (!feature.children || feature.children.length === 0) {
      result.errors.push("Feature must contain at least one scenario");
      result.isValid = false;
    }

    // Validate scenarios have steps
    if (feature.children) {
      feature.children.forEach((child: any, index: number) => {
        if (child.scenario) {
          const scenario = child.scenario;
          if (!scenario.steps || scenario.steps.length === 0) {
            result.warnings.push(`Scenario ${index + 1} has no steps`);
          }
          if (!scenario.name || scenario.name.trim() === "") {
            result.warnings.push(
              `Scenario ${index + 1} should have a descriptive name`
            );
          }
        }
      });
    }
  }

  async processMultipleFiles(filePaths: string[]): Promise<any[]> {
    const results = [];

    for (const filePath of filePaths) {
      try {
        const result = await this.validateFeatureFile(filePath);
        results.push({
          filePath,
          ...result,
        });
      } catch (error) {
        results.push({
          filePath,
          isValid: false,
          errors: [(error as Error).message],
          warnings: [],
          metadata: null,
        });
      }
    }

    return results;
  }

  async validateFeatureFiles(filePaths: string[]): Promise<any> {
    const results = {
      totalFiles: filePaths.length,
      validFiles: 0,
      invalidFiles: 0,
      totalErrors: 0,
      totalWarnings: 0,
      details: [] as any[],
    };

    const validationResults = await this.processMultipleFiles(filePaths);

    validationResults.forEach((result) => {
      if (result.isValid) {
        results.validFiles++;
      } else {
        results.invalidFiles++;
      }

      results.totalErrors += result.errors.length;
      results.totalWarnings += result.warnings.length;
      results.details.push(result);
    });

    return results;
  }
}

describe("GherkinValidator", () => {
  let validator: GherkinValidator;

  beforeEach(() => {
    jest.clearAllMocks();
    validator = new GherkinValidator();
  });

  describe("validateFeatureContent", () => {
    it("should validate valid Gherkin content", async () => {
      const validContent = `Feature: Test Feature
  As a user
  I want to test something
  So that I can verify it works

  Scenario: Test scenario
    Given I have a test
    When I run it
    Then it should pass`;

      const mockFeature = {
        name: "Test Feature",
        description:
          "As a user\nI want to test something\nSo that I can verify it works",
        tags: [],
        children: [
          {
            scenario: {
              name: "Test scenario",
              tags: [],
              steps: [
                { keyword: "Given", text: "I have a test" },
                { keyword: "When", text: "I run it" },
                { keyword: "Then", text: "it should pass" },
              ],
            },
          },
        ],
        language: "en",
      };

      mockGherkin.makeSourceEnvelope.mockReturnValue({
        source: {
          data: validContent,
          uri: "test.feature",
          mediaType: "text/x.cucumber.gherkin+plain",
        },
      });

      mockGherkin.generateMessages.mockReturnValue([
        { gherkinDocument: { feature: mockFeature } },
      ]);

      const result = await validator.validateFeatureContent(
        validContent,
        "test.feature"
      );

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.metadata.name).toBe("Test Feature");
      expect(result.metadata.scenarios).toHaveLength(1);
    });

    it("should handle Gherkin parse errors", async () => {
      const invalidContent = "Invalid Gherkin content";

      mockGherkin.makeSourceEnvelope.mockReturnValue({
        source: {
          data: invalidContent,
          uri: "test.feature",
          mediaType: "text/x.cucumber.gherkin+plain",
        },
      });

      mockGherkin.generateMessages.mockImplementation(() => {
        throw new Error("Parse error: Invalid syntax");
      });

      await expect(
        validator.validateFeatureContent(invalidContent, "test.feature")
      ).rejects.toThrow(GherkinParseError);
    });

    it("should detect missing feature", async () => {
      mockGherkin.makeSourceEnvelope.mockReturnValue({
        source: {
          data: "",
          uri: "test.feature",
          mediaType: "text/x.cucumber.gherkin+plain",
        },
      });

      mockGherkin.generateMessages.mockReturnValue([]);

      const result = await validator.validateFeatureContent("", "test.feature");

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("No valid feature found in file");
    });
  });

  describe("extractFeatureDataFromAST", () => {
    it("should extract feature metadata correctly", () => {
      const feature = {
        name: "Test Feature",
        description: "Feature description",
        tags: [{ name: "@tag1" }, { name: "@tag2" }],
        children: [
          {
            scenario: {
              name: "Scenario 1",
              tags: [{ name: "@scenario-tag" }],
              steps: [
                { keyword: "Given", text: "step 1" },
                { keyword: "When", text: "step 2" },
              ],
            },
          },
        ],
        language: "en",
      };

      const metadata = validator.extractFeatureDataFromAST(feature);

      expect(metadata.name).toBe("Test Feature");
      expect(metadata.description).toBe("Feature description");
      expect(metadata.tags).toEqual(["@tag1", "@tag2"]);
      expect(metadata.scenarios).toHaveLength(1);
      expect(metadata.scenarios[0].name).toBe("Scenario 1");
      expect(metadata.scenarios[0].tags).toEqual(["@scenario-tag"]);
      expect(metadata.scenarios[0].steps).toBe(2);
    });

    it("should handle rules with scenarios", () => {
      const feature = {
        name: "Test Feature",
        children: [
          {
            rule: {
              name: "Test Rule",
              children: [
                {
                  scenario: {
                    name: "Rule Scenario",
                    tags: [],
                    steps: [{ keyword: "Given", text: "step" }],
                  },
                },
              ],
            },
          },
        ],
      };

      const metadata = validator.extractFeatureDataFromAST(feature);

      expect(metadata.scenarios).toHaveLength(1);
      expect(metadata.scenarios[0].name).toBe("Rule Scenario");
      expect(metadata.scenarios[0].rule).toBe("Test Rule");
    });
  });

  describe("validateFeatureStructure", () => {
    it("should validate feature structure and add warnings", () => {
      const feature = {
        name: "",
        children: [
          {
            scenario: {
              name: "",
              steps: [],
            },
          },
        ],
      };

      const result = { isValid: true, errors: [], warnings: [] };
      validator.validateFeatureStructure(feature, result);

      expect(result.warnings).toContain(
        "Feature should have a descriptive name"
      );
      expect(result.warnings).toContain("Scenario 1 has no steps");
      expect(result.warnings).toContain(
        "Scenario 1 should have a descriptive name"
      );
    });

    it("should add error for feature without scenarios", () => {
      const feature = {
        name: "Test Feature",
        children: [],
      };

      const result = { isValid: true, errors: [], warnings: [] };
      validator.validateFeatureStructure(feature, result);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Feature must contain at least one scenario"
      );
    });
  });

  describe("processMultipleFiles", () => {
    it("should process multiple files and return results", async () => {
      // Mock fs.readFile
      const mockReadFile = jest
        .fn()
        .mockResolvedValueOnce("Feature: Test 1\nScenario: Test")
        .mockResolvedValueOnce("Feature: Test 2\nScenario: Test");

      // Mock the dynamic import
      jest.doMock("fs/promises", () => ({ readFile: mockReadFile }));

      mockGherkin.makeSourceEnvelope.mockReturnValue({
        source: {
          data: "content",
          uri: "test.feature",
          mediaType: "text/x.cucumber.gherkin+plain",
        },
      });

      mockGherkin.generateMessages.mockReturnValue([
        {
          gherkinDocument: {
            feature: {
              name: "Test",
              children: [{ scenario: { steps: [{}] } }],
            },
          },
        },
      ]);

      const results = await validator.processMultipleFiles([
        "file1.feature",
        "file2.feature",
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].filePath).toBe("file1.feature");
      expect(results[1].filePath).toBe("file2.feature");
    });
  });
});
