import { type FieldSettings, type Form } from '../shared/field.ts';

export class MeshControls extends HTMLElement {
  private lifetime?: AbortController;

  connectedCallback() {
    this.lifetime = new AbortController();
    this.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('[data-form]');
      if (button) this.dispatchEvent(new CustomEvent('mesh-settings', { detail: { form: button.dataset.form as Form }, bubbles: true }));
    }, { signal: this.lifetime.signal });
  }

  disconnectedCallback() { this.lifetime?.abort(); }

  reflect(settings: FieldSettings) {
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-form]')) {
      const active = button.dataset.form === settings.form;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
}
