import { useCallback, useEffect, useRef, useState } from 'react';
import { createAnalyser, getCtx } from './audio';

/** Вызывает cb(0..1) на каждом кадре, пока есть анализатор. Без перерисовок React. */
export function useAnalyser(analyser: AnalyserNode | null, cb: (level: number) => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    if (!analyser) {
      cbRef.current(0);
      return;
    }
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const d = (buf[i] - 128) / 128;
        sum += d * d;
      }
      cbRef.current(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);
}

/** Список микрофонов + «проба» выбранного микрофона для индикатора уровня. */
export function useMic(deviceId: string, active: boolean) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((d) => d.kind === 'audioinput'));
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices) return;
    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    if (!navigator.mediaDevices) {
      setError('Микрофон работает только по HTTPS (или на localhost)');
      return;
    }
    let cancelled = false;
    let stream: MediaStream | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let node: AnalyserNode | undefined;

    navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: deviceId ? { ideal: deviceId } : undefined } })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        setError('');
        source = getCtx().createMediaStreamSource(s);
        node = createAnalyser(source);
        setAnalyser(node);
        await refresh(); // после разрешения у устройств появляются названия
      })
      .catch(() => setError('Нет доступа к микрофону'));

    return () => {
      cancelled = true;
      source?.disconnect();
      node?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      setAnalyser(null);
    };
  }, [deviceId, active, refresh]);

  return { devices, analyser, error };
}
