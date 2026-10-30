// 방 하나 = 게임 하나. 서버가 게임 상태의 유일한 주인이다.
import { randomBytes } from 'node:crypto';
import { BotBrain, PERSONALITIES } from '../src/core/bots';
import { createGame, dispatch, start, tick } from '../src/core/engine';
import type { GameState } from '../src/core/types';
import { viewFor } from '../src/core/view';
import { type ClientMsg, type LobbyPlayer, MAX_PLAYERS, QUICK_LINES, type ServerMsg } from '../src/shared/protocol';

export interface Conn {
  send(msg: ServerMsg): void;
}

interface Seat {
  pid: number;
  name: string;
  token: string;
  conn: Conn | null;
  lastSay: number;
  offSince: number;
}

const BOT_NAMES = ['민수', '지은', '태호'];
const VIEW_INTERVAL = 0.5; // 상태가 그대로여도 이 간격으로 남은 시간을 보낸다
const AWAY_AFTER = 15; // 이만큼 끊겨 있으면 대신 준비 완료를 누른다

export class Room {
  private seats: Seat[] = [];
  private game: GameState | null = null;
  private brains: BotBrain[] = [];
  private botLabels: string[] = [];
  private names: string[] = [];
  private fillBots = true;
  private sentVersion = -1;
  private sinceView = 0;
  emptySince = 0;

  constructor(
    readonly code: string,
    private now: () => number = () => Date.now() / 1000,
  ) {}

  get started(): boolean {
    return this.game !== null;
  }

  private get hostPid(): number {
    return this.seats.find((s) => s.conn)?.pid ?? 0;
  }

  // 새 자리에 앉히거나, 토큰이 맞으면 원래 자리로 돌려보낸다
  join(conn: Conn, name: string, token?: string): Seat | string {
    const back = token ? this.seats.find((s) => s.token === token) : undefined;
    if (back) {
      back.conn?.send({ t: 'error', message: '다른 창에서 다시 접속했습니다' });
      back.conn = conn;
      this.emptySince = 0;
      return back;
    }
    if (this.game) return '이미 시작한 방입니다';
    if (this.seats.length >= MAX_PLAYERS) return '방이 가득 찼습니다';
    const seat: Seat = {
      pid: this.seats.length,
      name: cleanName(name, this.seats.length),
      token: randomBytes(12).toString('hex'),
      conn,
      lastSay: 0,
      offSince: 0,
    };
    this.seats.push(seat);
    this.emptySince = 0;
    return seat;
  }

  leave(conn: Conn): void {
    const seat = this.seats.find((s) => s.conn === conn);
    if (!seat) return;
    seat.conn = null;
    seat.offSince = this.now();
    // 시작 전이면 자리를 비워 준다
    if (!this.game) {
      this.seats = this.seats.filter((s) => s !== seat).map((s, i) => ({ ...s, pid: i }));
      for (const s of this.seats) s.conn?.send({ t: 'joined', code: this.code, pid: s.pid, token: s.token });
    }
    if (!this.seats.some((s) => s.conn)) this.emptySince = this.now();
    this.broadcastState(true);
  }

  handle(conn: Conn, msg: ClientMsg): void {
    const seat = this.seats.find((s) => s.conn === conn);
    if (!seat) return;
    switch (msg.t) {
      case 'bots':
        if (seat.pid === this.hostPid && !this.game) this.fillBots = msg.fill;
        this.broadcastState(true);
        break;
      case 'start':
      case 'restart':
        if (seat.pid !== this.hostPid) return conn.send({ t: 'error', message: '방장만 시작할 수 있습니다' });
        if (msg.t === 'start' && this.game) return;
        if (msg.t === 'restart' && this.game?.phase !== 'end') return;
        if (!this.fillBots && this.seats.length < 2) return conn.send({ t: 'error', message: '혼자서는 NPC를 켜야 시작할 수 있습니다' });
        this.startGame();
        break;
      case 'cmd': {
        if (!this.game) return;
        const result = dispatch(this.game, { cmdId: `${seat.token}:${msg.cmdId}`, player: seat.pid, cmd: msg.cmd });
        conn.send({ t: 'result', cmdId: msg.cmdId, result });
        if (result.ok) this.afterCommand(seat, msg.cmd);
        this.broadcastState();
        break;
      }
      case 'say': {
        const t = this.now();
        if (!this.game || t - seat.lastSay < 1 || !QUICK_LINES.includes(msg.text)) return;
        seat.lastSay = t;
        this.speak(seat.pid, null, msg.text);
        break;
      }
      default:
        break;
    }
  }

