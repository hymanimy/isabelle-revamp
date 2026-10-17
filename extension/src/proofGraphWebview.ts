import { edgePath, graphLayout, GraphLayout, fitGraph } from './graphLayout';
import type { GraphFrame, GraphNode, GraphState } from './graphTypes';
import { graphSummary } from './graphTypes';
import { replaySpeed, replayTimeline } from './graphReplay';

declare function acquireVsCodeApi(): { postMessage(value: unknown): void };
const host = acquireVsCodeApi(), ns = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('graph') as unknown as SVGSVGElement;
const viewport = document.getElementById('viewport')!;
const layers = { nodes: document.getElementById('nodes')!, edges: document.getElementById('edges')!, containers: document.getElementById('containers')! };
const status = document.getElementById('status')!;
const foldControl = document.getElementById('fold') as HTMLInputElement;
const speedControl = document.getElementById('speed') as HTMLSelectElement;
const elements = new Map<string, SVGGElement>(), edges = new Map<string, SVGPathElement>();
const painted = new Map<string, string>(), located = new Map<string, string>();
const hidden = new Set<string>(), folding = new Map<string, ReturnType<typeof setTimeout>>();
const pulsed = new Set<string>(), fades = new Set<string>();
let state: GraphState | undefined, live: GraphState | undefined, topology = '', layoutKey = '';
let positions: GraphLayout = { nodes: [], containers: [], width: 1, height: 1 };
let inspected: string | undefined;
let scale = 1, tx = 0, ty = 0, scheduled = false, speed = 1, playing = false, generation = 0;
let layoutCount = 0, pulseCount = 0, edgePulseCount = 0, foldCount = 0, fitCount = 0;
let foldProved = false;
let replayEvents: { id: string; at: number }[] = [];
const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));

