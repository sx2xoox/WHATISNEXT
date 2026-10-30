// 게임을 어디서 돌리는지 감춘다. 혼자 하기는 브라우저 안에서, 온라인은 서버에서.
import { BotBrain, PERSONALITIES } from '../core/bots';
import { createGame, dispatch, start, tick } from '../core/engine';
import type { Command, GameState, Result } from '../core/types';
import { type PlayerView, viewFor } from '../core/view';
import type { ClientMsg, LobbyPlayer, RoomMeta, ServerMsg } from '../shared/protocol';

export interface GameSource {
  readonly online: boolean;
  me: number;
  view(): PlayerView | null;
  meta(): RoomMeta;
  act(cmd: Command): Promise<Result>;
  say(text: string): void;
  restart(): void;
  update(dt: number): void;
  onSpeech: (who: number, to: number | null, text: string) => void;
}

const BOT_NAMES = ['민수', '지은', '태호'];

export class LocalSource implements GameSource {
  readonly online = false;
  me = 0;
  private game!: GameState;
  private brains: BotBrain[] = [];
  private labels: string[] = [];
  private names: string[] = [];
  private seq = 0;
  onSpeech: GameSource['onSpeech'] = () => {};

  constructor(private myName: string) {
    this.restart();
  }

  restart(): void {
    this.names = [this.myName, ...BOT_NAMES];
    this.game = createGame(Math.floor(Math.random() * 2 ** 31), this.names.map((name, i) => ({ name, bot: i > 0 })));
    const personas = [...PERSONALITIES].sort(() => Math.random() - 0.5);
    this.brains = personas.map((p, i) => new BotBrain(i + 1, p));
    this.labels = ['', ...personas.map((p) => p.label)];
    start(this.game);
  }

  view(): PlayerView {
    return viewFor(this.game, this.me);
  }

  meta(): RoomMeta {
    return { names: this.names, offline: [], botLabels: this.game.phase === 'end' ? this.labels : [], hostPid: 0 };
  }

  act(cmd: Command): Promise<Result> {
    return Promise.resolve(dispatch(this.game, { cmdId: `me-${++this.seq}`, player: this.me, cmd }));
  }

  say(): void {}

  update(dt: number): void {
    tick(this.game, dt);
    for (const b of this.brains) b.update(this.game, (sp) => this.onSpeech(sp.who, sp.to, sp.text));
  }
}

export interface LobbyState {
  code: string;
  players: LobbyPlayer[];
  fillBots: boolean;
  hostPid: number;
}

export class OnlineSource implements GameSource {
  readonly online = true;
  me = 0;
  code = '';
  lobby: LobbyState | null = null;
  private ws: WebSocket | null = null;
  private latest: { view: PlayerView; meta: RoomMeta; at: number } | null = null;
  private pending = new Map<string, (r: Result) => void>();
  private seq = 0;
  private closedByUs = false;
  onSpeech: GameSource['onSpeech'] = () => {};
  onLobby: () => void = () => {};
  onError: (message: string) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};

  constructor(
    private name: string,
    private url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  ) {}

  private send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // 방을 만들거나(code 없음) 참가한다. 저장된 토큰이 있으면 원래 자리로 돌아간다.
  connect(code?: string): void {
    this.closedByUs = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus(true);
      const target = code ?? this.code;
      if (target) this.send({ t: 'join', code: target, name: this.name, token: loadToken(target) });
      else this.send({ t: 'create', name: this.name });
    };
    ws.onmessage = (e) => this.receive(JSON.parse(e.data) as ServerMsg);
    ws.onclose = () => {
      this.onStatus(false);
      for (const resolve of this.pending.values()) resolve({ ok: false, error: '연결이 끊겼습니다' });
      this.pending.clear();
      // 방에 들어가 있었다면 잠시 뒤 다시 접속한다
      if (!this.closedByUs && this.code) setTimeout(() => this.connect(this.code), 1500);
    };
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }

  private receive(msg: ServerMsg): void {
    switch (msg.t) {
      case 'joined':
        this.code = msg.code;
        this.me = msg.pid;
        saveToken(msg.code, msg.token);
        // 새로고침해도 같은 방으로 돌아오도록 주소에 방 코드를 남긴다
        try {
          history.replaceState(null, '', `?room=${msg.code}`);
        } catch {
          // 주소를 못 바꾸는 환경이면 방 코드로 직접 참가하면 된다
        }
        break;
      case 'lobby':
        this.lobby = { code: msg.code, players: msg.players, fillBots: msg.fillBots, hostPid: msg.hostPid };
        this.onLobby();
        break;
      case 'view':
        this.latest = { view: msg.view, meta: msg.meta, at: performance.now() };
        break;
      case 'result':
        this.pending.get(msg.cmdId)?.(msg.result);
        this.pending.delete(msg.cmdId);
        break;
      case 'speech':
        this.onSpeech(msg.who, msg.to, msg.text);
        break;
      case 'error':
        this.onError(msg.message);
        break;
    }
  }

  // 서버 상태는 0.5초마다 오므로, 그사이 시간은 클라이언트에서 흘려 보여준다
  view(): PlayerView | null {
    if (!this.latest) return null;
    const elapsed = (performance.now() - this.latest.at) / 1000;
    const v = this.latest.view;
    return { ...v, timeLeft: Math.max(0, v.timeLeft - elapsed), now: v.now + elapsed };
  }

  meta(): RoomMeta {
    return this.latest?.meta ?? { names: [], offline: [], botLabels: [], hostPid: 0 };
  }

  act(cmd: Command): Promise<Result> {
    const cmdId = `${Date.now().toString(36)}-${++this.seq}`;
    return new Promise((resolve) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return resolve({ ok: false, error: '서버에 연결되어 있지 않습니다' });
      this.pending.set(cmdId, resolve);
      this.send({ t: 'cmd', cmdId, cmd });
    });
  }

  say(text: string): void {
    this.send({ t: 'say', text });
  }

  setBots(fill: boolean): void {
    this.send({ t: 'bots', fill });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  restart(): void {
    this.send({ t: 'restart' });
  }

  update(): void {}
}

export function hasToken(code: string): boolean {
  return loadToken(code) !== undefined;
}

function loadToken(code: string): string | undefined {
  try {
    return localStorage.getItem(`jg:${code}`) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(code: string, token: string): void {
  try {
    localStorage.setItem(`jg:${code}`, token);
  } catch {
    // 저장이 막혀 있으면 새로고침 시 재접속만 안 될 뿐 게임은 계속된다
  }
}