  // 사람의 거래 행동도 말풍선으로 보여준다
  private afterCommand(seat: Seat, cmd: Extract<ClientMsg, { t: 'cmd' }>['cmd']): void {
    if (cmd.t === 'offer' && cmd.line) this.speak(seat.pid, cmd.to, cmd.line);
    if (cmd.t === 'respond' && cmd.accept) {
      const o = this.game!.offers.find((x) => x.id === cmd.offerId);
      this.speak(seat.pid, o?.from ?? null, '좋아요, 거래하죠');
    }
  }

  private speak(who: number, to: number | null, text: string): void {
    for (const s of this.seats) s.conn?.send({ t: 'speech', who, to, text });
  }

  private startGame(): void {
    const humans = this.seats.length;
    const bots = this.fillBots ? MAX_PLAYERS - humans : 0;
    const personas = [...PERSONALITIES].sort(() => Math.random() - 0.5).slice(0, bots);
    this.names = [...this.seats.map((s) => s.name), ...BOT_NAMES.slice(0, bots).map((n) => `${n} (NPC)`)];
    this.game = createGame(
      Math.floor(Math.random() * 2 ** 31),
      this.names.map((name, i) => ({ name, bot: i >= humans })),
    );
    this.brains = personas.map((p, i) => new BotBrain(humans + i, p));
    this.botLabels = [...this.seats.map(() => ''), ...personas.map((p) => p.label)];
    start(this.game);
    this.broadcastState(true);
  }

  update(dt: number): void {
    const g = this.game;
    if (!g) return;
    // 오래 끊긴 사람 때문에 단계가 멈추지 않게 준비 완료로 처리한다
    const t = this.now();
    for (const s of this.seats) {
      if (!s.conn && t - s.offSince > AWAY_AFTER && !g.players[s.pid].ready && g.phase !== 'end') {
        dispatch(g, { cmdId: `away-${s.pid}-${g.version}-${g.phase}`, player: s.pid, cmd: { t: 'ready' } });
      }
    }
    tick(g, dt);
    for (const b of this.brains) b.update(g, (sp) => this.speak(sp.who, sp.to, sp.text));
    this.sinceView += dt;
    this.broadcastState();
  }

  private broadcastState(force = false): void {
    if (!this.game) {
      const players: LobbyPlayer[] = this.seats.map((s) => ({
        pid: s.pid,
        name: s.name,
        connected: !!s.conn,
        host: s.pid === this.hostPid,
      }));
      for (const s of this.seats) {
        s.conn?.send({ t: 'lobby', code: this.code, players, fillBots: this.fillBots, hostPid: this.hostPid });
      }
      return;
    }
    const g = this.game;
    if (!force && g.version === this.sentVersion && this.sinceView < VIEW_INTERVAL) return;
    this.sentVersion = g.version;
    this.sinceView = 0;
    const meta = {
      names: this.names,
      offline: this.seats.filter((s) => !s.conn).map((s) => s.pid),
      botLabels: g.phase === 'end' ? this.botLabels : [],
      hostPid: this.hostPid,
    };
    for (const s of this.seats) s.conn?.send({ t: 'view', view: viewFor(g, s.pid), meta });
  }

  // 재접속한 사람에게 지금 상태를 바로 보낸다
  resync(): void {
    this.broadcastState(true);
  }
}

function cleanName(name: string, i: number): string {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 10);
  return n || `플레이어${i + 1}`;
}
