<script lang="ts">
  /* global HTMLElement, HTMLButtonElement, KeyboardEvent */
  import { tick } from 'svelte';
  import type { LegendGroup, LegendIconSample, LegendSampleDescriptor } from './legendCatalog';
  import type { LegendLayout, LegendPosition } from './legendLayout';
  import { lucideIcon } from './lucideIconAction';
  import { GANTT_VISUAL_CLASS_TOKENS as classes } from './visualSemantics';

  interface Props {
    groups: LegendGroup[];
    layout: LegendLayout;
    position: LegendPosition;
    onPositionChange: (position: LegendPosition) => void;
    onDismiss: () => void;
  }

  let { groups, layout, position, onPositionChange, onDismiss }: Props = $props();
  let positionControls: HTMLElement | undefined = $state();
  let dismissButton: HTMLButtonElement | undefined = $state();
  let legendOverlay: HTMLElement | undefined = $state();

  $effect.pre(() => {
    if (layout !== 'full') return;
    const activeElement = document.activeElement;
    const focusInPositionControls = positionControls?.contains(activeElement) ?? false;
    const chartSurface = legendOverlay
      ?.closest('.og-bases-gantt')
      ?.querySelector<HTMLElement>('.og-chart-surface');
    const focusInChart =
      activeElement instanceof HTMLElement && (chartSurface?.contains(activeElement) ?? false);
    if (!focusInPositionControls && !focusInChart) return;
    void tick().then(() => {
      if (layout === 'full') dismissButton?.focus({ preventScroll: true });
    });
  });

  function focusOnMount(node: HTMLElement): void {
    void tick().then(() => node.focus({ preventScroll: true }));
  }

  function choosePosition(choice: LegendPosition, focus = false): void {
    onPositionChange(choice);
    if (!focus) return;
    void tick().then(() => {
      positionControls
        ?.querySelector<HTMLButtonElement>(`button[data-position="${choice}"]`)
        ?.focus({ preventScroll: true });
    });
  }

  function handlePositionKeydown(event: KeyboardEvent, index: number): void {
    const choices: LegendPosition[] = ['right', 'bottom'];
    const current = choices[index];
    if (!current) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choosePosition(current);
      return;
    }
    const offset =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      choosePosition(event.key === 'Home' ? 'right' : 'bottom', true);
      return;
    }
    if (offset === 0) return;
    event.preventDefault();
    const next = choices[(index + offset + choices.length) % choices.length];
    if (next) choosePosition(next, true);
  }

  function descriptorStyle(descriptor: LegendSampleDescriptor): string {
    return Object.entries(descriptor.cssVariables ?? {})
      .map(([name, value]) => `${name}:${value}`)
      .join(';');
  }

  const className = (tokens: string[]): string => tokens.join(' ');
  const percentage = (value: number): string => `${value * 100}%`;

  function focusableScroll(node: HTMLElement): { destroy: () => void } {
    node.tabIndex = 0;
    const containScrollKey = (event: KeyboardEvent): void => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)) {
        event.stopPropagation();
      }
    };
    node.addEventListener('keydown', containScrollKey);
    return { destroy: () => node.removeEventListener('keydown', containScrollKey) };
  }
</script>

