# Product Requirements Document (PRD)

**Product**: obsidian-gantt — Modern Svelte 5 Gantt chart visualization using SVAR Svelte Gantt
**Owner**: Open Source Community **Status**: Active Development **Architecture**: Event-Driven
Svelte 5 Components with Reactive State Management

## 1. Vision & Strategic Goals

### Primary Objective

Create a cutting-edge, Svelte 5-based Gantt chart plugin that leverages SVAR Svelte Gantt's latest
features and reactive architecture to deliver exceptional performance, user experience, and
developer productivity in Obsidian environments.

### Core Value Propositions

- **Modern Svelte 5 Architecture**: Leverages runes ($state, $derived, $props) for optimal
  reactivity and performance
- **Multi-Datasource Excellence**: Seamless support for Bases, Dataview (DQL/JS), and extensible
  data sources
- **Reactive State Management**: Real-time data synchronization with Svelte's compile-time
  optimizations
- **Component-First Design**: Modular, reusable Svelte components with clear separation of concerns
- **Performance Excellence**: Sub-second rendering with virtual scrolling and intelligent caching
- **Mobile-First Experience**: Touch-optimized interactions with responsive design patterns
- **Developer Experience**: TypeScript-first with comprehensive testing and intuitive APIs
- **Offline-First Architecture**: Zero external dependencies with complete vault-contained
  functionality

### Non-Goals (Explicit Scope Boundaries)

- Legacy browser support (targets modern evergreen browsers)
- Real-time collaborative editing (future consideration)
- External server dependencies or internet connectivity requirements
- Backward compatibility with legacy implementations

## 2. Technical Architecture Overview

### Svelte 5 Component Hierarchy

```
ObsidianGanttPlugin
├── DataSourceRegistry (reactive data providers)
│   ├── BasesDataSource (Obsidian Bases integration)
│   ├── DataviewDataSource (DQL/JS integration)
│   └── ExtensibleDataSource (plugin ecosystem)
├── ViewRegistry (Svelte rendering contexts)
│   ├── BasesViewRenderer (custom Bases view)
│   └── CodeBlockRenderer (markdown code block injection)
├── GanttViewFactory (Svelte component factory)
└── ReactiveEventBus (Svelte stores + custom events)
    ├── GanttContainer.svelte (root component - reusable)
    │   ├── GanttComponent.svelte (SVAR wrapper - reusable)
    │   │   ├── <Gantt /> (SVAR Svelte 5 component)
    │   │   └── GanttToolbar.svelte (controls - reusable)
    │   ├── ErrorBoundary.svelte (Svelte error handling)
    │   └── LoadingState.svelte (async data handling)
    └── DataPipeline (reactive data transformation)
        ├── DataSourceAdapter (interface)
        ├── DataMapper (Any Source → SVAR format)
        ├── VirtualTaskManager (reactive task handling)
        └── ValidationEngine (schema validation)
```

### Reactive Data Flow (Svelte 5 Runes)

```
Data Source → $state → $derived → Svelte Components → SVAR Rendering
     ↓           ↓        ↓            ↓               ↓
Configuration → Reactive → Computed → Component → Gantt Display
                State      Props      Updates
```

### Multi-Datasource Architecture

```
DataSource Interface
├── BasesDataSource
│   ├── Reactive Bases API integration
│   ├── Real-time property updates
│   └── Custom Bases view type registration
├── DataviewDataSource
│   ├── DQL query execution with reactivity
│   ├── DataviewJS with Svelte integration
│   └── Code block processor registration
└── Future DataSources
    ├── TasksPlugin reactive integration
    ├── JSON/CSV import with validation
    └── External API connectors with caching
```

## 3. Core Technical Capabilities

### Svelte 5 Reactive Architecture

- **Runes-Based Reactivity**: Leverage $state, $derived, and $props for optimal performance
- **Compile-Time Optimization**: Svelte's compiler eliminates runtime overhead
- **Fine-Grained Updates**: Surgical DOM updates with minimal re-rendering
- **Memory Efficiency**: Automatic cleanup and garbage collection

### Offline-First Design

- **Zero External Dependencies**: All processing happens locally within Obsidian
- **Bundled SVAR Assets**: Complete SVAR Svelte Gantt packaged with plugin
- **Local Data Sources**: Bases, TaskNotes, and Dataview integration without network calls
- **Vault-Contained Operations**: All data remains within user's Obsidian vault
- **CSP Compliance**: No external resource loading, full Content Security Policy compliance

### Multi-Instance Excellence

- **Svelte Component Isolation**: Each view creates independent Svelte component tree
- **Reactive State Encapsulation**: Instance-specific $state with no global pollution
- **Event Namespace**: Unique identifiers for instance-specific event handling
- **Memory Management**: Automatic Svelte cleanup with proper lifecycle management

### SVAR Svelte 5 Integration Patterns

- **Reactive Props**: $props() drive SVAR component configuration
- **Derived State**: $derived() for computed properties and data transformations
- **Event Handling**: Native Svelte event system integrated with SVAR actions
- **Dynamic Loading**: Lazy component loading with Svelte's dynamic imports
- **Performance Optimization**: Leverage Svelte's built-in performance features

### Cross-Platform Mobile Excellence

- **Responsive Design**: Adaptive layout using CSS Grid and Flexbox
- **Touch-First Interaction**: Native touch support with gesture recognition
- **Multi-Input Support**: Mouse, touch, and pen input for all interactions
- **Mobile-Optimized UI**: 44px+ touch targets and accessible interactions
- **Performance Scaling**: Adaptive complexity based on device capabilities
- **Hardware Acceleration**: GPU-accelerated animations and transitions

### Intelligent Field Mapping System

- **Runtime Configuration**: Dynamic field mappings via configuration objects
- **User-Defined Properties**: Complete freedom in Obsidian property naming
- **Minimal Requirements**: Only `id` and `text` mandatory; everything else optional
- **Type-Safe Mapping**: TypeScript interfaces ensure mapping correctness
- **Property Agnostic**: Zero assumptions about property names or sources
- **Validation Engine**: Comprehensive validation with helpful error messages

