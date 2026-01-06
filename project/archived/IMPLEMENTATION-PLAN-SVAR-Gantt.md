# Implementation Plan: SVAR Obsidian Gantt Plugin

**Project**: obsidian-gantt — React-based Gantt chart visualization using SVAR React Gantt
**Status**: Phase 2 in progress — Dynamic columns and integration tests completed; next up: column
visibility+ordering synced to Bases settings, missing-date indicators UX, and type hygiene
**Created**: 2025-01-22 **Last Updated**: 2025-09-23

## Overview

This implementation plan outlines the step-by-step development of a modern, React-based Gantt chart
plugin that leverages SVAR React Gantt's multi-instance architecture to replace the existing
DHTMLX-based solution.

## Architecture Foundation

### Core Principles

- **Event-Driven Architecture**: SVAR actions + custom Obsidian events
- **Multi-Datasource Support**: Pluggable data sources (Bases, Dataview, future)
- **Reusable Components**: Data-source agnostic core components
- **Flexible Field Mapping**: Runtime configuration, minimal requirements
- **Mobile-First**: Cross-platform support with touch interactions

### Technology Stack

- **Frontend**: React 18+ with TypeScript
- **Gantt Library**: SVAR React Gantt (wx-react-gantt)
- **Build System**: esbuild with TypeScript compilation
- **Testing**: Jest with React Testing Library
- **Obsidian Integration**: obsidian-typings (Phase 1), official Bases API (Phase 2)

## Implementation Phases

### Phase 1: MVP - Basic SVAR Integration (Week 1-2)

**Goal**: Register custom Bases view with SVAR Gantt displaying dummy data

#### Milestone 1.1: Project Setup & Dependencies

**Duration**: 2 days **Deliverables**:

- [x] Install SVAR React Gantt: `npm install wx-react-gantt`
- [x] Install React dependencies: `npm install react react-dom @types/react @types/react-dom`
- [x] Configure TypeScript for React JSX support
- [x] Update esbuild configuration for React compilation
- [x] Create basic project structure with src/ directories

**Acceptance Criteria**:

- SVAR React Gantt package installed and importable
- React components can be compiled without errors
- TypeScript strict mode enabled with proper React types
- Build system produces working plugin bundle

#### Milestone 1.2: React Integration Foundation

**Duration**: 3 days **Deliverables**:

- [x] Create ReactDOM integration utilities for Obsidian (mountReact helper)
- [x] Implement React component mounting/unmounting in Obsidian views
- [x] Create error boundary component for React error handling
- [ ] Set up React DevTools integration (development only)
- [x] Create basic GanttContainer React component

**Acceptance Criteria**:

- React components render successfully in Obsidian view containers
- Proper cleanup on view destruction (no memory leaks)
- Error boundary catches and displays React errors gracefully
- React DevTools accessible in development mode

#### Milestone 1.3: SVAR Gantt Component Wrapper

**Duration**: 3 days **Deliverables**:

- [x] Create GanttComponent wrapper around SVAR `<Gantt />` (GanttContainer)
- [x] Implement dummy data generation for testing
- [x] Configure basic SVAR props (tasks, links, columns, scales)
- [x] Add basic styling and CSS imports (offline CSS injection)
- [x] Implement component lifecycle management

**Acceptance Criteria**:

- SVAR Gantt renders with dummy tasks and timeline
- Component properly initializes and destroys
- Basic interaction works (scrolling, zooming)
- No console errors or warnings

#### Milestone 1.4: Obsidian Bases View Registration

**Duration**: 2 days **Deliverables**:

- [x] Register custom Bases view type (registered as "Gantt (OG)" via factory)
- [x] Implemented using factory-based view lifecycle instead of subclassing Obsidian View
- [x] Implement view factory and registration logic
- [x] Mount React component in Bases view container
- [ ] Add basic view toolbar and controls

**Acceptance Criteria**:

- "obsidianGantt" view type appears in Bases view options
- View renders SVAR Gantt with dummy data when selected
- View integrates properly with Obsidian's view system
- Multiple instances can be created without conflicts

