# BDD Scenarios for Obsidian Gantt Plugin

This directory contains comprehensive Behavior-Driven Development (BDD) scenarios that serve as the
**official requirements** for the Obsidian Gantt plugin. These scenarios follow the BDD best
practices defined in `.augment/rules/BDD.md` and `project/BDD-Best-Practices.md`.

## 🔄 **Automated Sync with AssertThat**

This directory is automatically synchronized with AssertThat BDD plugin in Jira:

- **Scheduled Sync**: Daily at 2 AM UTC
- **Manual Sync**: Via GitHub Actions workflow dispatch
- **Bidirectional**: Changes flow both ways (GitHub ↔ AssertThat)
- **PR-based**: All syncs create pull requests for review

**Quick Start**: See [docs/QUICKSTART-SYNC.md](../docs/QUICKSTART-SYNC.md) for setup instructions.

## 📋 **Scenario Overview**

### **Gantt Visualization** (`gantt-visualization/`)

- **task-rendering.feature** (10 scenarios)
  - Basic task display with dates
  - Missing date handling and inference
  - Task type rendering (task, summary, milestone)
  - Progress visualization
  - Empty state and error handling

- **column-management.feature** (10 scenarios)
  - Default and custom column configuration
  - Bases property selection and mapping
  - Data type formatting (text, date, number, boolean, array, link)
  - Column widths and ordering
  - Dynamic property detection

- **responsive-design.feature** (14 scenarios)
  - Mobile touch interactions and gestures
  - Adaptive layouts for different screen sizes
  - Orientation changes and accessibility
  - Dark mode and theme adaptation

- **performance.feature** (16 scenarios)
  - Large dataset handling (1000+ tasks)
  - Virtual scrolling and memory management
  - Svelte reactivity optimization
  - Mobile performance constraints

### **Bases Integration** (`bases-integration/`)

- **data-mapping.feature** (12 scenarios)
  - Basic property mapping to Gantt data
  - Custom field mappings and file properties
  - Hierarchical and multi-parent relationships
  - Date format handling and real-time sync
  - Configuration validation

- **view-registration.feature** (12 scenarios)
  - Plugin loading and Bases registration
  - View lifecycle management
  - Configuration reading and error handling
  - Debug support and cleanup

### **Task Management** (`task-management/`)

- **virtual-task-handling.feature** (10 scenarios)
  - Multi-parent task virtual duplicates
  - Unique ID generation and data consistency
  - Single parent and orphan task handling
  - Performance and hierarchy display

- **task-editing.feature** (14 scenarios)
  - Task selection and editor opening
  - Property editing and validation
  - Drag-and-drop interactions
  - Keyboard navigation and accessibility
  - Bulk editing and undo/redo

### **Data Sources** (`data-sources/`)

- **data-transformation.feature** (12 scenarios)
  - Field mapping and date conversion
  - Missing data inference and validation
  - Property preservation and type mapping
  - Error handling and performance optimization

### **User Experience** (`user-experience/`)

- **error-handling.feature** (15 scenarios)
  - Configuration and data loading errors
  - Plugin dependency and compatibility issues
  - File system and permission handling
  - Graceful degradation and recovery

## 🎯 **Total Coverage**

- **9 Feature Files**
- **125 BDD Scenarios**
- **Complete functional coverage** of implemented and planned features

## 📝 **BDD Principles Applied**

### **Domain Language**

- Scenarios written from user perspective
- Business-focused language avoiding technical implementation details
- Clear Given-When-Then structure

### **Behavior Focus**

- Each scenario tests one specific behavior
- Concrete examples with realistic data
- Edge cases and error conditions covered

### **Tag Organization**

- `@critical` - Essential functionality
- `@smoke` - Basic functionality verification
- `@performance` - Performance-related scenarios
- `@mobile` - Mobile-specific features
- `@bases-integration` - Bases plugin integration
- `@task-management` - Task manipulation features
- `@gantt-visualization` - Visual display features
- `@data-transformation` - Data processing features
- `@error-handling` - Error scenarios

## 🚀 **Usage as Requirements**

These BDD scenarios serve as:

1. **Official Requirements**: Complete specification of plugin behavior
2. **Acceptance Criteria**: Definition of "done" for each feature
3. **Test Specifications**: Executable tests for validation
4. **Living Documentation**: Always up-to-date behavior description
5. **Development Guide**: Clear implementation targets

## 🔧 **Implementation Notes**

### **Step Definitions Required**

Based on these scenarios, you'll need step definitions for:

- Vault and note setup
- Gantt view operations
- Task interactions
- Data validation
- Error condition simulation
- Performance measurement

### **Test Data Requirements**

- Sample vaults with various note structures
- Bases configuration examples
- Large datasets for performance testing
- Corrupted data for error testing

### **Integration Points**

- Obsidian API integration
- Bases plugin integration
- SVAR Svelte Gantt component
- File system operations
- Touch and mobile interactions

## 📋 **Next Steps**

1. **Review Scenarios**: Validate completeness against PRD requirements
2. **Implement Step Definitions**: Create executable test implementations
3. **Set Up Test Infrastructure**: Configure WebdriverIO + Cucumber
4. **Create Test Data**: Build vault fixtures and test datasets
5. **Run BDD Tests**: Execute scenarios to drive development

These scenarios provide a complete blueprint for implementing the Obsidian Gantt plugin with
confidence that all requirements are captured and testable.
