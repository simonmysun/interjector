import type { CompletionPreset } from './@types';

/**
 * One completion column, bound to a single prompt preset.
 *
 * Follows the "DOM as state" principle: the button's own text (Complete/Abort)
 * is the source of truth for whether a run is in progress, and the history is
 * simply the accumulated child nodes of the scrollable body. Each press of the
 * button triggers a fresh completion whose streamed output is appended as a new
 * entry below the previous ones, so the body scrolls through the full history.
 */
class CompletionPanel {
  readonly preset: CompletionPreset;

  private rootDom: HTMLDivElement;
  private buttonDom: HTMLButtonElement;
  private bodyDom: HTMLDivElement;

  /** DOM node the currently-streaming completion is being appended into. */
  private currentEntryDom: HTMLDivElement | null = null;

  /** Loading placeholder shown until the first token of a run arrives. */
  private loadingDom: HTMLSpanElement | null = null;

  private completeListeners: (() => void)[] = [];
  private abortListeners: (() => void)[] = [];

  constructor(preset: CompletionPreset) {
    this.preset = preset;

    this.rootDom = document.createElement('div');
    this.rootDom.className = 'completion-panel';

    const header = document.createElement('div');
    header.className = 'completion-panel-header';

    const title = document.createElement('span');
    title.className = 'completion-panel-title';
    title.textContent = preset.label;

    this.buttonDom = document.createElement('button');
    this.buttonDom.type = 'button';
    this.buttonDom.className = 'completion-panel-btn';
    this.buttonDom.textContent = 'Complete';
    this.buttonDom.addEventListener('click', () => {
      // DOM-as-state: the label tells us which action the click means.
      if (this.buttonDom.textContent === 'Abort') {
        this.emitAbort();
      } else {
        this.emitComplete();
      }
    });

    header.appendChild(title);
    header.appendChild(this.buttonDom);

    this.bodyDom = document.createElement('div');
    this.bodyDom.className = 'completion-panel-body';

    this.rootDom.appendChild(header);
    this.rootDom.appendChild(this.bodyDom);
  }

  /** The panel's root element, to be inserted into the completions container. */
  get element(): HTMLDivElement {
    return this.rootDom;
  }

  onComplete(callback: () => void): void {
    this.completeListeners.push(callback);
  }

  onAbort(callback: () => void): void {
    this.abortListeners.push(callback);
  }

  private emitComplete(): void {
    for (const cb of this.completeListeners) {
      cb();
    }
  }

  private emitAbort(): void {
    for (const cb of this.abortListeners) {
      cb();
    }
  }

  /** True while a completion is streaming into this panel. */
  get isRunning(): boolean {
    return this.currentEntryDom !== null;
  }

  /**
   * Begin a new completion run: switch the button to Abort and open a fresh
   * history entry that subsequent tokens append to.
   */
  begin(): void {
    this.buttonDom.textContent = 'Abort';
    const entry = document.createElement('div');
    entry.className = 'completion';
    // Show a loading indicator until the first token arrives.
    const loading = document.createElement('span');
    loading.className = 'completion-loading';
    loading.textContent = 'Thinking';
    entry.appendChild(loading);
    this.loadingDom = loading;
    this.currentEntryDom = entry;
    this.bodyDom.appendChild(entry);
    this.scrollToBottom();
  }

  /** Append one streamed token to the in-progress entry. */
  appendToken(token: string): void {
    if (!this.currentEntryDom) {
      return;
    }
    // Drop the loading placeholder as soon as real output starts.
    if (this.loadingDom) {
      this.loadingDom.remove();
      this.loadingDom = null;
    }
    const tokenDom = document.createElement('span');
    tokenDom.className = 'token';
    tokenDom.textContent = token;
    this.currentEntryDom.appendChild(tokenDom);
    this.scrollToBottom();
  }

  /** Mark the in-progress entry as errored (kept in history). */
  appendError(message: string): void {
    if (this.loadingDom) {
      this.loadingDom.remove();
      this.loadingDom = null;
    }
    const target = this.currentEntryDom ?? this.bodyDom;
    const errDom = document.createElement('div');
    errDom.className = 'completion-error';
    errDom.textContent = message;
    target.appendChild(errDom);
    this.scrollToBottom();
  }

  /** Finish the current run: restore the button and close the entry. */
  finish(): void {
    this.buttonDom.textContent = 'Complete';
    // If the run ended before producing any output, replace the placeholder
    // with a note so the entry doesn't stay stuck on "Thinking".
    if (this.loadingDom) {
      this.loadingDom.className = 'completion-empty';
      this.loadingDom.textContent = '(no output)';
      this.loadingDom = null;
    }
    this.currentEntryDom = null;
  }

  /**
   * Keep the newest output visible as tokens stream in. The panel body is its
   * own capped, scrollable region, so we scroll it (not the column) to bottom.
   */
  private scrollToBottom(): void {
    this.bodyDom.scrollTop = this.bodyDom.scrollHeight;
  }
}

export default CompletionPanel;