**Phase 1 Success Criteria**:

- ✅ Custom Bases view "obsidianGantt" successfully registered
- ✅ SVAR React Gantt displays dummy data in Obsidian
- ✅ Multi-instance support verified (no singleton conflicts)
- ✅ Basic React integration working without memory leaks
- ✅ Foundation ready for real data integration

### Phase 2: Bases Data Integration (Week 3-4)

**Goal**: Replace dummy data with real Bases data using flexible field mapping

#### Milestone 2.1: Field Mapping System

**Duration**: 3 days **Deliverables**:

- [x] Create FieldMappings interface; validation implemented
- [x] Implement DataMapper class for flexible property mapping
- [ ] Create configuration parser for obsidianGantt YAML section (deferred; using Bases view config
      for now)
- [x] Add validation for required fields (id, text)
- [x] Implement default field mapping fallbacks (e.g., id=path, text=title, start=scheduled,
      end=due)

**Acceptance Criteria**:

- Field mappings support all Gantt parameters (id, text, start, end, duration, etc.)
- Configuration validation provides helpful error messages
- Only id and text fields are required; all others optional
- Invalid field mappings fail fast with clear guidance

#### Milestone 2.2: Bases Data Source Adapter

**Duration**: 4 days **Deliverables**:

- [x] Create BasesDataSource implementing DataSourceAdapter interface
- [x] Define DataSourceAdapter interface stub (in `src/data-sources/DataSourceAdapter.ts`)

- [x] Integrate with Bases controller from view factory (structural typing)
- [x] Implement data querying and transformation pipeline
- [x] Add support for virtual task creation (multiple parents)
- [x] Create error handling for invalid configurations (ValidationEngine + inline error)

**Acceptance Criteria**:

- Real Bases data replaces dummy data in Gantt view
- Field mappings correctly transform user properties to SVAR format
- Virtual tasks created for items with multiple parents
- Error handling gracefully manages missing or invalid data

#### Milestone 2.3: Dynamic Column Generation

**Duration**: 3 days **Deliverables**:

- [x] Implement BasesColumnGenerator for property-based columns
- [x] Add property type detection and formatting (text, date, number, boolean, array/link)
- [x] Integrate with Bases property selection UI (via DI; real-time updates)
- [ ] Implement column width persistence (deferred)
- [x] Support common Obsidian property types (expand coverage in Phase 2.4)

**Acceptance Criteria**:

- Columns automatically generated from Bases property selection
- All Obsidian property types formatted correctly (dates, numbers, arrays, etc.)
- Column widths persist across sessions
- Property selection changes update columns in real-time

**Phase 2 Success Criteria**:

- ✅ Real Bases data displays in Gantt with user-defined field mappings
- ✅ Dynamic columns work with all Obsidian property types
- ✅ Virtual tasks handle multiple parent relationships correctly
- ✅ Configuration validation provides clear, actionable error messages

#### Milestone 2.4: Column visibility and ordering sync

**Duration**: 2 days **Deliverables**:

- Read selected property list and its order from Bases view (container.query.properties or
  equivalent)
- Generate task tree columns only for selected properties, preserving configured order
- Wire columns to GanttContainer without global state; update live on selection/order changes
- Unit tests for visibility and order; integration test for recompute on selection re-order

**Acceptance Criteria**:

- Only selected properties appear as columns in the task tree
- Column order matches Bases settings order and updates live when order changes
- No console errors; stable re-render behavior

### Phase 3: Mobile & Multi-Input Support (Week 5-6)

**Goal**: Ensure full mobile compatibility and multi-input column resizing

#### Milestone 3.1: Mobile Optimization

**Duration**: 4 days **Deliverables**:

- [ ] Implement responsive design for mobile devices
- [ ] Add touch gesture support (pinch-zoom, two-finger scroll)
- [ ] Optimize performance for mobile constraints
- [ ] Create mobile-specific UI adaptations
- [ ] Test on iOS and Android devices

**Acceptance Criteria**:

