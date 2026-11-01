import { RemotePlayer, createAnalyser, getCtx } from './audio';
import { getVolume, saveVolume } from './storage';

export type Status = 'idle' | 'connecting' | 'connected' | 'error';

export interface Peer {
  id: string;
  name: string;
  muted: boolean;
  state: RTCPeerConnectionState;
  volume: number;
  player: RemotePlayer | null;
}

interface PeerInfo {
  id: string;
  name: string;
  muted: boolean;
}

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function iceServers(): RTCIceServer[] {
  try {
    const raw = import.meta.env.VITE_ICE_SERVERS;
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  return DEFAULT_ICE;
}

const MIC_BITRATE = 64_000; // Opus 64 кбит/с — чистая речь с запасом

/**
 * Клиент голосовой комнаты: WebSocket для сигналинга + WebRTC mesh для звука.
 * Новый участник сам звонит всем, кто уже в комнате (так нет «встречных» офферов).
 */
export class VoiceClient {
  status: Status = 'idle';
  error = '';
  muted = false;
  localAnalyser: AnalyserNode | null = null;
  peers = new Map<string, Peer>();

  private ws: WebSocket | null = null;
  private conns = new Map<string, RTCPeerConnection>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private localStream: MediaStream | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private pingTimer: number | undefined;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private resolveWelcome: (() => void) | null = null;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  get peerList(): Peer[] {
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async connect(url: string, name: string, deviceId: string) {
    if (this.status === 'connecting' || this.status === 'connected') return;
    this.status = 'connecting';
    this.error = '';
    this.muted = false;
    this.emit();

    try {
      if (!navigator.mediaDevices) throw new Error('Микрофон работает только по HTTPS (или на localhost)');
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { ideal: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
      const [track] = this.localStream.getAudioTracks();
      (track as any).contentHint = 'speech';

      const ctx = getCtx();
      await ctx.resume();
      this.localSource = ctx.createMediaStreamSource(this.localStream);
      this.localAnalyser = createAnalyser(this.localSource);

      await this.openSocket(url, name);
      this.status = 'connected';
      this.emit();
    } catch (e) {
      this.fail(describeError(e));
    }
  }

  disconnect() {
    this.cleanup();
    this.status = 'idle';
    this.error = '';
    this.emit();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.send({ type: 'update', muted });
    this.emit();
  }

  setVolume(id: string, volume: number) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.volume = volume;
    peer.player?.setVolume(volume);
    saveVolume(peer.name, volume);
    this.emit();
  }

  // ---------- сигналинг ----------

  private openSocket(url: string, name: string) {
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error('Неверный адрес сервера'));
        return;
      }
      this.ws = ws;
      this.resolveWelcome = resolve;

      ws.onopen = () => {
        opened = true;
        ws.send(JSON.stringify({ type: 'join', name }));
        this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 20_000);
      };
      ws.onmessage = (e) => {
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        // Обрабатываем сообщения строго по очереди, чтобы ICE не обгонял SDP.
        this.queue = this.queue.then(() => this.onMessage(msg)).catch(console.error);
      };
      ws.onerror = () => {
        if (!opened) reject(new Error('Не удалось подключиться к серверу'));
      };
      ws.onclose = () => {
        if (!opened) reject(new Error('Не удалось подключиться к серверу'));
        else if (this.ws === ws) this.fail('Соединение с сервером потеряно');
      };
    });
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private sendSignal(to: string, data: unknown) {
    this.send({ type: 'signal', to, data });
  }

  private async onMessage(msg: any) {
    switch (msg.type) {
      case 'welcome': {
        for (const p of msg.peers as PeerInfo[]) {
          this.addPeer(p);
          await this.call(p.id);
        }
        this.resolveWelcome?.();
        this.resolveWelcome = null;
        break;
      }
      case 'peer_joined':
        this.addPeer(msg.peer);
        break;
      case 'peer_left':
        this.removePeer(msg.id);
        break;
      case 'peer_updated': {
        const peer = this.peers.get(msg.peer.id);
        if (peer) {
          peer.muted = msg.peer.muted;
          this.emit();
        }
        break;
      }
      case 'signal':
        await this.onSignal(msg.from, msg.data);
        break;
      case 'error':
        this.fail(msg.message || 'Ошибка сервера');
        break;
    }
  }

  // ---------- WebRTC ----------

  private addPeer(info: PeerInfo) {
    this.peers.set(info.id, {
      id: info.id,
      name: info.name,
      muted: info.muted,
      state: 'new',
      volume: getVolume(info.name),
      player: null,
    });
    this.emit();
  }

  private removePeer(id: string) {
    this.conns.get(id)?.close();
    this.conns.delete(id);
    this.pendingIce.delete(id);
    this.peers.get(id)?.player?.close();
    this.peers.delete(id);
    this.emit();
  }

  private createConnection(id: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.conns.set(id, pc);

    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal(id, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const peer = this.peers.get(id);
      if (!peer || peer.player) return;
      peer.player = new RemotePlayer(e.streams[0] ?? new MediaStream([e.track]), peer.volume);
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      const peer = this.peers.get(id);
      if (peer) {
        peer.state = pc.connectionState;
        this.emit();
      }
      if (pc.connectionState === 'connected') this.tuneSenders(pc);
    };
    return pc;
  }

  /** Поднимаем битрейт Opus — по умолчанию браузеры шлют заметно более «бедный» звук. */
  private tuneSenders(pc: RTCPeerConnection) {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'audio') continue;
      const params = sender.getParameters();
      if (!params.encodings?.length) continue;
      params.encodings[0].maxBitrate = MIC_BITRATE;
      sender.setParameters(params).catch(() => {});
    }
  }

  private async call(id: string) {
    const pc = this.createConnection(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(id, { description: pc.localDescription });
  }

  private async onSignal(from: string, data: any) {
    if (!this.localStream) return;
    const pc = this.conns.get(from) ?? this.createConnection(from);

    if (data.description) {
      await pc.setRemoteDescription(data.description);
      const queued = this.pendingIce.get(from) ?? [];
      this.pendingIce.delete(from);
      for (const c of queued) await pc.addIceCandidate(c).catch(() => {});

      if (data.description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal(from, { description: pc.localDescription });
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(data.candidate).catch(() => {});
      } else {
        const list = this.pendingIce.get(from) ?? [];
        list.push(data.candidate);
        this.pendingIce.set(from, list);
      }
    }
  }

  // ---------- уборка ----------

  private fail(message: string) {
    this.cleanup();
    this.status = 'error';
    this.error = message;
    this.emit();
  }

  private cleanup() {
    window.clearInterval(this.pingTimer);
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.resolveWelcome = null;
    this.conns.forEach((pc) => pc.close());
    this.conns.clear();
    this.pendingIce.clear();
    this.peers.forEach((p) => p.player?.close());
    this.peers.clear();
    this.localSource?.disconnect();
    this.localAnalyser?.disconnect();
    this.localSource = null;
    this.localAnalyser = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.queue = Promise.resolve();
  }
}

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return 'Нет доступа к микрофону. Разрешите его в настройках системы.';
    if (e.name === 'NotFoundError') return 'Микрофон не найден.';
  }
  return e instanceof Error ? e.message : 'Не удалось подключиться';
}
