import { DEFAULT_SETTINGS, FORMS, normalizeSettings, type FieldSettings } from '../shared/field.ts';
import { ParticleField } from './particle-field.ts';
import { MeshControls } from './controls.ts';

const STORAGE_KEY = 'mesh.field.v1';

export class MeshApp extends HTMLElement {
  private settings: FieldSettings = { ...DEFAULT_SETTINGS };
  private lifetime?: AbortController;

  connectedCallback() {
    this.lifetime = new AbortController();
    const { signal } = this.lifetime;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    this.settings.paused = media.matches;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) this.settings = normalizeSettings(JSON.parse(stored), this.settings);
      if (media.matches) this.settings.paused = true;
    } catch { /* Storage is optional. */ }
    this.addEventListener('mesh-settings', event => this.configure((event as CustomEvent).detail), { signal });
    this.addEventListener('mesh-error', event => { this.querySelector('.field-message')!.textContent = (event as CustomEvent).detail; }, { signal });
    window.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || (event.target as Element)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      const form = FORMS[Number(event.key) - 1];
      if (form) { event.preventDefault(); this.configure({ form }); }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        this.configure({ form: FORMS[(FORMS.indexOf(this.settings.form) + step + FORMS.length) % FORMS.length]! });
      }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); this.action('reset'); }
      if (event.code === 'Space' && !(event.target as Element)?.closest('button,a')) { event.preventDefault(); this.action('pause'); }
    }, { signal });
    media.addEventListener('change', event => { if (event.matches) this.configure({ paused: true }); }, { signal });
    this.reflect();
    // Children are upgraded after this custom element, or may already exist.
    customElements.whenDefined('particle-field').then(() => { if (this.isConnected) this.field?.configure(this.settings); });
    customElements.whenDefined('mesh-controls').then(() => { if (this.isConnected) this.controls?.reflect(this.settings); });
  }

  disconnectedCallback() { this.lifetime?.abort(); }
  private get field() { return this.querySelector<ParticleField>('particle-field'); }
  private get controls() { return this.querySelector<MeshControls>('mesh-controls'); }

  private configure(input: Partial<FieldSettings>) {
    this.settings = normalizeSettings(input, this.settings); this.reflect(); this.field?.configure(this.settings);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* Storage is optional. */ }
  }

  private reflect() {
    this.querySelector<HTMLElement>('.gallery')!.dataset.paused = String(this.settings.paused);
    if (this.controls instanceof MeshControls) this.controls.reflect(this.settings);
  }

  private async action(action: string) {
    if (action === 'pause') this.configure({ paused: !this.settings.paused });
    if (action === 'reset') this.field?.reset();
  }
}