- Gantt fully functional on mobile devices (iOS/Android)
- Touch gestures work smoothly (scroll, zoom, pan)
- Performance acceptable on mid-range devices (2019+)
- UI adapts appropriately to different screen sizes

#### Milestone 3.2: Multi-Input Column Resizing

**Duration**: 3 days **Deliverables**:

- [ ] Implement MultiInputColumnResizer with Pointer Events API
- [ ] Add support for mouse, touch, and pen input
- [ ] Ensure 44px minimum touch targets for accessibility
- [ ] Add column width persistence across sessions
- [ ] Test on various devices and input methods

**Acceptance Criteria**:

- Column resizing works with mouse, touch, and pen input
- Smooth 60fps dragging performance across all input types
- Touch targets meet accessibility guidelines (44px minimum)
- Column widths persist across plugin reloads

**Phase 3 Success Criteria**:

- ✅ Full mobile compatibility with native touch interactions
- ✅ Multi-input column resizing works across all device types
- ✅ Performance targets met on mobile devices
- ✅ Accessibility standards met for touch interactions

### Phase 4: Performance & Polish (Week 7-8)

**Goal**: Optimize performance and add comprehensive error handling

#### Milestone 4.1: Performance Optimization

**Duration**: 3 days **Deliverables**:

- [ ] Implement virtual scrolling for large datasets
- [ ] Add lazy loading for task branches
- [ ] Optimize React rendering with memoization
- [ ] Add debouncing for configuration changes
- [ ] Performance testing with 1000+ tasks

**Acceptance Criteria**:

- 1000+ tasks render in <2 seconds on desktop, <4 seconds on mobile
- Virtual scrolling maintains smooth performance
- Memory usage stays under 50MB desktop, 30MB mobile
- Configuration changes debounced to prevent excessive re-renders

#### Milestone 4.2: Error Handling & Testing

**Duration**: 4 days **Deliverables**:

- [ ] Comprehensive error handling with custom error types
- [ ] Unit tests for all core components
- [ ] Integration tests with mock Obsidian APIs
- [ ] End-to-end testing scenarios
- [ ] Documentation and usage examples

**Acceptance Criteria**:

- 80%+ test coverage with meaningful tests
- All error scenarios handled gracefully with helpful messages
- Integration tests cover multi-instance scenarios
- Documentation includes configuration examples and troubleshooting

**Phase 4 Success Criteria**:

- ✅ Performance targets met for large datasets
- ✅ Comprehensive test coverage with reliable test suite
- ✅ Error handling provides clear, actionable guidance
- ✅ Documentation ready for user adoption

### Phase 5: Dataview Integration (Week 9-10)

**Goal**: Add support for Dataview data sources via code blocks

#### Milestone 5.1: Code Block Processor

**Duration**: 4 days **Deliverables**:

- [ ] Register obsidian-gantt and obsidian-gantt-js code block processors
- [ ] Implement DataviewDataSource adapter
- [ ] Add DQL query parsing and execution
- [ ] Support DataviewJS with custom logic
- [ ] Reuse existing GanttContainer components

**Acceptance Criteria**:

- obsidian-gantt code blocks render Gantt charts from DQL queries
- obsidian-gantt-js code blocks execute DataviewJS and render results
- Same GanttContainer components used as in Bases views
- Field mapping system works consistently across data sources

#### Milestone 5.2: Cross-Source Validation

**Duration**: 3 days **Deliverables**:

- [ ] Verify component reusability across data sources
- [ ] Test field mapping consistency
- [ ] Performance comparison between sources
- [ ] Documentation for both integration methods

**Acceptance Criteria**:

- 100% component reuse between Bases and Dataview sources
- Field mapping configuration identical across contexts
- Performance parity between data sources
- Clear documentation for users choosing between integration methods

**Phase 5 Success Criteria**:

- ✅ Dataview integration working via code blocks
- ✅ Component architecture proves reusability across data sources
- ✅ Field mapping system consistent across all contexts
- ✅ Users can choose between Bases views and code block injection

## Risk Mitigation

