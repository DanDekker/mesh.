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
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) this.settings = normalizeSettings(JSON.parse(stored), this.settings);
    } catch { /* Storage is optional. */ }
    this.addEventListener('mesh-settings', event => this.configure((event as CustomEvent).detail), { signal });
    this.addEventListener('mesh-error', event => { this.querySelector('.field-message')!.textContent = (event as CustomEvent).detail; }, { signal });
    this.addEventListener('mesh-fps', event => { this.querySelector('.fps')!.textContent = `${(event as CustomEvent<number>).detail} fps`; }, { signal });
    window.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || (event.target as Element)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      const form = FORMS[Number(event.key) - 1];
      if (form) { event.preventDefault(); this.configure({ form }); }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        this.configure({ form: FORMS[(FORMS.indexOf(this.settings.form) + step + FORMS.length) % FORMS.length]! });
      }
    }, { signal });
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
    if (this.controls instanceof MeshControls) this.controls.reflect(this.settings);
  }
}
