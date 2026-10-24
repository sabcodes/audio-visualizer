import type { AudioEngine, AudioState } from '../audio/AudioEngine';

export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const s = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  return total >= 3600 ? `${Math.floor(total / 3600)}:${String(minutes % 60).padStart(2, '0')}:${s}` : `${minutes}:${s}`;
}

/** Owns player subscriptions and DOM listeners, never renderer internals. */
export class ControlPanel {
  private readonly abort = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly play: HTMLButtonElement;
  private readonly seek: HTMLInputElement;
  private seeking = false;
  private state: Readonly<AudioState>;
  constructor(private readonly audio: AudioEngine, private readonly changed: () => void) {
    const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    this.play = get('play-btn');
    this.seek = get('seek-slider');
    this.state = audio.state;
    const options = { signal: this.abort.signal };
    get<HTMLInputElement>('audio-upload').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) { audio.load(file); changed(); }
      input.value = '';
    }, options);
    this.play.addEventListener('click', () => { void this.togglePlayback(); }, options);
    this.seek.addEventListener('input', () => {
      this.seeking = true;
      get('time-current').textContent = formatTime(Number(this.seek.value));
    }, options);
    this.seek.addEventListener('change', () => {
      audio.seek(Number(this.seek.value));
      this.seeking = false;
      this.refresh();
      changed();
    }, options);
    this.unsubscribe = audio.subscribe((state) => {
      const statusChanged = this.state.status !== state.status;
      this.state = state;
      get('track-name').textContent = state.trackName || 'No track loaded';
      get('audio-status').textContent = state.error ? `Playback error: ${state.error} Retry Play or load another file.` : state.status === 'empty' ? 'Silent startup · load a local audio file to begin.' : `${state.status} · audio remains local`;
      get('audio-status').dataset.state = state.status;
      this.play.disabled = state.status === 'empty' || state.status === 'loading';
      this.play.textContent = state.status === 'playing' ? 'Pause' : state.status === 'ended' ? 'Replay' : 'Play';
      this.play.setAttribute('aria-pressed', String(state.status === 'playing'));
      this.seek.disabled = !state.duration || state.status === 'loading';
      this.seek.max = String(state.duration);
      get('time-total').textContent = formatTime(state.duration);
      this.refresh();
      if (statusChanged) changed();
    });
  }
  async togglePlayback() {
    if (this.play.disabled) return;
    if (this.audio.state.status === 'playing') this.audio.pause();
    else { try { await this.audio.play(); } catch { /* Engine publishes the actionable error. */ } }
    this.changed();
  }
  refresh() {
    if (this.seeking) return;
    this.seek.value = String(this.state.currentTime);
    document.getElementById('time-current')!.textContent = formatTime(this.state.currentTime);
  }
  dispose() { this.abort.abort(); this.unsubscribe(); }
}
