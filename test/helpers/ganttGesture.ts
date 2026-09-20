/* global EventTarget, MouseEvent, ParentNode */
export interface GanttGesture {
  notePath: string;
  edge: 'move' | 'start' | 'end';
  days: number;
  instanceId?: string;
}

export function performGanttGesture(
  args: GanttGesture,
  root: ParentNode | null = document.querySelector('.og-bases-gantt'),
): { pxPerDay: number; barWidth: number; moved: number } {
  const dragActivationDistance = 21;
  const bar = Array.from(root?.querySelectorAll('.wx-bars > .wx-bar') ?? [])
    .find(element => args.instanceId
      ? element.getAttribute('data-id') === args.instanceId
      : element.getAttribute('data-id')?.endsWith(args.notePath));
  if (!bar) throw new Error(`Missing bar ${args.notePath}`);
  const rows = root?.querySelectorAll('.wx-scale .wx-row');
  const cell = rows?.[rows.length - 1]?.querySelector('.wx-cell');
  const pxPerDay = cell?.getBoundingClientRect().width ?? 0;
  const bars = bar.closest('.wx-bars');
  if (!bars || pxPerDay <= 0) throw new Error('Missing scale/bar container');
  const rect = bar.getBoundingClientRect();
  const startX = args.edge === 'start' ? rect.left + 2 : args.edge === 'end' ? rect.right - 2 : rect.left + rect.width / 2;
  const dx = args.days * pxPerDay;
  const send = (target: EventTarget, type: string, clientX: number) => target.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, clientX, clientY: rect.top + rect.height / 2,
  }));
  send(bar, 'mousedown', startX);
  send(bars, 'mousemove', startX + Math.sign(dx) * Math.max(Math.abs(dx), dragActivationDistance));
  send(bars, 'mousemove', startX + dx);
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return { pxPerDay, barWidth: rect.width, moved: dx };
}
