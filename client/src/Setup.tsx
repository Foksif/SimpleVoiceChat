import { useRef } from 'react';
import { useAnalyser, useMic } from './hooks';
import type { Settings } from './storage';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  busy: boolean;
  error: string;
  onConnect: () => void;
}

export function Setup({ settings, onChange, busy, error, onConnect }: Props) {
  const { devices, analyser, error: micError } = useMic(settings.deviceId, !busy);
  const bar = useRef<HTMLDivElement>(null);
  useAnalyser(analyser, (l) => {
    if (bar.current) bar.current.style.transform = `scaleX(${l})`;
  });

  const deviceValue = devices.some((d) => d.deviceId === settings.deviceId) ? settings.deviceId : '';
  const canConnect = settings.name.trim().length > 0 && !busy;

  return (
    <form
      className="screen setup"
      onSubmit={(e) => {
        e.preventDefault();
        if (canConnect) onConnect();
      }}
    >
      <header className="brand">
        <h1>Voice Room</h1>
        <p>Одна общая комната. Заходите и говорите.</p>
      </header>

      <label className="field">
        <span>Никнейм</span>
        <input
          value={settings.name}
          maxLength={24}
          autoFocus
          placeholder="Как вас называть"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>

      <label className="field">
        <span>Микрофон</span>
        <select value={deviceValue} onChange={(e) => onChange({ deviceId: e.target.value })}>
          <option value="">По умолчанию</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Микрофон ${i + 1}`}
            </option>
          ))}
        </select>
        <div className="meter" title="Уровень микрофона">
          <div ref={bar} className="meter-fill" />
        </div>
        {micError && <small className="hint error">{micError}</small>}
      </label>

      {error && <div className="banner">{error}</div>}

      <button className="primary" type="submit" disabled={!canConnect}>
        {busy ? 'Подключаемся…' : 'Войти в комнату'}
      </button>
    </form>
  );
}