### Technical Risks

1. **SVAR React Integration Complexity**
   - Mitigation: Start with minimal integration, iterate incrementally
   - Fallback: Comprehensive documentation review and community support

2. **Obsidian Bases API Changes**
   - Mitigation: Use obsidian-typings initially, plan migration to official API
   - Fallback: Maintain compatibility layer for API transitions

3. **Mobile Performance Issues**
   - Mitigation: Early mobile testing, progressive optimization
   - Fallback: Simplified mobile UI with reduced feature set

### Project Risks

1. **Scope Creep**
   - Mitigation: Strict milestone adherence, MVP-first approach
   - Fallback: Defer non-essential features to future releases

2. **Timeline Delays**
   - Mitigation: Buffer time in estimates, parallel development where possible
   - Fallback: Prioritize core functionality over polish features

## Success Metrics

### Technical Metrics

- [ ] Multi-instance support: 5+ simultaneous views without conflicts
- [ ] Performance: <2s rendering for 1000 tasks on desktop
- [ ] Mobile compatibility: Functional on iOS/Android with touch support
- [ ] Field mapping flexibility: Any user property names supported
- [ ] Error rate: <1% of user interactions result in errors

### User Experience Metrics

- [ ] Configuration simplicity: Only id/text fields required for basic setup
- [ ] Property naming freedom: Users can use any property names
- [ ] Dynamic columns: Automatic generation from Bases property selection
- [ ] Cross-platform consistency: Identical features across all platforms

## Technical Specifications

### File Structure

```
src/
├── main.ts                     # Plugin entry point
├── components/                 # React components
│   ├── GanttContainer.tsx      # Main Gantt wrapper (reusable)
│   ├── GanttComponent.tsx      # SVAR Gantt wrapper
│   ├── ErrorBoundary.tsx       # React error handling
│   └── LoadingState.tsx        # Loading indicators
├── data-sources/               # Data source adapters
│   ├── DataSourceAdapter.ts    # Interface definition
│   ├── BasesDataSource.ts      # Bases integration
│   └── DataviewDataSource.ts   # Dataview integration
├── mapping/                    # Data transformation
│   ├── FieldMappings.ts        # Field mapping interfaces
│   ├── DataMapper.ts           # Generic data mapping
│   └── VirtualTaskManager.ts   # Multiple parent handling
├── views/                      # Obsidian view integration
│   ├── BasesGanttView.ts       # Custom Bases view
│   └── CodeBlockProcessor.ts   # Markdown code block processor
├── utils/                      # Utilities
│   ├── ReactUtils.ts           # React/Obsidian integration
│   ├── ColumnGenerator.ts      # Dynamic column creation
│   └── ValidationEngine.ts     # Configuration validation
└── types/                      # TypeScript definitions
    ├── svar.d.ts               # SVAR type definitions
    ├── bases.d.ts              # Bases type definitions
    └── gantt.d.ts              # Plugin-specific types
```

### Key Interfaces

```typescript
interface DataSourceAdapter {
  readonly type: "bases" | "dataview" | "custom";
  readonly renderContext: "bases-view" | "code-block";

  initialize(): Promise<void>;
  queryData(config: GanttConfig): Promise<any[]>;
  validateConfig(config: GanttConfig): ValidationResult;
  mapToSVARFormat(rawData: any[], fieldMappings: FieldMappings): SVARTask[];
  dispose(): void;
}

interface FieldMappings {
  id: string; // Required
  text: string; // Required
  start?: string; // Optional
  end?: string; // Optional
  duration?: string; // Optional
  progress?: string; // Optional
  parent?: string; // Optional
  parents?: string; // Optional
  type?: string; // Optional
}

interface GanttConfig {
  fieldMappings: FieldMappings;
  viewMode: "Day" | "Week" | "Month";
  tableWidth?: number;
  show_today_marker?: boolean;
  hide_task_names?: boolean;
  showMissingDates?: boolean;
  missingStartBehavior?: "infer" | "show" | "hide";
  missingEndBehavior?: "show" | "infer" | "hide";
  defaultDuration?: number;
  showMissingDateIndicators?: boolean;
}
```

