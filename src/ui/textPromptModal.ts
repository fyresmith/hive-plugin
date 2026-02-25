import { App, Modal, Setting } from 'obsidian';

interface TextPromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
}

class TextPromptModal extends Modal {
  private resolveRef: (value: string | null) => void;
  private submitted = false;
  private value = '';
  private readonly options: TextPromptOptions;

  constructor(app: App, options: TextPromptOptions, resolve: (value: string | null) => void) {
    super(app);
    this.options = options;
    this.resolveRef = resolve;
    this.value = options.initialValue ?? '';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: this.options.title });
    if (this.options.description) {
      contentEl.createEl('p', { text: this.options.description });
    }

    let inputEl: HTMLInputElement | null = null;
    new Setting(contentEl).addText((text) => {
      text
        .setPlaceholder(this.options.placeholder ?? '')
        .setValue(this.options.initialValue ?? '')
        .onChange((value) => {
          this.value = value;
        });
      inputEl = text.inputEl;
      text.inputEl.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') {
          evt.preventDefault();
          this.submit();
        }
      });
    });

    const actions = contentEl.createDiv({ cls: 'hive-modal-actions' });
    const submit = actions.createEl('button', {
      cls: 'mod-cta',
      text: this.options.submitLabel ?? 'Continue',
    });
    submit.addEventListener('click', () => this.submit());

    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());

    window.setTimeout(() => inputEl?.focus(), 0);
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (!this.submitted) {
      this.resolveRef(null);
    }
  }

  private submit(): void {
    this.submitted = true;
    this.resolveRef(this.value.trim());
    this.close();
  }
}

export function promptForText(app: App, options: TextPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new TextPromptModal(app, options, resolve);
    modal.open();
  });
}
