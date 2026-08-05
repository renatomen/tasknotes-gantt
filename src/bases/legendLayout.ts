export type LegendPosition = 'right' | 'bottom';

export type LegendLayout = LegendPosition | 'full';

export type LegendSessionState =
  | { readonly open: false }
  | { readonly open: true; readonly position: LegendPosition };

export type LegendSessionAction =
  | { readonly type: 'open'; readonly defaultPosition: LegendPosition }
  | { readonly type: 'move'; readonly position: LegendPosition }
  | { readonly type: 'close' };

export const CLOSED_LEGEND_SESSION: LegendSessionState = { open: false };

export const MIN_RIGHT_OVERLAY_HOST_WIDTH = 640;
export const MIN_RIGHT_OVERLAY_HOST_HEIGHT = 240;
export const MIN_BOTTOM_OVERLAY_HOST_WIDTH = 480;
export const MIN_BOTTOM_OVERLAY_HOST_HEIGHT = 320;

export function reduceLegendSession(
  state: LegendSessionState,
  action: LegendSessionAction,
): LegendSessionState {
  if (action.type === 'open') {
    return state.open ? state : { open: true, position: action.defaultPosition };
  }
  if (action.type === 'close') return CLOSED_LEGEND_SESSION;
  if (!state.open) return state;
  return { open: true, position: action.position };
}

interface LegendLayoutInput {
  position: LegendPosition;
  width: number;
  height: number;
}

export function resolveLegendLayout({ position, width, height }: LegendLayoutInput): LegendLayout {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 'full';
  const minimumWidth =
    position === 'right' ? MIN_RIGHT_OVERLAY_HOST_WIDTH : MIN_BOTTOM_OVERLAY_HOST_WIDTH;
  const minimumHeight =
    position === 'right' ? MIN_RIGHT_OVERLAY_HOST_HEIGHT : MIN_BOTTOM_OVERLAY_HOST_HEIGHT;
  return width >= minimumWidth && height >= minimumHeight ? position : 'full';
}
