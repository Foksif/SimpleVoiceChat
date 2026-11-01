import { useEffect, useReducer, useState } from 'react';
import { Room } from './Room';
import { Setup } from './Setup';
import { loadSettings, saveSettings, serverUrl, type Settings } from './storage';
import { VoiceClient } from './voice';

export default function App() {
  const [voice] = useState(() => new VoiceClient());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [joinedAs, setJoinedAs] = useState('');

  useEffect(() => voice.subscribe(rerender), [voice]);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  if (voice.status === 'connected') return <Room voice={voice} name={joinedAs} />;

  return (
    <Setup
      settings={settings}
      onChange={update}
      busy={voice.status === 'connecting'}
      error={voice.error}
      onConnect={() => {
        const name = settings.name.trim();
        setJoinedAs(name);
        void voice.connect(serverUrl(), name, settings.deviceId);
      }}
    />
  );
}
