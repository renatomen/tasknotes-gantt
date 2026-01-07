/**
 * Tests for FeatureMetadataManager
 * Validates AssertThat ID tracking in feature files
 */

import { FeatureMetadataManager } from '../../scripts/metadata/FeatureMetadataManager.mjs';

describe('FeatureMetadataManager', () => {
  let manager: FeatureMetadataManager;

  beforeEach(() => {
    manager = new FeatureMetadataManager();
  });

  describe('extractMetadata', () => {
    it('should extract feature ID from comments', () => {
      const content = `# @assertthat-feature-id: feature-123
Feature: Test Feature
  Scenario: Test Scenario
    Given a precondition`;

      const metadata = manager.extractMetadata(content);
      
      expect(metadata.featureId).toBe('feature-123');
    });

    it('should extract scenario IDs from comments', () => {
      const content = `Feature: Test Feature
  # @assertthat-scenario-id: scenario-abc
  Scenario: First Scenario
    Given a precondition
  
  # @assertthat-scenario-id: scenario-xyz
  Scenario: Second Scenario
    Given another precondition`;

      const metadata = manager.extractMetadata(content);
      
      expect(metadata.scenarioIds.get('First Scenario')).toBe('scenario-abc');
      expect(metadata.scenarioIds.get('Second Scenario')).toBe('scenario-xyz');
    });

    it('should handle scenarios with tags', () => {
      const content = `Feature: Test Feature
  # @assertthat-scenario-id: scenario-123
  @smoke @automated
  Scenario: Tagged Scenario
    Given a precondition`;

      const metadata = manager.extractMetadata(content);
      
      expect(metadata.scenarioIds.get('Tagged Scenario')).toBe('scenario-123');
    });

    it('should return empty metadata for file without IDs', () => {
      const content = `Feature: Test Feature
  Scenario: Test Scenario
    Given a precondition`;

      const metadata = manager.extractMetadata(content);
      
      expect(metadata.featureId).toBeNull();
      expect(metadata.scenarioIds.size).toBe(0);
    });
  });

  describe('updateMetadata', () => {
    it('should add feature ID before Feature declaration', () => {
      const content = `Feature: Test Feature
  Scenario: Test Scenario
    Given a precondition`;

      const metadata = {
        featureId: 'feature-123',
        scenarioIds: new Map(),
      };

      const updated = manager.updateMetadata(content, metadata);
      
      expect(updated).toContain('# @assertthat-feature-id: feature-123');
      expect(updated).toContain('Feature: Test Feature');
    });

    it('should add scenario IDs before Scenario declarations', () => {
      const content = `Feature: Test Feature
  Scenario: First Scenario
    Given a precondition
  
  Scenario: Second Scenario
    Given another precondition`;

      const metadata = {
        featureId: null,
        scenarioIds: new Map([
          ['First Scenario', 'scenario-abc'],
          ['Second Scenario', 'scenario-xyz'],
        ]),
      };

      const updated = manager.updateMetadata(content, metadata);
      
      expect(updated).toContain('# @assertthat-scenario-id: scenario-abc');
      expect(updated).toContain('Scenario: First Scenario');
      expect(updated).toContain('# @assertthat-scenario-id: scenario-xyz');
      expect(updated).toContain('Scenario: Second Scenario');
    });

    it('should preserve indentation for scenario IDs', () => {
      const content = `Feature: Test Feature
  Scenario: Indented Scenario
    Given a precondition`;

      const metadata = {
        featureId: null,
        scenarioIds: new Map([['Indented Scenario', 'scenario-123']]),
      };

      const updated = manager.updateMetadata(content, metadata);
      
      expect(updated).toContain('  # @assertthat-scenario-id: scenario-123');
      expect(updated).toContain('  Scenario: Indented Scenario');
    });

    it('should update existing metadata', () => {
      const content = `# @assertthat-feature-id: old-feature-id
Feature: Test Feature
  # @assertthat-scenario-id: old-scenario-id
  Scenario: Test Scenario
    Given a precondition`;

      const metadata = {
        featureId: 'new-feature-id',
        scenarioIds: new Map([['Test Scenario', 'new-scenario-id']]),
      };

      const updated = manager.updateMetadata(content, metadata);
      
      expect(updated).toContain('# @assertthat-feature-id: new-feature-id');
      expect(updated).not.toContain('old-feature-id');
      expect(updated).toContain('# @assertthat-scenario-id: new-scenario-id');
      expect(updated).not.toContain('old-scenario-id');
    });
  });

  describe('extractFromApiResponse', () => {
    it('should extract scenario IDs from AssertThat API response', () => {
      const apiResponse = {
        scenarios: [
          {
            id: '0e35e68f664b0a2aec4cd33289a19889',
            name: 'Basic task creation and rendering',
            feature: 'BDD Framework Validation',
            mode: 'automated',
            steps: 'Given a task...',
            created_at: '2025-10-02T08:11:11',
            updated_at: '2025-10-03T00:51:58',
            issues: [],
            tags: ['imported-from-github'],
          },
          {
            id: 'abc123def456',
            name: 'Multiple tasks rendering',
            feature: 'BDD Framework Validation',
            mode: 'automated',
            steps: 'Given multiple tasks...',
            created_at: '2025-10-02T08:11:11',
            updated_at: '2025-10-03T00:51:58',
            issues: [],
            tags: ['automated'],
          },
        ],
      };

      const metadataByFeature = manager.extractFromApiResponse(apiResponse);

      // Should return a Map with feature name as key
      expect(metadataByFeature).toBeInstanceOf(Map);
      expect(metadataByFeature.size).toBe(1);
      expect(metadataByFeature.has('BDD Framework Validation')).toBe(true);

      // Get metadata for the feature
      const metadata = metadataByFeature.get('BDD Framework Validation');
      expect(metadata.featureId).toBe('BDD Framework Validation');
      expect(metadata.scenarioIds.get('Basic task creation and rendering')).toBe('0e35e68f664b0a2aec4cd33289a19889');
      expect(metadata.scenarioIds.get('Multiple tasks rendering')).toBe('abc123def456');
    });

    it('should handle empty API response', () => {
      const apiResponse = { scenarios: [] };

      const metadataByFeature = manager.extractFromApiResponse(apiResponse);

      // Should return an empty Map
      expect(metadataByFeature).toBeInstanceOf(Map);
      expect(metadataByFeature.size).toBe(0);
    });
  });

  describe('createScenarioMapping', () => {
    it('should map GitHub scenarios to AssertThat scenarios by ID', () => {
      const githubFeatures = [
        {
          path: 'test.feature',
          content: `# @assertthat-feature-id: BDD Framework Validation
Feature: BDD Framework Validation
  # @assertthat-scenario-id: 0e35e68f664b0a2aec4cd33289a19889
  Scenario: Basic task creation and rendering
    Given a task with title "Sample Task 9"`,
        },
      ];

      const assertThatScenarios = [
        {
          id: '0e35e68f664b0a2aec4cd33289a19889',
          name: 'Basic task creation and rendering',
          feature: 'BDD Framework Validation',
          steps: 'Given a task with title "Sample Task 9"',
        },
      ];

      const mapping = manager.createScenarioMapping(githubFeatures, assertThatScenarios);
      
      expect(mapping.size).toBe(1);
      expect(mapping.has('0e35e68f664b0a2aec4cd33289a19889')).toBe(true);
      
      const pair = mapping.get('0e35e68f664b0a2aec4cd33289a19889');
      expect(pair.github).toBeDefined();
      expect(pair.github.scenarioName).toBe('Basic task creation and rendering');
      expect(pair.assertThat).toBeDefined();
      expect(pair.assertThat.id).toBe('0e35e68f664b0a2aec4cd33289a19889');
    });

    it('should identify new scenarios from AssertThat (not in GitHub)', () => {
      const githubFeatures = [];
      
      const assertThatScenarios = [
        {
          id: 'new-scenario-123',
          name: 'New Scenario',
          feature: 'Test Feature',
          steps: 'Given something new',
        },
      ];

      const mapping = manager.createScenarioMapping(githubFeatures, assertThatScenarios);
      
      expect(mapping.size).toBe(1);
      const pair = mapping.get('new-scenario-123');
      expect(pair.github).toBeNull();
      expect(pair.assertThat).toBeDefined();
    });

    it('should handle scenario name changes (ID remains same)', () => {
      const githubFeatures = [
        {
          path: 'test.feature',
          content: `Feature: Test Feature
  # @assertthat-scenario-id: scenario-123
  Scenario: Old Scenario Name
    Given a precondition`,
        },
      ];

      const assertThatScenarios = [
        {
          id: 'scenario-123',
          name: 'New Scenario Name',  // Name changed in AssertThat
          feature: 'Test Feature',
          steps: 'Given a precondition',
        },
      ];

      const mapping = manager.createScenarioMapping(githubFeatures, assertThatScenarios);
      
      expect(mapping.size).toBe(1);
      const pair = mapping.get('scenario-123');
      expect(pair.github.scenarioName).toBe('Old Scenario Name');
      expect(pair.assertThat.name).toBe('New Scenario Name');
    });
  });
});

