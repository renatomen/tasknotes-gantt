# Known Issues

## SVAR Gantt Library Warnings

The SVAR Svelte Gantt library generates several console warnings that are **expected and do not affect functionality**:

### 1. Content Security Policy (CSP) Violations
```
Refused to load the stylesheet 'https://cdn.svar.dev/fonts/wxi/wx-icons.css' because it violates the following Content Security Policy directive
```
- **Cause**: SVAR Gantt attempts to load external icon fonts from CDN
- **Impact**: Icons may fall back to default fonts, but functionality is unaffected
- **Status**: ✅ **RESOLVED** - Using custom Lucide-style SVG icons with `fonts={false}`

### 2. Non-Passive Event Listeners
```
[Violation] Added non-passive event listener to a scroll-blocking 'touchstart' event
[Violation] Added non-passive event listener to a scroll-blocking 'wheel' event
```
- **Cause**: SVAR Gantt uses blocking event listeners for drag/zoom functionality
- **Impact**: Required for proper touch and mouse interaction
- **Status**: Intentional library design for interactive features

### 3. Performance Violations
```
[Violation] 'requestAnimationFrame' handler took XXms
[Violation] Forced reflow while executing JavaScript took XXms
[Violation] 'setTimeout' handler took XXms
```
- **Cause**: Complex DOM operations during chart rendering and interaction
- **Impact**: Expected for rich UI components with many visual elements
- **Status**: Normal behavior for data visualization libraries

## Resolution

Most of these warnings are **inherent to the SVAR Gantt library** and cannot be eliminated through wrapper code. They do not affect:
- Plugin functionality
- Data accuracy
- User experience
- Obsidian stability

The remaining warnings can be safely ignored as they represent expected behavior of a complex data visualization component.

**CSP violations resolved**: Custom Lucide-style SVG icons are embedded as data URIs, preventing external font loading while maintaining icon functionality.

## Alternative Solutions

If these warnings are problematic for your environment, consider:
1. Using a different Gantt library with fewer console warnings
2. Implementing a custom Gantt visualization
3. Filtering console output to hide these specific warnings

However, SVAR Gantt provides the best feature set and Svelte 5 compatibility for our use case.
