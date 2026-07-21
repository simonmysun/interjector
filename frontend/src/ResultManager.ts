type ResultManagerEventName = 'cleared';

/**
 * Owns the transcript / translation / completion DOM regions.
 *
 * Follows the "DOM as state" principle (F-UI-1..4): the DOM elements are the
 * single source of truth. There are no JS mirror variables for the current
 * transcript text; readers query the DOM directly. All dynamic content is
 * inserted via `textContent` / `createElement` to eliminate the XSS vector
 * that the previous `innerHTML +=` implementation had (F-05-1).
 */
class ResultManager {
  private transcriptDom: HTMLDivElement;
  private transcriptTranslatedDom: HTMLDivElement;
  private transcriptFinalDom: HTMLDivElement;
  private transcriptOnGoingDom: HTMLDivElement;
  private transcriptTranslatedFinalDom: HTMLDivElement;
  private transcriptTranslatedOnGoingDom: HTMLDivElement;
  private completionsDom: HTMLDivElement;

  /** Last rendered speaker index, so we only print a label when it changes. */
  private lastSpeaker: number | undefined = undefined;

  private eventListeners: { [eventName in ResultManagerEventName]: { (event?: unknown): void }[] };

  constructor() {
    this.transcriptDom = document.getElementById('transcript') as HTMLDivElement;
    this.transcriptTranslatedDom = document.getElementById('transcript-translated') as HTMLDivElement;
    this.transcriptFinalDom = document.getElementById('transcript-final') as HTMLDivElement;
    this.transcriptOnGoingDom = document.getElementById('transcript-ongoing') as HTMLDivElement;
    this.transcriptTranslatedFinalDom = document.getElementById('transcript-translated-final') as HTMLDivElement;
    this.transcriptTranslatedOnGoingDom = document.getElementById('transcript-translated-ongoing') as HTMLDivElement;
    this.completionsDom = document.getElementById('completions') as HTMLDivElement;
    this.eventListeners = {
      cleared: [],
    };
  }

  on(event: ResultManagerEventName, callback: (event?: unknown) => void): void {
    this.eventListeners[event].push(callback);
  }

  private emit(event: ResultManagerEventName, eventObject?: unknown): void {
    for (const callback of this.eventListeners[event]) {
      callback(eventObject);
    }
  }

  /** Build a transcript chip. Uses textContent so user/ASR text is never parsed as HTML. */
  private createItem(text: string, isFinal: boolean): HTMLSpanElement {
    const item = document.createElement('span');
    item.className = `transcript-item ${isFinal ? 'final' : 'not-final'}`;
    item.textContent = text;
    return item;
  }

  clearTranscript(): void {
    this.transcriptFinalDom.replaceChildren();
    this.transcriptOnGoingDom.replaceChildren();
    this.transcriptTranslatedFinalDom.replaceChildren();
    this.transcriptTranslatedOnGoingDom.replaceChildren();
    this.lastSpeaker = undefined;
    this.emit('cleared');
  }

  /**
   * Append a finalised transcript segment. When a `speaker` index is supplied
   * (diarization / 角色识别), a speaker label is prefixed and a line break is
   * inserted so each speaker turn is visually separated.
   */
  addFinalTranscript(transcript: string, speaker?: number): void {
    if (speaker !== undefined && speaker !== this.lastSpeaker) {
      const label = document.createElement('span');
      label.className = 'speaker-label';
      label.textContent = `Speaker ${speaker}: `;
      if (this.transcriptFinalDom.childNodes.length > 0) {
        this.transcriptFinalDom.appendChild(document.createElement('br'));
      }
      this.transcriptFinalDom.appendChild(label);
      this.lastSpeaker = speaker;
    }
    this.transcriptFinalDom.appendChild(this.createItem(transcript, true));
    this.transcriptFinalDom.appendChild(document.createTextNode(' '));
    this.scrollToBottomTranscript();
  }

  /** Replace the in-progress transcript region with the given interim text. */
  setOnGoingTranscript(transcript: string): void {
    this.transcriptOnGoingDom.replaceChildren(this.createItem(transcript, false));
  }

  setOnGoingTranscriptTranslation(translatedTranscript: string): void {
    this.transcriptTranslatedOnGoingDom.replaceChildren(this.createItem(translatedTranscript, false));
    this.scrollToBottomTranslatedTranscript();
  }

  addTranslatedTranscript(transcript: string): void {
    this.transcriptTranslatedFinalDom.appendChild(this.createItem(transcript, true));
    this.scrollToBottomTranslatedTranscript();
  }

  /**
   * Read the current transcript straight from the DOM (DOM-as-state, F-UI-1).
   * No mirror variable is maintained.
   */
  getTranscript(): string {
    const final = this.transcriptFinalDom.innerText.trim();
    const ongoing = this.transcriptOnGoingDom.innerText.trim();
    return `${final} ${ongoing}`.trim();
  }

  /** Read the current interim transcript directly from the DOM. */
  getOnGoingTranscript(): string {
    return this.transcriptOnGoingDom.innerText.trim();
  }

  addCompletion(completionDom: HTMLDivElement): void {
    this.completionsDom.appendChild(completionDom);
    this.scrollToBottomCompletions();
  }

  scrollToBottomCompletions(): void {
    this.completionsDom.scrollTop = this.completionsDom.scrollHeight;
  }

  scrollToBottomTranscript(): void {
    this.transcriptDom.scrollTop = this.transcriptDom.scrollHeight;
  }

  scrollToBottomTranslatedTranscript(): void {
    this.transcriptTranslatedDom.scrollTop = this.transcriptTranslatedDom.scrollHeight;
  }
}

export default ResultManager;