<div class="og-legend-overlay" data-layout={layout} bind:this={legendOverlay}>
  <section
    class="og-gantt-legend"
    class:og-legend-right={layout === 'right'}
    class:og-legend-bottom={layout === 'bottom'}
    class:og-legend-full={layout === 'full'}
    data-layout={layout}
    aria-label="Gantt legend"
  >
    <header class="og-legend-header">
      <div class="og-legend-title-block">
        <h2>Legend</h2>
        <p>Visual meanings in this Gantt</p>
      </div>

      {#if layout !== 'full'}
        <div
          class="og-legend-position"
          role="radiogroup"
          aria-label="Legend position"
          aria-orientation="horizontal"
          bind:this={positionControls}
        >
          <span class="og-legend-control-label">Position</span>
          {#each ['right', 'bottom'] as choice, index (choice)}
            <button
              type="button"
              role="radio"
              aria-checked={position === choice}
              aria-label={choice === 'right' ? 'Right' : 'Bottom'}
              data-position={choice}
              tabindex={position === choice ? 0 : -1}
              class:is-active={position === choice}
              onclick={() => choosePosition(choice as LegendPosition)}
              onkeydown={(event) => handlePositionKeydown(event, index)}
            >
              {choice === 'right' ? 'Right' : 'Bottom'}
            </button>
          {/each}
        </div>
      {/if}

      <button
        type="button"
        class="og-legend-dismiss"
        aria-label={layout === 'full' ? 'Return to Gantt' : 'Close legend'}
        onclick={onDismiss}
        bind:this={dismissButton}
        use:focusOnMount
      >
        <span aria-hidden="true" use:lucideIcon={layout === 'full' ? 'arrow-left' : 'x'}></span>
        <span>{layout === 'full' ? 'Return' : 'Close'}</span>
      </button>
    </header>

    <div
      class="og-legend-scroll"
      role="region"
      use:focusableScroll
      aria-label={layout === 'right'
        ? 'Legend entries, vertical scrolling'
        : layout === 'bottom'
          ? 'Legend entries, horizontal and vertical scrolling'
          : 'Legend entries'}
    >
      <div class="og-legend-groups">
        {#each groups as group (group.id)}
          <section class="og-legend-group" aria-labelledby={`og-legend-group-${group.id}`}>
            <h2 id={`og-legend-group-${group.id}`}>{group.name}</h2>
            <ul>
              {#each group.entries as entry (entry.semanticId)}
                <li class="og-legend-entry" data-semantic-id={entry.semanticId}>
                  <div
                    class="og-legend-sample"
                    class:og-legend-icon-sample={entry.sample.kind === 'icon-set'}
                    class:og-legend-non-working-shaded={entry.sample.kind === 'bar'
                      && entry.sample.cssVariables?.['--og-legend-shading-background'] !== undefined}
                    style={descriptorStyle(entry.sample)}
                    aria-hidden="true"
                  >
                    {@render sample(entry.sample, entry.semanticId)}
                  </div>
                  <div class="og-legend-copy">
                    <h3>{entry.name}</h3>
                    <p>{entry.meaning}</p>
                  </div>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </div>
  </section>
</div>

{#snippet icon(descriptor: LegendIconSample)}
  <span class={classes.iconChip} aria-hidden="true">
    {#if descriptor.shape === 'glyph' && descriptor.iconName}
      <span class={classes.iconGlyph} use:lucideIcon={descriptor.iconName}></span>
    {:else if descriptor.shape === 'ring'}
      <span class={classes.iconRing} style={`border-color:${descriptor.color}`}></span>
    {:else if descriptor.shape === 'disc'}
      <span class={classes.iconDisc} style={`background-color:${descriptor.color}`}></span>
    {:else}
      <span class={classes.iconDot} style={`background-color:${descriptor.color}`}></span>
    {/if}
  </span>
{/snippet}

{#snippet sample(descriptor: LegendSampleDescriptor, semanticId: string)}
  {#if descriptor.kind === 'bar' || descriptor.kind === 'decoration'}
    <div class={`og-legend-bar ${className(descriptor.classTokens)}`} style={descriptorStyle(descriptor)}>
      {#if descriptor.icons?.[0]}{@render icon(descriptor.icons[0])}{/if}
      {#if semanticId === 'estimate-override'}<span class={classes.overrideDot}></span>{/if}
    </div>
  {:else if descriptor.kind === 'icon-set'}
    <div class="og-legend-icons">
      {#each descriptor.icons ?? [] as item, index (`${item.kind}-${item.color}-${index}`)}
        {@render icon(item)}
      {/each}
    </div>
  {:else if descriptor.kind === 'progress'}
    <div class={`og-legend-bar ${className(descriptor.classTokens)}`} style={descriptorStyle(descriptor)}>
      <div class={classes.progressWrapper}><div class={classes.progressFill}></div></div>
    </div>
  {:else if descriptor.kind === 'link'}
    <div class={`og-legend-link ${className(descriptor.classTokens)}`}>
      <span class="og-legend-link-node"></span><span class={classes.dependencyLine}></span><span class="og-legend-link-arrow"></span>
    </div>
  {:else if descriptor.kind === 'shading'}
    <div
      class={`og-legend-shading og-legend-${semanticId} ${className(descriptor.classTokens)}`}
      class:og-legend-shading-cells={semanticId === 'weekend-shading' ||
        semanticId === 'calendar-shading'}
      style={descriptorStyle(descriptor)}
    ></div>
  {:else if descriptor.kind === 'marker'}
    <div class="og-legend-marker-frame" style={descriptorStyle(descriptor)}>
      <span class={className(descriptor.classTokens)}></span>
    </div>
  {:else if descriptor.kind === 'pieces'}
    <div class={`${className(descriptor.classTokens)} og-legend-pieces`} style={descriptorStyle(descriptor)}>
      {#each descriptor.pieces ?? [] as piece, index (index)}
        <span
          class={`${className(piece.classTokens)} og-piece-${piece.treatment}`}
          style={`left:${percentage(piece.start)};width:${percentage(piece.width)}`}
        ></span>
      {/each}
      {#if descriptor.pieceEnvelopeClassTokens?.length}
        <span
          class={`${className(descriptor.pieceEnvelopeClassTokens)} og-legend-piece-envelope`}
        ></span>
      {/if}
    </div>
  {:else if descriptor.kind === 'line'}
    <div class="og-legend-line-frame" style={descriptorStyle(descriptor)}>
      <span class={className(descriptor.classTokens)}></span>
    </div>
  {/if}
{/snippet}

<style>
  .og-legend-overlay {
    position: absolute;
    inset: 0;
    z-index: 110;
    pointer-events: none;
  }

  .og-gantt-legend {
    position: absolute;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    pointer-events: auto;
    color: var(--text-normal, var(--wx-color-font));
    background: var(--background-primary, var(--wx-background));
    border: 1px solid var(--background-modifier-border, #d8d8d8);
    box-shadow: var(--shadow-l, 0 6px 24px rgba(0, 0, 0, 0.24));
  }

  .og-legend-right {
    inset: 8px 8px 8px auto;
    width: min(380px, 48%);
  }

  .og-legend-bottom {
    inset: auto 8px 8px 8px;
    height: min(250px, 58%);
  }

  .og-legend-full {
    inset: 0;
    border: 0;
    box-shadow: none;
  }

  .og-legend-header {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--size-4-2, 8px);
    padding: var(--size-4-2, 8px) var(--size-4-3, 12px);
    border-bottom: 1px solid var(--background-modifier-border, #d8d8d8);
    background: var(--background-secondary, var(--wx-background-alt));
  }

  .og-legend-title-block { min-width: 0; margin-right: auto; }
  .og-legend-title-block h2,
  .og-legend-group h2,
  .og-legend-entry h3 { margin: 0; color: inherit; }
  .og-legend-title-block h2 { font-size: var(--font-ui-medium, 15px); }
  .og-legend-title-block p,
  .og-legend-entry p { margin: 2px 0 0; color: var(--text-muted, var(--wx-color-font-alt)); }
  .og-legend-title-block p { font-size: var(--font-ui-smaller, 11px); }

  .og-legend-position { display: flex; align-items: center; gap: 4px; }
  .og-legend-control-label { font-size: var(--font-ui-smaller, 11px); color: var(--text-muted); }

  .og-legend-position button,
  .og-legend-dismiss {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: max(44px, var(--input-height, 0px));
    min-height: max(44px, var(--input-height, 0px));
    padding: 4px 8px;
    border: 1px solid var(--background-modifier-border, #d8d8d8);
    border-radius: var(--radius-s, 4px);
    background: var(--background-primary, var(--wx-background));
    color: inherit;
    box-shadow: none;
    cursor: pointer;
  }

  .og-legend-position button.is-active {
    background: var(--interactive-accent, var(--wx-color-primary));
    color: var(--text-on-accent, var(--wx-color-primary-font));
  }

  .og-legend-dismiss span:first-child { display: inline-flex; width: 16px; height: 16px; }
  .og-legend-dismiss span:first-child :global(svg) { width: 16px; height: 16px; }

  .og-legend-position button:focus-visible,
  .og-legend-dismiss:focus-visible,
  .og-legend-scroll:focus-visible {
    outline: 2px solid var(--interactive-accent, var(--wx-color-primary));
    outline-offset: 2px;
  }

  .og-legend-scroll {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }

  .og-legend-right .og-legend-scroll { overflow-y: auto; overflow-x: hidden; }
  .og-legend-bottom .og-legend-scroll { overflow: auto; }
  .og-legend-full .og-legend-scroll { overflow: auto; }

  .og-legend-groups { display: flex; flex-direction: column; gap: 14px; padding: 12px; }
  .og-legend-bottom .og-legend-groups { flex-direction: row; width: max-content; min-width: 100%; }
  .og-legend-full .og-legend-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }

  .og-legend-group { min-width: 0; }
  .og-legend-bottom .og-legend-group { width: max-content; }
  .og-legend-bottom .og-legend-group ul { flex-direction: row; }
  .og-legend-bottom .og-legend-entry { width: 320px; }
  .og-legend-group > h2 { margin-bottom: 7px; font-size: var(--font-ui-small, 13px); }
  .og-legend-group ul { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }

  .og-legend-entry {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: var(--radius-s, 4px);
    background: var(--background-secondary-alt, var(--wx-background-alt));
  }
  .og-legend-entry h3 { font-size: var(--font-ui-small, 13px); }
  .og-legend-entry p { font-size: var(--font-ui-smaller, 11px); line-height: 1.35; }

  .og-legend-sample {
    position: relative;
    height: 34px;
    overflow: visible;
  }
  .og-legend-non-working-shaded {
    background: linear-gradient(
      to right,
      transparent 0 32%,
      var(--og-legend-shading-background) 32% 56%,
      transparent 56%
    );
  }
  .og-legend-icon-sample { height: auto; min-height: 34px; }

  .og-legend-sample :global(.wx-bar),
  .og-legend-bar {
    position: absolute;
    inset: 7px 2px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    min-width: 0;
    background-color: var(--wx-gantt-task-color, #3d8de6);
    border-radius: var(--wx-gantt-bar-border-radius, 2px);
  }
  .og-legend-sample > .og-legend-bar:global(.og-instance) {
    top: 7px;
    height: 20px;
  }
  .og-legend-entry[data-semantic-id='estimate-meaning'] .og-legend-bar {
    inset-inline-end: var(--og-legend-estimate-end-inset, 2px);
  }
  .og-legend-bar :global(.og-bar-chip) { margin-left: 8px; }
  .og-legend-sample :global(.wx-bar.datestatus-flagged) {
    border-width: 1px;
    border-style: solid;
  }
  /*
   * The torn swatch consumes the chart's own teeth variables so any tuning of
   * the production cut re-shapes this sample with it; the fallbacks mirror the
   * chart's values for a legend rendered outside one. Both edges are torn
   * because the entry's copy explains both, and the torn sides shed their
   * corner radius exactly as production bars do.
   */
  .og-legend-entry[data-semantic-id='date-status-torn'] .og-legend-bar {
    --og-legend-tooth: min(
      var(--og-zigzag-depth, 4px),
      var(--og-zigzag-surface-ceiling, 40%)
    );
    border-radius: 0;
    -webkit-mask-image:
      var(--og-zigzag-teeth-start, conic-gradient(from 0deg at 0px 50%, #0000 0deg 45deg, #000 45deg 135deg, #0000 135deg 360deg)),
      var(--og-zigzag-teeth-end, conic-gradient(from 0deg at 100% 50%, #0000 0deg 225deg, #000 225deg 315deg, #0000 315deg 360deg)),
      var(--og-zigzag-middle, linear-gradient(#000, #000));
    mask-image:
      var(--og-zigzag-teeth-start, conic-gradient(from 0deg at 0px 50%, #0000 0deg 45deg, #000 45deg 135deg, #0000 135deg 360deg)),
      var(--og-zigzag-teeth-end, conic-gradient(from 0deg at 100% 50%, #0000 0deg 225deg, #000 225deg 315deg, #0000 315deg 360deg)),
      var(--og-zigzag-middle, linear-gradient(#000, #000));
    -webkit-mask-size:
      var(--og-legend-tooth) var(--og-zigzag-period, 8px),
      var(--og-legend-tooth) var(--og-zigzag-period, 8px),
      calc(100% - var(--og-legend-tooth) * 2) 100%;
    mask-size:
      var(--og-legend-tooth) var(--og-zigzag-period, 8px),
      var(--og-legend-tooth) var(--og-zigzag-period, 8px),
      calc(100% - var(--og-legend-tooth) * 2) 100%;
    -webkit-mask-position:
      left top,
      right top,
      center top;
    mask-position:
      left top,
      right top,
      center top;
    -webkit-mask-repeat: repeat-y, repeat-y, no-repeat;
    mask-repeat: repeat-y, repeat-y, no-repeat;
  }
  /*
   * The strip accent is a host-level `::before` that would paint straight over
   * the leading teeth — the same collision production resolves by starting the
   * accent at the tooth depth and capping it between the teeth.
   */
  .og-legend-entry[data-semantic-id='date-status-torn'] .og-legend-bar::before {
    left: var(--og-zigzag-depth, 4px) !important;
    max-width: calc(100% - var(--og-zigzag-depth, 4px) * 2) !important;
  }

  .og-legend-entry[data-semantic-id='date-status-fill'] .og-legend-bar {
    background-color: var(--og-date-status-fill, #e67e22) !important;
    border: 0 !important;
  }
  .og-legend-entry[data-semantic-id='date-status-border'] .og-legend-bar {
    border: 1px solid var(--og-date-status-border, #c0392b) !important;
  }

  .og-legend-sample :global(.wx-progress-wrapper) { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
  .og-legend-sample :global(.wx-progress-percent) { width: 58%; height: 100%; background: var(--wx-gantt-task-fill-color, rgba(0,0,0,.25)); }

  .og-legend-icons {
    min-height: 34px;
    display: flex;
    flex-wrap: wrap;
    align-content: center;
    align-items: center;
    gap: 5px;
    overflow: visible;
  }
  .og-legend-link { height: 100%; display: flex; align-items: center; color: var(--wx-gantt-link-color, var(--interactive-accent)); }
  .og-legend-link-node { width: 12px; height: 12px; border: 2px solid currentColor; border-radius: 2px; }
  .og-legend-link :global(.wx-line) { flex: 1; height: 2px; background: currentColor; }
  .og-legend-link-arrow { width: 0; height: 0; border-block: 5px solid transparent; border-left: 7px solid currentColor; }

  .og-legend-shading {
    height: 100%;
    border: 1px solid var(--background-modifier-border);
    background: var(--og-legend-shading-background, var(--background-secondary));
  }

  /*
   * A tint only reads next to untinted neighbours, so these swatches are a
   * strip of four day cells whose middle pair carries the chart's own shading
   * over the chart's own canvas — a miniature of the chart in any theme,
   * instead of a lone tinted box whose visibility depends on the card behind
   * it. The conflict swatch keeps its stripes and is untouched. The class is a
   * class: directive rather than part of the dynamic class string, which some
   * compile pipelines cannot see through and prune the selector for.
   */
  .og-legend-shading-cells {
    background-color: var(--wx-background, var(--background-primary, #ffffff));
    background-image:
      repeating-linear-gradient(
        to right,
        transparent 0 calc(25% - 1px),
        var(--background-modifier-border, rgba(128, 128, 128, 0.35)) calc(25% - 1px) 25%
      ),
      linear-gradient(
        to right,
        transparent 0 25%,
        var(--og-legend-shading-background, var(--background-secondary, rgba(128, 128, 128, 0.2))) 25% 75%,
        transparent 75%
      );
  }

  .og-legend-marker-frame,
  .og-legend-line-frame,
  .og-legend-pieces { position: relative; height: 100%; }
  .og-legend-marker-frame :global(.og-marker) { position: absolute; left: 50%; top: 0; width: 2px; height: 100%; background: var(--og-marker-color, var(--interactive-accent)); }
  .og-legend-line-frame :global(.og-series-spine) { left: 5%; width: 90%; }
  .og-legend-pieces :global(.og-ghost-run),
  .og-legend-pieces :global(.og-instance) { position: absolute; top: 7px; height: 20px; }
  .og-legend-pieces :global(.og-piece-painted)::before { content: none !important; }
  .og-legend-pieces :global(.og-piece-painted.og-instance) { border: 0 !important; }
  .og-legend-pieces.og-legend-strip-only :global(.og-piece-painted.og-instance) {
    background-color: var(--og-ghost-fill, var(--wx-gantt-task-color, #3d8de6)) !important;
  }
  .og-legend-pieces .og-legend-piece-envelope {
    position: absolute;
    inset: auto;
    left: 0;
    top: 7px;
    width: 100%;
    height: 20px;
    box-sizing: border-box;
    background-color: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
    z-index: 2;
    pointer-events: none;
  }
  .og-legend-pieces .og-piece-gap { background: transparent; }

  @media (max-width: 600px) {
    .og-legend-header { flex-wrap: wrap; }
    .og-legend-title-block { flex: 1 1 calc(100% - 90px); }
  }
</style>