function element<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const item = document.createElementNS(ns, tag);
  for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, String(value));
  return item;
}
function transform(): void { viewport.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`); }
function fit(): void {
  fitCount++;
  const bounds = svg.getBoundingClientRect();
  ({ scale, tx, ty } = fitGraph(positions, bounds.width, bounds.height));
  transform();
}
function reset(): void {
  for (const timer of folding.values()) clearTimeout(timer);
  folding.clear(); hidden.clear(); pulsed.clear(); fades.clear(); painted.clear(); layoutKey = ''; topology = '';
}
function children(id: string): GraphNode[] { return state?.nodes.filter(node => node.parent === id) ?? []; }
function pulse(id: string): void {
  if (pulsed.has(id)) return;
  pulsed.add(id); pulseCount++;
  const node = elements.get(id); node?.classList.add('pulse');
  for (const edge of edges.values()) if (edge.dataset.from === id) { edge.classList.add('pulse'); edgePulseCount++; }
  setTimeout(() => {
    node?.classList.remove('pulse');
    for (const edge of edges.values()) if (edge.dataset.from === id) edge.classList.remove('pulse');
  }, 420);
}
function flush(): void {
  if (!scheduled) return;
  scheduled = false; if (state) render(state);
}
function schedule(): void {
  if (scheduled) return;
  // Batch visible DOM changes at the start of a frame. Hidden tabs suspend
  // frames, but logical fold completion must still advance there.
  scheduled = true;
  if (document.hidden) setTimeout(flush, 0); else requestAnimationFrame(flush);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && scheduled) setTimeout(flush, 0); });
function accepted(): void {
  if (!state) return;
  for (const node of state.nodes) {
    if (node.status !== 'proved' || hidden.has(node.id)) continue;
    if (!foldProved) { pulse(node.id); continue; }
    if (children(node.id).some(child => !hidden.has(child.id))) continue;
    pulse(node.id);
    if (node.id === inspected || node.id === state.focused && !state.fully_checked) continue;
    if (!node.parent || folding.has(node.id)) continue;
    folding.set(node.id, setTimeout(() => {
      const current = state?.nodes.find(item => item.id === node.id);
      if (current?.status !== 'proved' || children(node.id).some(child => !hidden.has(child.id))) { folding.delete(node.id); return; }
      fades.add(node.id); elements.get(node.id)?.classList.add('fading');
      folding.set(node.id, setTimeout(() => {
        folding.delete(node.id); fades.delete(node.id);
        if (state?.nodes.find(item => item.id === node.id)?.status === 'proved') { hidden.add(node.id); foldCount++; }
        schedule();
      }, 300 / speed));
    }, 1500 / speed));
  }
}
function ancestor(id: string, byId: Map<string, GraphNode>): string | undefined {
  while (hidden.has(id)) { const parent = byId.get(id)?.parent; if (!parent) return; id = parent; }
  return id;
}
function render(next: GraphState): void {
  if (state && (state.uri !== next.uri || state.epoch !== next.epoch)) reset();
  const focusChanged = state?.focused !== next.focused;
  if (focusChanged) inspected = state?.fully_checked && next.fully_checked ? next.focused : undefined;
  state = next;
  const byId = new Map(next.nodes.map(node => [node.id, node]));
  const key = JSON.stringify([next.uri, next.epoch, Math.floor(svg.clientWidth), next.nodes.map(node => [node.id, node.parent, node.name, node.line])]);
  const newTopology = topology !== key;
  if (newTopology) {
    topology = key;
    for (const id of [...hidden]) if (!byId.has(id)) hidden.delete(id);
  }
  for (const node of next.nodes) {
    if (node.status !== 'proved' || focusChanged && node.id === next.focused) {
      let id: string | null = node.id;
      while (id) { hidden.delete(id); if (node.status !== 'proved') pulsed.delete(id); id = byId.get(id)?.parent ?? null; }
      const timer = folding.get(node.id); if (timer) clearTimeout(timer);
      folding.delete(node.id); fades.delete(node.id);
    }
  }
  const visibleKey = key + JSON.stringify([...hidden].sort());
  const changed = layoutKey !== visibleKey;
  if (changed) {
    layoutKey = visibleKey;
    positions = graphLayout(next, hidden, svg.clientWidth - 16); layoutCount++;
    layers.containers.replaceChildren(...positions.containers.map(box => element('rect', { class: 'container', x: box.x, y: box.y, width: box.width, height: box.height })));
  }
  const visible = new Set(positions.nodes.map(box => box.id));
  for (const [id, item] of elements) if (!visible.has(id)) {
    item.remove(); elements.delete(id); painted.delete(id); located.delete(id);
  }
  for (const box of positions.nodes) {
    const node = byId.get(box.id)!;
    let item = elements.get(node.id);
    if (!item) {
      item = element('g', { tabindex: 0, role: 'button' }); item.dataset.id = node.id;
      const tile = element('g', { class: 'tile' }); tile.append(element('rect'), element('text', { class: 'name' }), element('text', { class: 'detail' }), element('text', { class: 'contains' }));
      item.append(element('title'), tile); elements.set(node.id, item); layers.nodes.append(item);
    }
    const location = [box.x, box.y, box.width, box.height].join(',');
    if (located.get(node.id) !== location) {
      located.set(node.id, location);
      item.setAttribute('transform', `translate(${box.x} ${box.y})`);
      const rect = item.querySelector('rect')!; rect.setAttribute('width', String(box.width)); rect.setAttribute('height', String(box.height));
      for (const text of item.querySelectorAll('text')) text.setAttribute('x', String(box.width / 2));
      item.querySelector('.name')!.setAttribute('y', '15');
      item.querySelector('.detail')!.setAttribute('y', String(box.height - (box.contained?.length ?? 0) * 16 - 6));
    }
    const contained = box.contained ?? [];
    const paint = JSON.stringify([node.status, node.line, next.focused === node.id, node.name, node.statement, node.agent, contained, box.nameLines, box.width, fades.has(node.id)]);
    if (painted.get(node.id) === paint) continue;
    painted.set(node.id, paint);
    item.setAttribute('class', `node ${node.status}${pulsed.has(node.id) && item.classList.contains('pulse') ? ' pulse' : ''}${fades.has(node.id) ? ' fading' : ''}${next.focused === node.id ? ' focused' : ''}`);
    item.querySelector('title')!.textContent = `${node.statement}\n${node.status}${node.agent ? ' · ' + node.agent : ''}`;
    const name = item.querySelector('.name') as SVGTextElement;
    const nameLayout = JSON.stringify([box.width, box.nameLines ?? [node.name]]);
    // Status updates recolour existing labels. Rebuilding SVG text during
    // each acceptance batch needlessly repeats font shaping and layout.
    if (name.dataset.layout !== nameLayout) {
      name.dataset.layout = nameLayout;
      name.replaceChildren(...(box.nameLines ?? [node.name]).map((text, index) => {
        const line = element('tspan', { x: box.width / 2, y: 14 + index * 13 }); line.textContent = text; return line;
      }));
    }
    item.querySelector('.detail')!.textContent = `L${node.line}${node.status === 'refuted' ? ' · refuted' : ''}`;
    item.querySelector('.contains')!.replaceChildren(...contained.map((name, index) => {
      const line = element('tspan', { x: box.width / 2, y: box.height - contained.length * 16 + 8 + index * 16 }); line.textContent = name; return line;
    }));
  }
  const boxes = new Map(positions.nodes.map(box => [box.id, box])), wanted = new Set<string>();
  for (const edge of next.edges) {
    const from = ancestor(edge.from, byId), to = ancestor(edge.to, byId);
    if (!from || !to || from === to || !boxes.has(from) || !boxes.has(to)) continue;
    const id = from + '\0' + to; if (wanted.has(id)) continue; wanted.add(id);
    let path = edges.get(id);
    if (!path) { path = element('path', { class: `edge ${edge.kind}` }); path.dataset.from = from; edges.set(id, path); layers.edges.append(path); }
    const geometry = edgePath(boxes.get(from)!, boxes.get(to)!);
    if (path.getAttribute('d') !== geometry) path.setAttribute('d', geometry);
  }
  for (const [id, item] of edges) if (!wanted.has(id)) { item.remove(); edges.delete(id); }
  status.textContent = graphSummary(next) + (playing ? ' · Replay ×' + speed : '');
  if (changed) fit();
  accepted();
}
function snapshot() {
  return { nodes: [...elements.keys()], hidden: [...hidden], statuses: Object.fromEntries(state?.nodes.map(node => [node.id, node.status]) ?? []),
    dashed: [...elements].filter(([, item]) => item.classList.contains('open')).map(([id]) => id),
    containers: positions.containers.length, edges: edges.size, layoutCount, pulseCount, edgePulseCount, foldCount, fitCount,
    foldProved, replaySpeed: replaySpeed(Number(speedControl.value)), replayEvents,
    focused: [...elements].filter(([, item]) => item.classList.contains('focused')).map(([id]) => id),
    bounds: { width: svg.clientWidth, height: svg.clientHeight, scale, tx, ty, graphWidth: positions.width, graphHeight: positions.height },
    labels: Object.fromEntries([...elements].map(([id, item]) => [id, item.querySelector('.detail')!.textContent])),
    names: Object.fromEntries([...elements].map(([id, item]) => [id, item.querySelector('.name')!.textContent])),
    contained: Object.fromEntries([...elements].map(([id, item]) => [id, [...item.querySelectorAll('.contains tspan')].map(line => line.textContent)])),
    readable: [...elements].every(([, item]) => [...item.querySelectorAll<SVGTSpanElement>('.name tspan')].every(text => text.getComputedTextLength() + 12 <= Number(item.querySelector('rect')!.getAttribute('width')))),
    fontPixels: 12 * scale, header: status.textContent, rootText: layers.nodes.textContent, playing, visible: document.visibilityState,
    window: { width: innerWidth, height: innerHeight, outerWidth, outerHeight } };
}
async function replay(frames: GraphFrame[]): Promise<ReturnType<typeof snapshot>> {
  const current = ++generation; playing = true; speed = replaySpeed(Number(speedControl.value)); reset();
  replayEvents = [];
  const started = performance.now(); let lastGreen = -Infinity;
  let previous = new Set<string>();
  for (const entry of replayTimeline(frames)) {
    const green = new Set(entry.state.nodes.filter(node => node.status === 'proved').map(node => node.id));
    const accepted = [...green].filter(id => !previous.has(id));
    const delay = Math.max(entry.at / speed - (performance.now() - started),
      accepted.length ? 400 / speed - (performance.now() - lastGreen) : 0);
    if (delay > 0) await pause(Math.ceil(delay));
    if (generation !== current) return snapshot();
    render(entry.state); previous = green;
    if (accepted.length) {
      lastGreen = performance.now();
      replayEvents.push(...accepted.map(id => ({ id, at: lastGreen - started })));
    }
  }
  const deadline = performance.now() + 10000;
  while (folding.size && performance.now() < deadline && generation === current) await pause(30);
  if (generation !== current) return snapshot();
  playing = false; speed = 1;
  if (live) render(live);
  fit();
  return snapshot();
}
async function benchmark() {
  const saved = live, current = ++generation; playing = true; speed = 1; reset();
  const nodes: GraphNode[] = Array.from({ length: 200 }, (_, i) => ({ id: 'mock-' + i, name: i ? 'step_' + i : 'Mock theorem', statement: 'Synthetic proof step ' + i,
    line: i + 1, command: i ? 'have' : 'theorem', parent: i ? 'mock-0' : null, range: [i, 0, i, 4], status: 'open' }));
  const mock: GraphState = { uri: 'mock', file: 'mock', version: 1, theory: '200-node animation check', nodes,
    edges: nodes.slice(1).map(node => ({ from: node.id, to: 'mock-0', kind: 'nesting' })), complete: true,
    fully_checked: false, proved: 0, total: 200, elapsed: 0 };
  render(mock); await frame();
  const baseline: number[] = []; let previous = await frame();
  for (let i = 0; i < 25; i++) { const time = await frame(); baseline.push(time - previous); previous = time; }
  const interval = [...baseline].sort((a, b) => a - b)[12];
  const gaps: number[] = []; let sampling = true;
  const measure = (time: number) => { gaps.push(time - previous); previous = time; if (sampling) requestAnimationFrame(measure); };
  requestAnimationFrame(measure);
  const initialLayouts = layoutCount, initialPulses = pulseCount;
  for (let batch = 0; batch < 10; batch++) {
    if (generation !== current) break;
    for (let i = batch * 20; i < (batch + 1) * 20; i++) nodes[i].status = 'proved';
    mock.proved = (batch + 1) * 20; mock.fully_checked = batch === 9; render(mock); await pause(100);
  }
  const colourLayouts = layoutCount - initialLayouts;
  await pause(2200); sampling = false; await frame();
  const result = { ...snapshot(), count: 200, frames: gaps.length, baselineMs: interval,
    maxGapMs: Math.max(...gaps), droppedFrames: gaps.filter(gap => gap > interval * 1.8).length,
    colourLayouts, pulses: pulseCount - initialPulses, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
  playing = false; reset(); if (saved) render(saved);
  return result;
}

foldControl.addEventListener('change', () => {
  foldProved = foldControl.checked; reset(); if (state) render(state);
});
document.getElementById('fit')!.addEventListener('click', fit);
document.getElementById('fullscreen')!.addEventListener('click', () => host.postMessage({ type: 'fullscreen' }));
document.getElementById('replay')!.addEventListener('click', () => host.postMessage({ type: 'replay' }));
function select(event: Event): void {
  if (playing || !state) return;
  const node = (event.target as Element).closest<SVGGElement>('.node');
  if (node) host.postMessage({ type: 'select', uri: state.uri, version: state.version, id: node.dataset.id });
}
svg.addEventListener('click', select);
svg.addEventListener('mouseover', event => {
  const node = (event.target as Element).closest<SVGGElement>('.node');
  if (node && state && !playing && !(event.relatedTarget instanceof Node && node.contains(event.relatedTarget))) {
    host.postMessage({ type: 'hover', uri: state.uri, version: state.version, id: node.dataset.id });
  }
});
svg.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event); } });
let drag: { x: number; y: number; tx: number; ty: number } | undefined;
svg.addEventListener('pointerdown', event => {
  if ((event.target as Element).closest('.node')) return;
  drag = { x: event.clientX, y: event.clientY, tx, ty }; svg.setPointerCapture(event.pointerId);
});
svg.addEventListener('pointermove', event => { if (drag) { tx = drag.tx + event.clientX - drag.x; ty = drag.ty + event.clientY - drag.y; transform(); } });
svg.addEventListener('pointerup', () => { drag = undefined; });
svg.addEventListener('wheel', event => {
  event.preventDefault(); const bounds = svg.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
  const next = Math.max(.03, Math.min(4, scale * Math.exp(-event.deltaY * .001)));
  tx = x - (x - tx) * next / scale; ty = y - (y - ty) * next / scale; scale = next; transform();
}, { passive: false });
window.addEventListener('resize', () => { if (state) render(state); fit(); });
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'demo') {
    document.body.classList.add('demo');
    foldControl.checked = false; foldProved = false; speedControl.value = '2';
    reset(); if (state) render(state); fit();
    return;
  }
  if (message.type === 'state') {
    if (playing && live && (live.uri !== message.state.uri || live.epoch !== message.state.epoch)) {
      generation++; playing = false; speed = 1; reset();
    }
    live = message.state; if (!playing) render(message.state);
  }
  else if (message.type === 'hover' && state && state.uri === message.uri && state.version === message.version) {
    const node = state.nodes.find(node => node.id === message.id);
    if (node) elements.get(node.id)?.querySelector('title')?.replaceChildren(document.createTextNode(node.statement + '\n\n' + message.text));
  }
  else if (message.type === 'replay') void replay(message.frames);
  else if (message.type === 'inspect') {
    const options = message.options;
    if (options) {
      if (typeof options.fold === 'boolean' && foldControl.checked !== options.fold) foldControl.click();
      if (options.speed !== undefined) speedControl.value = String(replaySpeed(options.speed));
      if (options.width !== undefined) document.body.style.width = options.width ? options.width + 'px' : '';
      if (options.height !== undefined) document.body.style.height = options.height ? options.height + 'px' : '';
      if (state) render(state); fit();
    }
    const result = message.action === 'benchmark' ? benchmark() : message.action === 'replay' ? replay(message.frames) : Promise.resolve(snapshot());
    void result.then(value => host.postMessage({ type: 'receipt', request: message.request, result: value }))
      .catch(error => host.postMessage({ type: 'receipt', request: message.request, result: { error: String(error) } }));
  }
});
host.postMessage({ type: 'ready' });
