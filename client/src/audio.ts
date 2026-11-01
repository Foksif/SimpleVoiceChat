let ctx: AudioContext | null = null;

/** Один общий AudioContext на всё приложение (48 кГц — родная частота Opus). */
export function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    const resume = () => {
      if (ctx && ctx.state !== 'running') void ctx.resume();
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }
  return ctx;
}

export function createAnalyser(source: AudioNode): AnalyserNode {
  const analyser = getCtx().createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  return analyser;
}

/**
 * Воспроизведение голоса одного участника с регулируемой громкостью (0..2, т.е. до 200%).
 * Анализатор подключён ДО регулятора громкости, поэтому индикатор речи
 * не зависит от локального ползунка.
 */
export class RemotePlayer {
  readonly analyser: AnalyserNode;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly gain: GainNode;
  private readonly el: HTMLAudioElement;

  constructor(stream: MediaStream, volume: number) {
    const c = getCtx();
    // Chrome/WebView2 не отдаёт звук удалённого WebRTC-потока в WebAudio,
    // пока поток не подключён к медиа-элементу. Элемент заглушён — звук идёт через gain.
    this.el = new Audio();
    this.el.srcObject = stream;
    this.el.muted = true;
    void this.el.play().catch(() => {});

    this.source = c.createMediaStreamSource(stream);
    this.gain = c.createGain();
    this.gain.gain.value = volume;
    this.analyser = createAnalyser(this.source);
    this.source.connect(this.gain);
    this.gain.connect(c.destination);
  }

  setVolume(v: number) {
    this.gain.gain.setTargetAtTime(v, getCtx().currentTime, 0.015);
  }

  close() {
    this.source.disconnect();
    this.gain.disconnect();
    this.analyser.disconnect();
    this.el.srcObject = null;
  }
}
