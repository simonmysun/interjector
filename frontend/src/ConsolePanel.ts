type ConsolePanelEventName = 'start' | 'stop' | 'clear' | 'complete' | 'abort';

/**
 * Manages the control bar. Button labels/states are driven directly by the DOM
 * (DOM-as-state, F-UI-3): e.g. the start button text distinguishes Start/Stop,
 * the complete button text distinguishes Complete/Abort.
 */
class ConsolePanel {
  private startBtnDom: HTMLButtonElement;
  private clearBtnDom: HTMLButtonElement;
  private runningIndicatorDom: HTMLDivElement;
  private audioIndicatorDom: HTMLDivElement;
  private soundIndicatorDom: HTMLDivElement;
  private speechIndicatorDom: HTMLDivElement;
  private completeBtnDom: HTMLButtonElement;
  private statusDom: HTMLDivElement | null;

  private eventListeners: { [eventName in ConsolePanelEventName]: { (): void }[] };

  constructor() {
    this.startBtnDom = document.getElementById('start-btn') as HTMLButtonElement;
    this.clearBtnDom = document.getElementById('clear-btn') as HTMLButtonElement;
    this.runningIndicatorDom = document.getElementById('running-indicator') as HTMLDivElement;
    this.audioIndicatorDom = document.getElementById('audio-indicator') as HTMLDivElement;
    this.soundIndicatorDom = document.getElementById('sound-indicator') as HTMLDivElement;
    this.speechIndicatorDom = document.getElementById('speech-indicator') as HTMLDivElement;
    this.completeBtnDom = document.getElementById('complete-btn') as HTMLButtonElement;
    this.statusDom = document.getElementById('status') as HTMLDivElement | null;
    this.eventListeners = {
      start: [],
      stop: [],
      clear: [],
      complete: [],
      abort: [],
    };

    this.startBtnDom.addEventListener('click', () => {
      this.emit(this.startBtnDom.textContent === 'Start' ? 'start' : 'stop');
    });
    this.clearBtnDom.addEventListener('click', () => this.emit('clear'));
    this.completeBtnDom.addEventListener('click', () => {
      this.emit(this.completeBtnDom.textContent === 'Abort' ? 'abort' : 'complete');
    });
  }

  private emit(event: ConsolePanelEventName): void {
    for (const callback of this.eventListeners[event]) {
      callback();
    }
  }

  on(event: ConsolePanelEventName, callback: () => void): void {
    this.eventListeners[event].push(callback);
  }

  start(): void {
    this.deactiveClearBtn();
    this.activeRunningIndicator();
    this.startBtnDom.textContent = 'Stop';
  }

  reset(): void {
    this.deactiveRunningIndicator();
    this.deactiveAudioIndicator();
    this.deactiveSoundIndicator();
    this.deactiveSpeechIndicator();
    this.activeClearBtn();
    this.startBtnDom.textContent = 'Start';
  }

  /** Switch the Complete button into its Abort state while a completion runs (F-03-4). */
  completing(): void {
    this.completeBtnDom.textContent = 'Abort';
  }

  doneCompleting(): void {
    this.completeBtnDom.textContent = 'Complete';
  }

  setStatus(message: string, isError = false): void {
    if (!this.statusDom) {
      return;
    }
    this.statusDom.textContent = message;
    this.statusDom.classList.toggle('error', isError);
  }

  clearStatus(): void {
    if (this.statusDom) {
      this.statusDom.textContent = '';
      this.statusDom.classList.remove('error');
    }
  }

  activeRunningIndicator(): void {
    this.runningIndicatorDom.classList.add('active');
  }
  deactiveRunningIndicator(): void {
    this.runningIndicatorDom.classList.remove('active');
  }
  activeAudioIndicator(): void {
    this.audioIndicatorDom.classList.add('active');
  }
  deactiveAudioIndicator(): void {
    this.audioIndicatorDom.classList.remove('active');
  }
  activeSoundIndicator(): void {
    this.soundIndicatorDom.classList.add('active');
  }
  deactiveSoundIndicator(): void {
    this.soundIndicatorDom.classList.remove('active');
  }
  activeSpeechIndicator(): void {
    this.speechIndicatorDom.classList.add('active');
  }
  deactiveSpeechIndicator(): void {
    this.speechIndicatorDom.classList.remove('active');
  }

  /** Enable the Clear button. (Previous implementation had this inverted, §4.3 #13.) */
  activeClearBtn(): void {
    this.clearBtnDom.disabled = false;
  }
  /** Disable the Clear button. */
  deactiveClearBtn(): void {
    this.clearBtnDom.disabled = true;
  }
}

export default ConsolePanel;
