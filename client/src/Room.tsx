import { useRef } from 'react';
import { Icon } from './Icon';
import { useAnalyser } from './hooks';
import type { VoiceClient } from './voice';

interface RowProps {
  name: string;
  muted: boolean;
  analyser: AnalyserNode | null;
  note?: string;
  volume?: number; // 0..2, только для других участников
  onVolume?: (v: number) => void;
}

function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function Participant({ name, muted, analyser, note, volume, onVolume }: RowProps) {
  const avatar = useRef<HTMLDivElement>(null);
  useAnalyser(analyser, (l) => avatar.current?.classList.toggle('speaking', l > 0.08));

  return (
    <li className="participant">
      <div
        ref={avatar}
        className="avatar"
        style={{ background: `hsl(${hue(name)} 28% 30%)` }}
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
      <div className="info">
        <div className="name-row">
          <span className="name">{name}</span>
          {muted && <span className="muted-flag" title="Микрофон выключен"><Icon name="micOff" size={14} /></span>}
          {note && <span className="note">{note}</span>}
        </div>
        {volume !== undefined && onVolume && (
          <div className="volume">
            <Icon name="volume" size={14} />
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(volume * 100)}
              aria-label={`Громкость ${name}`}
              onChange={(e) => onVolume(Number(e.target.value) / 100)}
              onDoubleClick={() => onVolume(1)}
            />
            <span className="percent">{Math.round(volume * 100)}%</span>
          </div>
        )}
      </div>
    </li>
  );
}

function stateNote(state: RTCPeerConnectionState): string | undefined {
  if (state === 'connected') return undefined;
  if (state === 'failed' || state === 'disconnected') return 'нет связи';
  return 'подключение…';
}

export function Room({ voice, name }: { voice: VoiceClient; name: string }) {
  const peers = voice.peerList;
  const count = peers.length + 1;

  return (
    <div className="screen room">
      <header className="room-head">
        <h1>Общая комната</h1>
        <span className="count">{count} в сети</span>
      </header>

      <ul className="participants">
        <Participant name={`${name} (вы)`} muted={voice.muted} analyser={voice.localAnalyser} />
        {peers.map((p) => (
          <Participant
            key={p.id}
            name={p.name}
            muted={p.muted}
            analyser={p.player?.analyser ?? null}
            note={stateNote(p.state)}
            volume={p.volume}
            onVolume={(v) => voice.setVolume(p.id, v)}
          />
        ))}
      </ul>
      {peers.length === 0 && <p className="empty">Пока вы одни. Остальные появятся здесь, когда зайдут.</p>}

      <footer className="controls">
        <button
          className={`round ${voice.muted ? 'off' : ''}`}
          onClick={() => voice.setMuted(!voice.muted)}
          aria-pressed={voice.muted}
          title={voice.muted ? 'Включить микрофон' : 'Выключить микрофон'}
        >
          <Icon name={voice.muted ? 'micOff' : 'mic'} size={22} />
        </button>
        <button className="leave" onClick={() => voice.disconnect()}>
          <Icon name="leave" /> Выйти
        </button>
      </footer>
    </div>
  );
}