### Advanced Data Modeling

- **Virtual Task Management**: Elegant handling of multi-parent task relationships
- **Obsidian ID Preservation**: Maintain original note references across virtual instances
- **Hierarchical Flexibility**: Support complex parent-child relationships
- **Reactive Data Integrity**: Real-time synchronization using Svelte stores
- **Dynamic Column Generation**: Automatic column creation from Bases property selection
- **Schema Evolution**: Graceful handling of changing data structures

### Reactive Data Transformation Pipeline

```typescript
interface ReactiveDataPipeline {
  source: DataSourceAdapter; // Reactive data source
  mapper: DataMapper<any, SVARTask>; // Type-safe data mapping
  validator: ValidationEngine; // Schema validation
  transformer: SVARDataTransformer; // SVAR format conversion
  virtualizer: VirtualTaskManager; // Virtual task handling
  reactiveState: SvelteStore<any>; // Svelte store integration
}

interface DataSourceAdapter {
  readonly type: "bases" | "dataview" | "custom";
  readonly renderContext: "bases-view" | "code-block" | "custom";

  initialize(): Promise<void>;
  queryData(config: any): Promise<any[]>;
  validateConfig(config: any): ValidationResult;
  createReactiveStore(): SvelteStore<any[]>;
  dispose(): void;
}
```

## 4. Configuration Schema (SVAR Svelte 5 Optimized)

### Bases YAML Configuration

```yaml
views:
  - type: obsidianGantt
    name: Project Timeline
    order:
      - assignee
      - file.folder
      - file.name
      - status
      - start
      - due
      - priority
    sort: []
    columnSize:
      file.name: 94
      file.folder: 90
      note.status: 160
      note.start: 142
      note.due: 150
      note.priority: 123
      note.assignee: 90
    obsidianGantt:
      # Svelte 5 reactive configuration
      reactiveUpdates: true

      # Table width for Bases view
      tableWidth: 400

      # View mode configuration
      viewMode: Day # Day | Week | Month | Year

      # Field Mappings (User-Defined → Gantt Parameters)
      fieldMappings:
        # Mandatory fields
        id: file.path # Unique identifier (required)
        text: file.basename # Display name (required)

        # Optional date/duration fields
        start: start # Start date property
        end: due # End date property
        duration: duration # Duration in days
        base_start: baseline_start # Baseline start date
        base_end: baseline_end # Baseline end date
        base_duration: baseline_duration # Baseline duration

        # Optional metadata fields
        progress: progress # Progress 0-1 or 0-100
        parent: parent # Single parent ID
        parents: in # Multiple parents support
        type: taskType # "task" | "summary" | "milestone"

      # SVAR Svelte 5 specific configuration
      svarConfig:
        theme: "willow" # SVAR theme selection
        locale: "en" # Internationalization
        animations: true # Enable smooth animations
        virtualScrolling: true # Performance optimization

      # Display configuration
      show_today_marker: false
      hide_task_names: false
      showMissingDates: true
      missingStartBehavior: infer # infer | show | hide
      missingEndBehavior: show # show | infer | hide
      defaultDuration: 5 # in days, when inferring end from start
      showMissingDateIndicators: true

      # Dynamic column configuration (Bases integration)
      # Columns automatically generated from Bases property selection
      # Supports all Obsidian frontmatter properties:
      # https://help.obsidian.md/bases/syntax#Properties
```

### Dataview Code Block Configuration (Future)

```obsidian-gantt
{
  "query": "TABLE file.name, start, due, progress FROM #project WHERE start",
  "fieldMappings": {
    "id": "file.path",        # Required: unique identifier
    "text": "file.name",      # Required: display name
    "start": "start",         # Optional: user's start date property
    "end": "due",             # Optional: user's end date property
    "progress": "progress",   # Optional: user's progress property
    "parent": "parentTask"    # Optional: user's parent property
  },
  "viewMode": "Week",
  "show_today_marker": true,
  "tableWidth": 300
}
```

### DataviewJS Code Block Configuration (Future)

```obsidian-gantt-js
const tasks = dv.pages("#project")
  .where(p => p.start)
  .map(p => ({
    // User can structure data however they want
    taskId: p.file.path,      # Will map to 'id'
    taskName: p.file.name,    # Will map to 'text'
    startDate: p.start,       # Will map to 'start'
    endDate: p.due,           # Will map to 'end'
    completion: p.progress || 0, # Will map to 'progress'
    parentTask: p.parent      # Will map to 'parent'
  }));

return {
  data: tasks,
  config: {
    viewMode: "Month",
    show_today_marker: true,
    fieldMappings: {
      id: "taskId",           # Maps user's 'taskId' to required 'id'
      text: "taskName",       # Maps user's 'taskName' to required 'text'
      start: "startDate",     # Maps user's 'startDate' to optional 'start'
      end: "endDate",         # Maps user's 'endDate' to optional 'end'
      progress: "completion", # Maps user's 'completion' to optional 'progress'
      parent: "parentTask"    # Maps user's 'parentTask' to optional 'parent'
    }
  }
};
```

      # UI Configuration
      ui:
        readonly: true  # MVP: read-only mode
        showToday: true
        responsive: true
        mobileOptimized: true
        gridColumns:
          - id: "text"
            header: "Task"
            flexGrow: 2
            resizable: true
          - id: "start"
            header: "Start"
            width: 100
            resizable: true
          - id: "duration"
            header: "Duration"
            width: 80
            resizable: true

        # Multi-input column resizing
        columnResizing:
          enabled: true
          inputs: ["mouse", "touch", "pen"]
          minWidth: 50
          maxWidth: 500
          touchTargetSize: 44  # Minimum 44px for accessibility
          snapToGrid: false
          persistWidths: true

````

## 5. Implementation Phases