## Development Guidelines

### Code Quality Standards

- TypeScript strict mode with no `any` types
- Jest unit tests with 80%+ coverage
- ESLint and Prettier for code consistency
- Conventional commits for clear history

### Architecture Principles

- Single Responsibility Principle for all components
- Dependency injection for testability
- Event-driven communication between components
- Fail-fast validation with helpful error messages

### Testing Strategy

- Unit tests for all data transformation logic
- Integration tests for Obsidian API interactions
- React component tests using React Testing Library
- End-to-end tests for complete user workflows
- Performance tests for large datasets (1000+ tasks)

---

### 2025-09-23 - Phase 2 core mapping/adapter + validation

- Decision: keep reading settings from Bases view config (no YAML parser for now)
- Added: ValidationEngine with sensible defaults and clear error messages (+ unit tests)
- Added: DataMapper with robust date coercion and safe placeholders for missing dates (never exclude
  tasks)
- Added: VirtualTaskManager to support multiple parents via virtual duplicates while preserving
  noteId

### 2025-09-23 - Phase 2.3 dynamic columns + integration tests

- Added: BasesColumnGenerator to create SVAR-compatible columns from Bases properties; DI
  integration in basesGanttViewFactory
- Added: Real-time column regeneration on Bases property selection changes
  (properties-changed/view-config-changed)
- Added: Integration tests for Bases→mapping pipeline (missing dates retained, multi-parents
  duplicates with same noteId, invalid config handled, refresh/onDataUpdated recompute)
- Quality: All tests green; typecheck clean; lint warnings queued for Type hygiene task; build:local
  installs to test vault

- Added: BasesDataSource to normalize Bases results for mapping
- Updated: basesGanttViewFactory wired to adapter + mapper; GanttContainer made prop-driven with
  empty-state
- Quality: All unit tests passing; typecheck clean; build installs into test vault
- Fix: Resolved "Invalid time value" by ensuring valid Date ranges in all tasks

### 2025-09-22 - Phase 1 MVP dummy data + hygiene refactors

- Added: React ErrorBoundary and reusable mountReact helper for robust mount/unmount
- Added: GanttContainer component rendering SVAR React Gantt with dummy data (offline CSS injection)
- Updated: Bases view factory to render <ErrorBoundary><GanttContainer/></ErrorBoundary>, compute
  formulas before first paint
- Updated: Package description to reflect SVAR React Gantt
- Added: FieldMappings and DataSourceAdapter interface stubs (prep for Phase 2)
- CI: Avoid duplicate checks by scoping triggers to pull_request and push to main (separate PR)
- Status: Phase 1 MVP achieved; preparing Phase 2 (field mapping + Bases adapter)

### 2025-09-22 - MVP groundwork (Bases custom view scaffolding)

- **Added**: Runtime registration for Bases custom view type `obsidianGantt` with retry + leaf
  refresh
- **Added**: Bases Gantt view factory with lifecycle methods (load/unload/destroy/refresh, ephemeral
  state)
- **Added**: Placeholder render in Bases view container; ready to swap for SVAR Gantt with dummy
  data
- **Aligned With**: TaskNotes patterns (structural typing, controller.runQuery before first paint,
  graceful guards)
- **Files**:
  - src/views/registerBasesGantt.ts
  - src/views/basesGanttViewFactory.ts
  - src/main.ts (registration on load, unregistration on unload)
- **Next**: Install React + SVAR React Gantt and render dummy tasks in the Bases view

### 2025-01-22 - Initial Planning

- **Added**: Complete implementation plan with 5 phases
- **Added**: Detailed milestone breakdown for MVP (Phase 1)
- **Added**: Risk mitigation strategies and success metrics
- **Added**: Development guidelines and architecture principles
- **Status**: Ready to begin Phase 1 implementation

---

_This document will be updated continuously as implementation progresses, with detailed changelog
entries tracking all decisions, learnings, and modifications._
