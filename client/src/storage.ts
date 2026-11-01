const SETTINGS_KEY = 'voice-room:settings';
const VOLUMES_KEY = 'voice-room:volumes';

/** Сайт и сервер на одном адресе: ws(s)://<тот же хост>/ws */
export function serverUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export interface Settings {
  name: string;
  deviceId: string;
}

export function loadSettings(): Settings {
  const defaults: Settings = { name: '', deviceId: '' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

// Громкость участников хранится по нику, чтобы запоминаться между сессиями.
function loadVolumes(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VOLUMES_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function getVolume(name: string): number {
  return loadVolumes()[name] ?? 1;
}

export function saveVolume(name: string, volume: number) {
  try {
    localStorage.setItem(VOLUMES_KEY, JSON.stringify({ ...loadVolumes(), [name]: volume }));
  } catch {
    /* ignore */
  }
}
