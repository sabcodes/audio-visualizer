import type { VisualMode } from './types';
import { sceneDefaults, disposeScene } from './shared';
import { seededRandom } from '../rendering/diagnostics';

export function createErrorMode(): VisualMode {
  const { scene, camera } = sceneDefaults();
  const root = document.createElement('div'); root.id = 'viewport-errors'; root.className = 'vintage-overlay';
  root.setAttribute('aria-label', 'Vintage simulated installation windows');
  document.body.appendChild(root);
  const random = seededRandom(42);
  const windows: { el: HTMLDivElement; bar: HTMLDivElement; progress: number; speed: number; phase: number; abort: AbortController }[] = [];
  let elapsed = 0, lastSpawn = 0;
  function remove(index: number) {
    const window = windows.splice(index, 1)[0]; if (!window) return;
    window.abort.abort(); window.el.remove();
  }
  function spawn() {
    if (windows.length >= 7) remove(0);
    const el = document.createElement('div'); el.className = 'win95-window';
    const title = document.createElement('div'); title.className = 'win95-title';
    const caption = document.createElement('span'); caption.textContent = ['Copying...', 'Installing...', 'System', 'Setup', 'Explorer'][Math.floor(random() * 5)];
    const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss simulated window');
    title.append(caption, close);
    const message = document.createElement('p'); message.textContent = 'Please wait... Preparing files...';
    const track = document.createElement('div'); track.className = 'win95-progress';
    const bar = document.createElement('div'); track.appendChild(bar);
    el.append(title, message, track); root.appendChild(el);
    const abort = new AbortController(), signal = abort.signal;
    const state = { el, bar, progress: random() * 40, speed: 8 + random() * 8, phase: random() * Math.PI * 2, abort };
    windows.push(state);
    el.style.left = `${random() * Math.max(0, innerWidth - el.offsetWidth)}px`;
    el.style.top = `${random() * Math.max(0, innerHeight - el.offsetHeight)}px`;
    let drag: { id: number; dx: number; dy: number } | undefined;
    close.addEventListener('click', () => remove(windows.indexOf(state)), { signal });
    title.addEventListener('pointerdown', (event) => {
      if (event.target === close) return;
      const r = el.getBoundingClientRect(); drag = { id: event.pointerId, dx: event.clientX - r.left, dy: event.clientY - r.top };
      title.setPointerCapture(event.pointerId); event.preventDefault();
    }, { signal });
    title.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      el.style.left = `${Math.max(0, Math.min(innerWidth - el.offsetWidth, event.clientX - drag.dx))}px`;
      el.style.top = `${Math.max(0, Math.min(innerHeight - el.offsetHeight, event.clientY - drag.dy))}px`;
    }, { signal });
    const end = () => { drag = undefined; };
    title.addEventListener('pointerup', end, { signal }); title.addEventListener('pointercancel', end, { signal }); title.addEventListener('lostpointercapture', end, { signal });
  }
  spawn(); spawn();
  return {
    scene, camera,
    update(frame) {
      elapsed += frame.delta;
      if ((frame.audio.onset && elapsed - lastSpawn > 0.45) || elapsed - lastSpawn > 2.5) { spawn(); lastSpawn = elapsed; }
      for (const window of windows) {
        window.progress = (window.progress + window.speed * (1 + frame.response.bounce * 2) * frame.delta) % 100;
        window.phase += frame.delta * (2 + frame.audio.highs * 18);
        window.bar.style.width = `${window.progress}%`;
        const wobble = frame.reducedMotion ? 0 : 3 + frame.response.impact * 12;
        window.el.style.transform = `translate(${Math.sin(window.phase) * wobble}px, ${Math.cos(window.phase * 0.7) * wobble}px)`;
        window.el.style.left = `${Math.max(0, Math.min(innerWidth - window.el.offsetWidth, parseFloat(window.el.style.left)))}px`;
        window.el.style.top = `${Math.max(0, Math.min(innerHeight - window.el.offsetHeight, parseFloat(window.el.style.top)))}px`;
      }
    },
    dispose() { while (windows.length) remove(0); root.remove(); disposeScene(scene); },
  };
}