### Phase 1: Svelte 5 Foundation & SVAR Integration (Week 1-2)
**Deliverables:**
- SVAR Svelte Gantt (@svar-ui/svelte-gantt) installation and setup
- Vite build configuration following Obsidian best practices
- Svelte 5 component architecture with runes ($state, $derived, $props)
- Proper Obsidian externals configuration (obsidian, electron, @codemirror/*)
- Mobile-responsive container with touch event handling
- Multi-input interaction support (mouse, touch, pen)
- Basic Obsidian view registration with Svelte mounting
- Error boundary and loading states in Svelte
- Source mapping configuration for debugging

**Acceptance Criteria:**
- SVAR Svelte Gantt renders perfectly in Obsidian on all platforms
- Vite build properly excludes Obsidian APIs from bundle
- Svelte 5 runes provide reactive state management
- Touch interactions work smoothly on mobile devices
- Multi-input support for all interaction types
- No console errors, memory leaks, or CSP violations
- Component lifecycle properly managed with Svelte cleanup
- Source maps work correctly for debugging in Obsidian
- Bundle size optimized with proper externals configuration
- Basic task data displays correctly across all device types

### Phase 2: Bases Integration & Reactive Architecture (Week 3-4)
**Deliverables:**
- Bases view type registration (`obsidianGantt`)
- BasesDataSource with reactive Svelte stores
- Flexible field mapping system with TypeScript validation
- Dynamic column generation from Bases property selection
- Reusable Svelte components (GanttContainer, GanttComponent)
- Reactive data pipeline (Any Source → SVAR format)
- Virtual task management with Svelte reactivity
- Configuration validation with helpful error messages
- Multi-instance support with isolated state

**Acceptance Criteria:**
- Only `id` and `text` fields required; all others optional and user-configurable
- Field mappings work with any user property names via `fieldMappings` configuration
- Dynamic columns automatically generated from Bases property selection
- Multiple Gantt views render simultaneously with isolated reactive state
- Bases data transforms to SVAR format using flexible field mapping
- Virtual tasks created for items with multiple parents using reactive patterns
- All operations work completely offline with zero external dependencies
- Reusable Svelte components isolated from data source specifics
- Configuration errors show helpful messages with field mapping context
- Instance isolation verified through comprehensive testing

### Phase 3: Dataview Integration & Code Blocks (Week 5-6)
**Deliverables:**
- DataviewDataSource with reactive query execution
- Code block processor for `obsidian-gantt` and `obsidian-gantt-js`
- DQL query parsing with reactive updates
- DataviewJS support with Svelte integration
- Shared component reuse across data sources
- Performance optimization for large datasets

**Acceptance Criteria:**
- DQL queries render Gantt charts in notes via code blocks
- DataviewJS code blocks execute and render charts with Svelte reactivity
- Same GanttContainer/GanttComponent used across all data sources
- Performance comparable to Bases implementation
- Error handling for invalid queries/code with helpful messages
- Reactive updates when underlying data changes

### Phase 4: Performance Excellence & Polish (Week 7-8)
**Deliverables:**
- Advanced performance optimizations (virtual scrolling, lazy loading)
- Comprehensive error handling with recovery strategies
- Mobile-specific optimizations and touch improvements
- Accessibility enhancements (ARIA, keyboard navigation)
- Documentation and usage examples
- Testing suite with high coverage

**Acceptance Criteria:**
- Event system handles 1000+ tasks smoothly across all data sources
- Sub-second rendering performance on desktop and mobile
- Performance metrics meet all targets (see §9)
- Error recovery works for all failure scenarios
- Component reusability demonstrated across all data sources
- Accessibility standards met (WCAG 2.1 AA)
- Comprehensive documentation with examples

## 6. Data Model & Type Definitions

### Svelte 5 Reactive Field Mapping System
```typescript
interface FieldMappings {
  // Mandatory fields (must be provided)
  id: string;                     // User's unique identifier property
  text: string;                   // User's display name property

  // Optional date/duration fields
  start?: string;                 // User's start date property
  end?: string;                   // User's end date property
  duration?: string;              // User's duration property
  base_start?: string;            // User's baseline start property
  base_end?: string;              // User's baseline end property
  base_duration?: string;         // User's baseline duration property

  // Optional metadata fields
  progress?: string;              // User's progress property
  parent?: string;                // User's single parent property
  parents?: string;               // User's multiple parents property
  type?: string;                  // User's task type property
}

interface GanttConfig {
  fieldMappings: FieldMappings;
  viewMode: "Day" | "Week" | "Month" | "Year";
  tableWidth?: number;
  show_today_marker?: boolean;
  hide_task_names?: boolean;
  reactiveUpdates?: boolean;      // Enable Svelte reactivity
  svarConfig?: SVARConfig;        // SVAR-specific configuration
  // ... other display options
}

interface SVARConfig {
  theme: "willow" | "material" | "custom";
  locale: string;
  animations: boolean;
  virtualScrolling: boolean;
  performance: "high" | "balanced" | "memory";
}
````

### SVAR Svelte 5 Task Format (Internal)

```typescript
interface SVARTask {
  // Mapped from user's configured properties
  id: string | number; // From fieldMappings.id
  text: string; // From fieldMappings.text
  start?: Date; // From fieldMappings.start (converted to Date)
  end?: Date; // From fieldMappings.end (converted to Date)
  duration?: number; // From fieldMappings.duration or computed
  progress?: number; // From fieldMappings.progress (normalized to 0-1)
  parent?: string | number; // From fieldMappings.parent
  type?: "task" | "summary" | "milestone"; // From fieldMappings.type

  // SVAR Svelte 5 specific properties
  open?: boolean; // For summary tasks
  lazy?: boolean; // For dynamic loading
  reactive?: boolean; // Enable reactive updates

  // Extended properties from source data
  custom?: {
    obsidianId: string; // Original note identifier
    isVirtual?: boolean; // True for virtual duplicates
    virtualIndex?: number; // Index for multiple parents
    originalItem?: any; // Reference to source data
    reactiveStore?: any; // Svelte store reference
    [key: string]: any; // All other user properties (for columns)
  };
}

interface SVARLink {
  id: string | number;
  source: string | number;
  target: string | number;
  type: "e2s" | "s2s" | "e2e" | "s2e"; // SVAR semantic types
  reactive?: boolean; // Enable reactive updates
}

interface SVARColumn {
  id: string;
  header: string;
  width?: number;
  flexGrow?: number;
  align?: "left" | "center" | "right";
  resizable?: boolean;
  minWidth?: number;
  maxWidth?: number;
  template?: (task: SVARTask) => string;
  reactive?: boolean; // Enable reactive column updates
}

interface ColumnResizeConfig {
  enabled: boolean;
  inputs: ("mouse" | "touch" | "pen")[];
  minWidth: number;
  maxWidth: number;
  touchTargetSize: number;
  snapToGrid: boolean;
  persistWidths: boolean;
}
```

### Svelte 5 Data Source Architecture Types

```typescript
interface DataSourceAdapter {
  readonly type: "bases" | "dataview" | "custom";
  readonly renderContext: "bases-view" | "code-block" | "custom";

  initialize(): Promise<void>;
  queryData(config: GanttConfig): Promise<any[]>;
  validateConfig(config: GanttConfig): ValidationResult;
  mapToSVARFormat(rawData: any[], fieldMappings: FieldMappings): SVARTask[];
  createReactiveStore(): SvelteStore<any[]>;
  dispose(): void;
}

interface BasesDataSource extends DataSourceAdapter {
  type: "bases";
  renderContext: "bases-view";
  queryBasesData(basesConfig: BasesConfig): Promise<BasesItem[]>;
  getAvailableProperties(): Promise<string[]>; // For dynamic column generation
  generateColumnsFromProperties(selectedProps: string[]): SVARColumn[];
  createReactiveBasesStore(): SvelteStore<BasesItem[]>;
}

interface DataviewDataSource extends DataSourceAdapter {
  type: "dataview";
  renderContext: "code-block";
  executeDQL(query: string): Promise<any[]>;
  executeDataviewJS(code: string): Promise<{ data: any[]; config?: any }>;
  createReactiveQueryStore(query: string): SvelteStore<any[]>;
}

interface VirtualTaskManager {
  createVirtualDuplicates(items: any[]): SVARTask[];
  syncVirtualToOriginal(virtualTask: SVARTask): Promise<void>;
  getOriginalId(virtualTask: SVARTask): string;
  isVirtualTask(task: SVARTask): boolean;
  createReactiveVirtualStore(): SvelteStore<SVARTask[]>;
}

interface SvelteGanttRenderer {
  render(container: HTMLElement, config: GanttConfig): Promise<void>;
  update(data: { tasks: SVARTask[]; links: SVARLink[] }): void;
  createReactiveComponent(): SvelteComponent;
  dispose(): void;
}
```

### Svelte 5 Reactive Event System Types

```typescript
interface SvelteGanttEvent<T = any> {
  type: string;
  instanceId: string;
  data: T;
  timestamp: number;
  reactive: boolean;
}

interface SvelteCustomActions {
  "data-source-changed": { source: DataSourceAdapter; data: any[]; store: SvelteStore<any[]> };
  "gantt-config-changed": { config: GanttConfig; reactive: boolean };
  "validate-gantt-data": { task: SVARTask; store: SvelteStore<SVARTask> };
  "apply-data-filters": { filters: any[]; reactiveFilters: SvelteStore<any[]> };
  "sync-virtual-task": { virtualTask: SVARTask; originalId: string; store: SvelteStore<SVARTask> };
  "create-virtual-duplicates": {
    item: any;
    parents: string[];
    reactiveParents: SvelteStore<string[]>;
  };
  "code-block-render": { element: HTMLElement; config: any; component: SvelteComponent };
  "bases-view-render": {
    container: HTMLElement;
    basesConfig: BasesConfig;
    reactiveConfig: SvelteStore<BasesConfig>;
  };
}
```

## 7. Svelte 5 Reactive Data Provider Architecture

### SvelteObsidianDataProvider Implementation

The plugin implements a reactive data provider that leverages Svelte 5 stores and runes for optimal
performance and reactivity:

```typescript
class SvelteObsidianDataProvider {
  private tasksStore = $state<SVARTask[]>([]);
  private linksStore = $state<SVARLink[]>([]);

  constructor(
    private basesAdapter: BasesDataAdapter,
    private virtualTaskManager: VirtualTaskManager
  ) {}

  // Reactive data getter using Svelte 5 runes
  get data() {
    return $derived({
      tasks: this.tasksStore,
      links: this.linksStore,
    });
  }

  // Initialize reactive data loading
  async initialize(): Promise<void> {
    const basesData = await this.basesAdapter.queryData();
    const transformedData = this.transformToSVAR(basesData);
    const virtualData = this.virtualTaskManager.createVirtualDuplicates(transformedData);

    // Update reactive state
    this.tasksStore = virtualData.tasks;
    this.linksStore = virtualData.links;
  }

  // Handle SVAR actions with reactive updates
  async send(action: string, data: any): Promise<void> {
    if (this.isVirtualTask(data)) {
      await this.handleVirtualTaskAction(action, data);
    } else {
      await this.handleDirectAction(action, data);
    }

    // Trigger reactive updates
    await this.refreshReactiveData();
  }

  private async handleVirtualTaskAction(action: string, virtualTask: SVARTask): Promise<void> {
    const originalId = virtualTask.custom.obsidianId;
    const originalData = { ...virtualTask, id: originalId };

    switch (action) {
      case "update-task":
        await this.updateObsidianNote(originalData);
        await this.syncAllVirtualInstances(originalId);
        break;
      case "delete-task":
        await this.deleteObsidianNote(originalId);
        break;
    }
  }

  private async refreshReactiveData(): Promise<void> {
    // Reactive updates automatically trigger component re-renders
    const freshData = await this.basesAdapter.queryData();
    const transformedData = this.transformToSVAR(freshData);
    const virtualData = this.virtualTaskManager.createVirtualDuplicates(transformedData);

    this.tasksStore = virtualData.tasks;
    this.linksStore = virtualData.links;
  }
}
```

### Virtual Task Duplication Pattern

For tasks with multiple parents, the system creates virtual duplicates while preserving the original
Obsidian note reference:

```typescript
class VirtualTaskManager {
  createVirtualDuplicates(items: BasesItem[]): SVARTask[] {
    const tasks: SVARTask[] = [];

    for (const item of items) {
      const parents = this.extractParents(item);

      if (parents.length <= 1) {
        // Single or no parent - create normal task
        tasks.push(this.createTask(item, parents[0]));
      } else {
        // Multiple parents - create virtual duplicates
        parents.forEach((parent, index) => {
          tasks.push(this.createVirtualTask(item, parent, index));
        });
      }
    }

    return tasks;
  }

  private createVirtualTask(item: BasesItem, parent: string, index: number): SVARTask {
    return {
      id: `${item.id}_virtual_${index}`,
      text: item.title,
      start: new Date(item.startDate),
      duration: item.duration,
      progress: item.progress || 0,
      parent: parent,
      custom: {
        obsidianId: item.id,
        isVirtual: true,
        virtualIndex: index,
        originalItem: item,
      },
    };
  }

  async syncVirtualToOriginal(virtualTask: SVARTask): Promise<void> {
    const originalId = virtualTask.custom.obsidianId;
    const allVirtualInstances = await this.findVirtualInstances(originalId);

    // Update all virtual instances when one changes
    for (const instance of allVirtualInstances) {
      if (instance.id !== virtualTask.id) {
        await this.updateVirtualInstance(instance, virtualTask);
      }
    }
  }
}
```

### Benefits of This Approach

1. **SVAR Compatibility**: Each parent sees the task as a direct child
2. **Obsidian Integration**: All changes target the original note
3. **Data Consistency**: Virtual instances stay synchronized
4. **Performance**: Batch operations update multiple instances efficiently
5. **User Experience**: Tasks appear naturally in multiple hierarchies

## 8. Dynamic Column Generation (Bases Integration)

### Automatic Column Creation from Bases Properties

The plugin automatically generates Gantt tree columns based on properties selected in the Bases
interface, supporting all Obsidian frontmatter properties as defined in the
[Bases syntax documentation](https://help.obsidian.md/bases/syntax#Properties).

### Supported Property Types

```typescript
interface BasesPropertyTypes {
  // Core Obsidian properties
  "file.name": string;
  "file.path": string;
  "file.basename": string;
  "file.extension": string;
  "file.folder": string;
  "file.size": number;
  "file.ctime": Date;
  "file.mtime": Date;
  "file.tags": string[];
  "file.etags": string[];
  "file.inlinks": Link[];
  "file.outlinks": Link[];
  "file.aliases": string[];

  // Custom frontmatter properties
  [key: string]: any; // User-defined YAML frontmatter
}
```

### Dynamic Column Generation Process

```typescript
class BasesColumnGenerator {
  generateColumns(selectedProperties: string[]): SVARColumn[] {
    return selectedProperties.map((prop) => {
      const propertyType = this.getPropertyType(prop);
      return {
        id: prop,
        header: this.formatHeader(prop),
        width: this.getDefaultWidth(propertyType),
        resizable: true,
        align: this.getAlignment(propertyType),
        template: this.createTemplate(prop, propertyType),
      };
    });
  }

  private createTemplate(property: string, type: PropertyType): (task: SVARTask) => string {
    return (task: SVARTask) => {
      const value = this.getPropertyValue(task, property);
      return this.formatValue(value, type);
    };
  }

  private formatValue(value: any, type: PropertyType): string {
    switch (type) {
      case "date":
        return value ? new Date(value).toLocaleDateString() : "";
      case "number":
        return value?.toString() || "";
      case "array":
        return Array.isArray(value) ? value.join(", ") : "";
      case "boolean":
        return value ? "✓" : "";
      default:
        return value?.toString() || "";
    }
  }
}
```

### Integration with Bases UI

```typescript
interface BasesIntegration {
  // Listen to Bases property selection changes
  onPropertySelectionChanged(selectedProps: string[]): void;

  // Update Gantt columns dynamically
  updateGanttColumns(columns: SVARColumn[]): void;

  // Preserve column widths in Bases configuration
  saveColumnWidths(widths: Record<string, number>): void;
}

class BasesGanttView {
  private columnGenerator: BasesColumnGenerator;

  constructor() {
    this.columnGenerator = new BasesColumnGenerator();
    this.setupBasesPropertyListener();
  }

  private setupBasesPropertyListener(): void {
    // Listen to Bases UI property selection changes
    this.basesView.onPropertySelectionChanged((selectedProps) => {
      const columns = this.columnGenerator.generateColumns(selectedProps);
      this.ganttComponent.updateColumns(columns);
    });
  }
}
```

### Benefits of Dynamic Column Generation

1. **User Control**: Users select which properties to display via familiar Bases interface
2. **Automatic Updates**: Columns update immediately when property selection changes
3. **Type-Aware Formatting**: Different property types formatted appropriately
4. **Consistent UX**: Same property selection mechanism as other Bases views
5. **Extensible**: Supports all current and future Obsidian property types

## 9. Reusable Component Architecture

### Component Isolation Strategy

The plugin architecture ensures that core Gantt rendering components are completely isolated from
data source specifics, enabling seamless reuse across different contexts:

```typescript
// Core reusable components
interface GanttContainer {
  // Data source agnostic - accepts any SVAR-formatted data
  render(data: { tasks: SVARTask[]; links: SVARLink[] }): void;
  updateConfig(config: GanttDisplayConfig): void;
  dispose(): void;
}

interface GanttComponent {
  // Wraps SVAR Gantt with Obsidian-specific enhancements
  initialize(container: HTMLElement): void;
  setData(tasks: SVARTask[], links: SVARLink[]): void;
  getApi(): SVARGanttAPI;
}

// Data source specific adapters
interface BasesViewAdapter {
  // Handles Bases-specific rendering context
  createBasesView(basesConfig: BasesConfig): BasesView;
  registerViewType(): void;
}

interface CodeBlockAdapter {
  // Handles markdown code block rendering context
  processCodeBlock(source: string, element: HTMLElement): void;
  registerProcessor(): void;
}
```

### Shared Service Layer

```typescript
class GanttServiceRegistry {
  private static instance: GanttServiceRegistry;

  // Shared services used by all data sources
  getDataMapper(): DataMapper<any, SVARTask> {}
  getVirtualTaskManager(): VirtualTaskManager {}
  getValidationEngine(): ValidationEngine {}
  getEventBus(): EventBus {}

  // Factory for creating reusable components
  createGanttContainer(): GanttContainer {}
  createGanttComponent(): GanttComponent {}
}
```

### Benefits of This Architecture

1. **Single Implementation**: Core Gantt logic written once, used everywhere
2. **Consistent UX**: Identical behavior across Bases views and code blocks
3. **Maintainability**: Bug fixes and features automatically benefit all contexts
4. **Testability**: Core components can be tested independently of data sources
5. **Extensibility**: New data sources only need to implement the adapter interface

## 9. Mobile & Multi-Input Support

### Cross-Platform Compatibility

The plugin must provide a consistent, high-quality experience across all platforms where Obsidian
runs:

- **Desktop**: Windows, macOS, Linux with mouse and keyboard
- **Mobile**: iOS and Android with touch input
- **Tablets**: iPad, Android tablets with touch and pen input
- **Hybrid Devices**: Surface Pro, convertible laptops with multiple input methods

### Multi-Input Column Resizing Implementation

```typescript
interface ColumnResizerComponent {
  // Support all input types
  handleMouseDown(event: MouseEvent): void;
  handleTouchStart(event: TouchEvent): void;
  handlePointerDown(event: PointerEvent): void; // Unified for pen/touch/mouse

  // Responsive touch targets
  getTouchTargetSize(): number; // Minimum 44px for accessibility

  // Persistence
  saveColumnWidths(widths: Record<string, number>): void;
  loadColumnWidths(): Record<string, number>;
}

class MultiInputColumnResizer {
  private isDragging = false;
  private startX = 0;
  private startWidth = 0;
  private currentColumn: string | null = null;

  constructor(
    private config: ColumnResizeConfig,
    private onResize: (columnId: string, width: number) => void
  ) {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Use Pointer Events API for unified input handling
    document.addEventListener("pointerdown", this.handlePointerDown.bind(this));
    document.addEventListener("pointermove", this.handlePointerMove.bind(this));
    document.addEventListener("pointerup", this.handlePointerUp.bind(this));

    // Fallback for older browsers
    if (!window.PointerEvent) {
      this.setupLegacyEventListeners();
    }
  }

  private handlePointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (!target.classList.contains("column-resizer")) return;

    this.isDragging = true;
    this.startX = event.clientX;
    this.currentColumn = target.dataset.columnId!;
    this.startWidth = this.getCurrentColumnWidth(this.currentColumn);

    // Capture pointer for smooth dragging
    target.setPointerCapture(event.pointerId);

    // Prevent text selection during drag
    event.preventDefault();
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.isDragging || !this.currentColumn) return;

    const deltaX = event.clientX - this.startX;
    const newWidth = Math.max(
      this.config.minWidth,
      Math.min(this.config.maxWidth, this.startWidth + deltaX)
    );

    this.onResize(this.currentColumn, newWidth);

    // Throttle for performance
    requestAnimationFrame(() => {
      this.updateColumnWidth(this.currentColumn!, newWidth);
    });
  }

  private handlePointerUp(event: PointerEvent): void {
    if (!this.isDragging) return;

    this.isDragging = false;

    if (this.config.persistWidths && this.currentColumn) {
      this.saveColumnWidth(this.currentColumn, this.getCurrentColumnWidth(this.currentColumn));
    }

    this.currentColumn = null;
  }
}
```

### Mobile-Specific Optimizations

```typescript
interface MobileOptimizations {
  // Touch target sizing
  ensureMinimumTouchTargets(): void;

  // Performance scaling
  reduceComplexityOnMobile(): void;

  // Gesture handling
  handlePinchZoom(event: TouchEvent): void;
  handleTwoFingerScroll(event: TouchEvent): void;

  // Responsive layout
  adaptLayoutForScreenSize(width: number, height: number): void;
}

class MobileGanttAdapter {
  constructor(private ganttComponent: SVARGanttComponent) {}

  adaptForMobile(): void {
    // Reduce visual complexity
    this.simplifyScales();
    this.optimizeTouchTargets();
    this.enableHardwareAcceleration();

    // Adjust column defaults for mobile
    this.setMobileColumnDefaults();
  }

  private optimizeTouchTargets(): void {
    const style = document.createElement("style");
    style.textContent = `
      .gantt-mobile .column-resizer {
        width: 44px;
        height: 44px;
        touch-action: none;
        cursor: col-resize;
      }

      .gantt-mobile .task-bar {
        min-height: 32px;
        touch-action: pan-x pan-y;
      }

      @media (pointer: coarse) {
        .gantt-mobile .column-resizer {
          width: 48px;
          height: 48px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  private setMobileColumnDefaults(): void {
    // Wider columns on mobile for easier interaction
    const mobileColumnDefaults = {
      text: { minWidth: 120, flexGrow: 3 },
      start: { minWidth: 100, width: 120 },
      duration: { minWidth: 80, width: 100 },
    };

    this.ganttComponent.updateColumnDefaults(mobileColumnDefaults);
  }
}
```

### Accessibility & Touch Guidelines

- **Touch Target Size**: Minimum 44px (iOS) / 48dp (Android) for interactive elements
- **Pointer Events**: Use Pointer Events API for unified input handling
- **Hardware Acceleration**: Enable GPU acceleration for smooth interactions
- **Gesture Support**: Native pinch-zoom and two-finger scrolling
- **Focus Management**: Proper keyboard navigation support
- **Screen Reader**: ARIA labels and semantic markup

## 8. Performance Requirements

### Svelte 5 Performance Targets

- **Rendering**: 1000 tasks render in <1 second on desktop, <2 seconds on mobile (Svelte 5
  optimization)
- **Interaction**: Task selection response <50ms on desktop, <100ms on mobile (reactive updates)
- **Column Resizing**: Smooth 60fps dragging on all input types (mouse/touch/pen)
- **Touch Response**: Touch interactions respond within 8ms (120fps on modern devices)
- **Memory**: <30MB heap usage for 1000 tasks on desktop, <20MB on mobile (Svelte efficiency)
- **Bundle Size**: <500KB gzipped total bundle (Svelte compile-time optimization)
- **Mobile Compatibility**: Excellent performance on mid-range devices (2019+)
- **Cross-Platform**: Consistent 60fps experience across iOS, Android, Windows, macOS

### Svelte 5 Optimization Strategies

- **Compile-Time Optimization**: Svelte's compiler eliminates runtime overhead
- **Reactive Efficiency**: $derived() for computed properties with minimal recalculation
- **Virtual Scrolling**: Render only visible tasks with Svelte's reactive updates
- **Lazy Loading**: Dynamic component imports with Svelte's code splitting
- **Debouncing**: Batch reactive state changes for optimal performance
- **Memoization**: Cache expensive computations with $derived() memoization
- **Bundle Optimization**: Tree-shaking and dead code elimination with Vite
- **Obsidian Externals**: Proper externals configuration to exclude Obsidian APIs from bundle
- **Source Map Optimization**: Inline source maps for debugging without external files
- **Mobile Optimizations**: Adaptive rendering complexity based on device capabilities
- **Hardware Acceleration**: GPU-accelerated animations with CSS transforms
- **Memory Management**: Automatic cleanup with Svelte's lifecycle management

## 9. Testing Strategy

### Svelte 5 Test Architecture

```
Unit Tests (Vitest + Svelte Testing Library)
├── Svelte Component Tests (GanttContainer, GanttComponent)
├── Reactive State Tests ($state, $derived, $props)
├── Data Pipeline Tests (mappers, validators, stores)
├── Event System Tests (Svelte events + custom actions)
└── Integration Tests (SVAR + Obsidian APIs)

E2E Tests (Playwright)
├── Multi-Instance Scenarios with Svelte reactivity
├── Performance Benchmarks (Svelte vs other frameworks)
├── Mobile Touch Interaction Tests
└── Error Recovery and Reactive State Flows
```

### Test-Driven Development Process

1. **Red**: Write failing test for new feature
2. **Green**: Implement minimal code to pass test
3. **Refactor**: Optimize while maintaining test coverage
4. **Repeat**: Continue cycle for each feature increment

### Svelte 5 Mock Strategy

- **SVAR Svelte Components**: Mock for unit tests, real for integration
- **Obsidian APIs**: Comprehensive mocks for all plugin interactions
- **Svelte Testing Library**: Use for component testing with reactive state
- **Reactive Stores**: Mock Svelte stores for isolated testing
- **Event System**: Mock Svelte event dispatchers for isolated testing

## 10. Error Handling & Resilience

### Svelte 5 Error Classification

```typescript
class SvelteGanttError extends Error {
  constructor(
    message: string,
    public code: string,
    public instanceId: string,
    public recoverable: boolean,
    public reactiveContext?: any
  ) {
    super(message);
  }
}

// Specific error types
class ConfigurationError extends SvelteGanttError {}
class DataMappingError extends SvelteGanttError {}
class SvelteRenderingError extends SvelteGanttError {}
class ReactiveStateError extends SvelteGanttError {}
class EventSystemError extends SvelteGanttError {}
```

### Svelte 5 Recovery Strategies

- **Configuration Errors**: Show inline error with correction hints using reactive state
- **Data Errors**: Skip invalid items, show warning count with reactive updates
- **Rendering Errors**: Svelte Error Boundary with retry option and state recovery
- **Reactive State Errors**: Graceful fallback to previous valid state
- **Event Errors**: Graceful degradation with reactive error state

## 11. Security & Privacy

### Data Handling

- **Offline-First Design**: Zero external dependencies or network requirements
- **Local Processing**: All data processing happens locally within Obsidian
- **Bundled Assets**: SVAR Svelte components and dependencies packaged with plugin
- **Vault-Contained Data**: All operations work on local Obsidian vault data
- **Memory Safety**: Automatic Svelte cleanup prevents data leaks
- **Input Validation**: Sanitize all user-provided configuration with TypeScript validation
- **CSP Compliance**: No external resource loading, full Content Security Policy compliance

### Dependency Security

- **SVAR Svelte Gantt**: Latest vetted library with security updates
- **Svelte 5**: Latest stable version with security patches
- **TypeScript**: Latest stable with security fixes
- **Vite**: Modern build tool with security best practices
- **Build Tools**: Regularly updated development dependencies

## 11. Obsidian Svelte Plugin Best Practices

### Vite Configuration Standards

Following Obsidian community best practices for Svelte plugin development:

```typescript
export default defineConfig(({ mode }) => ({
  plugins: [
    svelte({ preprocess: vitePreprocess() }),
    // Additional plugins as needed
  ],
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "main.js",
        assetFileNames: "styles.css",
        sourcemapBaseUrl: pathToFileURL(
          `${__dirname}/test-vault/.obsidian/plugins/obsidian-gantt/`
        ).toString(),
      },
      external: [
        "obsidian",
        "electron",
        "@codemirror/autocomplete",
        "@codemirror/collab",
        "@codemirror/commands",
        "@codemirror/language",
        "@codemirror/lint",
        "@codemirror/search",
        "@codemirror/state",
        "@codemirror/view",
        "@lezer/common",
        "@lezer/highlight",
        "@lezer/lr",
        ...builtins,
      ],
    },
    outDir: mode === "development" ? "./test-vault/.obsidian/plugins/obsidian-gantt" : "dist",
    emptyOutDir: false,
    sourcemap: "inline",
  },
}));
```

### Component Mounting Best Practices

```typescript
// Proper Svelte component mounting in Obsidian
import { mount, unmount } from "svelte";

export function mountSvelte<T extends Record<string, any>>(
  target: HTMLElement,
  component: ComponentType<SvelteComponent<T>>,
  props?: T
): () => void {
  const instance = mount(component, {
    target,
    props: props || ({} as T),
  });

  return () => {
    unmount(instance);
  };
}
```

### Development Workflow

- **Hot Reloading**: Use `vite build --mode development --watch` for development
- **Test Vault**: Automatic deployment to test vault during development
- **Source Maps**: Inline source maps for debugging without CSP issues
- **Bundle Analysis**: Monitor bundle size and externals configuration

## 12. Compliance & Standards Adherence

### Svelte 5 Architecture Guidelines ✅

- **Reactive Design**: Leverages Svelte 5 runes for optimal reactivity
- **Component Isolation**: Clear boundaries with reactive state encapsulation
- **Event-Driven**: SVAR actions + Svelte event system integration
- **Fail-Fast**: Early validation with comprehensive error types
- **State Management**: Svelte 5 reactive state + SVAR integration

### Code Quality Standards ✅

- **Single Responsibility**: Each Svelte component has focused purpose
- **Naming Conventions**: Descriptive, intention-revealing names following Dave Farley standards
- **Function Guidelines**: <50 lines, <4 parameters, single abstraction level
- **Dependency Injection**: Factory functions with explicit dependencies
- **Reactive Patterns**: Proper use of $state, $derived, and $props

### TypeScript Standards ✅

- **Strict Mode**: Full type safety enabled with Svelte 5 support
- **No Any Types**: Proper type definitions for all APIs and reactive state
- **Interface Design**: Clear contracts for all components and stores
- **Generic Types**: Reusable type-safe Svelte components
- **Reactive Type Safety**: Type-safe reactive state management

### Testing Standards ✅

- **TDD Approach**: Test-first development cycle with Svelte components
- **Vitest Framework**: Modern testing with Svelte Testing Library
- **Mocking Strategy**: Dependency injection enables comprehensive mocking
- **Coverage Goals**: 80%+ with focus on meaningful tests
- **Reactive Testing**: Test reactive state changes and component updates

### Obsidian Plugin Best Practices ✅

- **Factory Pattern**: Svelte component creation through factory functions
- **Modular Structure**: Separate concerns into focused Svelte modules
- **Lifecycle Management**: Proper Svelte cleanup and memory management
- **Dependency Injection**: Plugin instance passed to all components
- **Reactive Integration**: Seamless integration with Obsidian's reactive patterns
- **Vite Configuration**: Proper externals and build configuration following community standards
- **CSP Compliance**: No external resource loading, inline source maps for debugging

## 13. Success Metrics

### Svelte 5 Technical Excellence Metrics

- **Reactive Performance**: Sub-1-second rendering for 1000 tasks on desktop, <2 seconds on mobile
- **Memory Efficiency**: <30MB heap usage on desktop, <20MB on mobile (Svelte 5 optimization)
- **Bundle Size**: <500KB gzipped total bundle (compile-time optimization)
- **Field Mapping Flexibility**: Support any user property names via runtime configuration
- **Minimal Requirements**: Only `id` and `text` mandatory; all other fields optional
- **Dynamic Column Generation**: Automatic column creation from Bases property selection
- **Multi-Datasource Support**: Seamless switching between Bases and Dataview sources
- **Component Reusability**: 100% code reuse for core Svelte components across data sources
- **Offline Operation**: 100% functionality without internet connectivity
- **Multi-Instance Support**: 10+ simultaneous Gantt views with isolated reactive state
- **Virtual Task Performance**: Handle 500+ virtual duplicates without degradation
- **Column Resizing**: 60fps smooth dragging across all input types (mouse/touch/pen)
- **Touch Responsiveness**: <8ms response time for touch interactions (120fps)
- **Cross-Platform**: Consistent 60fps experience across desktop, mobile, and tablet
- **Error Rate**: <0.5% of user interactions result in errors
- **CSP Compliance**: Zero external resource loading violations
- **Build Optimization**: Proper Obsidian externals configuration reduces bundle size by 80%+
- **Development Experience**: Hot reloading with automatic test vault deployment
- **Source Map Integration**: Perfect debugging experience with inline source maps

### User Experience Excellence Metrics

- **Property Naming Freedom**: Users can name their Obsidian properties however they want
- **Minimal Configuration**: Only `id` and `text` field mappings required to get started
- **Dynamic Column Control**: Intuitive column selection via familiar Bases property interface
- **Data Source Flexibility**: Users can choose between Bases views and code block injection
- **Configuration Consistency**: Same `obsidianGantt` configuration works across contexts
- **Reactive Updates**: Real-time data synchronization with instant visual feedback
- **Usability**: Intuitive configuration with helpful error messages and validation
- **Reliability**: Zero crashes or data corruption incidents
- **Mobile Experience**: Fully functional on mobile devices with native touch interactions
- **Column Resizing**: Smooth, responsive resizing with mouse, touch, and pen input
- **Cross-Platform Consistency**: Identical feature set across all supported platforms
- **Accessibility**: Meets WCAG 2.1 AA standards for touch target sizes and interaction
- **Performance Perception**: Users perceive interactions as instantaneous (<100ms)

### Development Excellence Metrics

- **Code Quality**: 85%+ test coverage with meaningful Svelte component tests
- **Maintainability**: Clear Svelte 5 architecture enables easy feature additions
- **Documentation**: Comprehensive API docs with Svelte 5 examples
- **Developer Experience**: Excellent TypeScript integration with Svelte 5
- **Build Performance**: <10 second development builds, <30 second production builds
- **Community**: Active contribution and rapid issue resolution
- **Modern Standards**: Full compliance with latest web standards and best practices

---

**Document Version**: 2.0 (Pure SVAR Svelte 5 Implementation) **Last Updated**: 2025-01-24 **Next
Review**: Phase 1 Completion **Architecture**: Svelte 5 + SVAR Svelte Gantt + TypeScript + Vite
