import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createGameServer, type GameServer } from '../server/index';
import type { PlayerView } from '../src/core/view';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';

let gs: GameServer;
let url = '';
const opened: WebSocket[] = [];

beforeEach(async () => {
  gs = createGameServer(null);
  await new Promise<void>((r) => gs.server.listen(0, r));
  url = `ws://localhost:${(gs.server.address() as AddressInfo).port}/ws`;
});

afterEach(async () => {
  for (const ws of opened) ws.terminate();
  opened.length = 0;
  await gs.close();
});

class Client {
  msgs: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  ws: WebSocket;
  constructor() {
    this.ws = new WebSocket(url);
    opened.push(this.ws);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }
  ready() {
    return new Promise<void>((r) => this.ws.once('open', () => r()));
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
  wait<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true) {
    const hit = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>));
    if (hit) return Promise.resolve(hit as Extract<ServerMsg, { t: T }>);
    return new Promise<Extract<ServerMsg, { t: T }>>((resolve) =>
      this.waiters.push({ pred: (m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>), resolve: resolve as (m: ServerMsg) => void }),
    );
  }
  lastView(): PlayerView {
    const v = [...this.msgs].reverse().find((m) => m.t === 'view');
    if (!v || v.t !== 'view') throw new Error('no view');
    return v.view;
  }
}

let cmdN = 0;
async function cmd(c: Client, command: Extract<ClientMsg, { t: 'cmd' }>['cmd']) {
  const cmdId = `t${++cmdN}`;
  c.send({ t: 'cmd', cmdId, cmd: command });
  return (await c.wait('result', (m) => m.cmdId === cmdId)).result;
}

async function room(n: number, fill = false) {
  const host = new Client();
  await host.ready();
  host.send({ t: 'create', name: '방장' });
  const { code } = await host.wait('joined');
  const others: Client[] = [];
  for (let i = 1; i < n; i++) {
    const c = new Client();
    await c.ready();
    c.send({ t: 'join', code, name: `손님${i}` });
    await c.wait('joined');
    others.push(c);
  }
  host.send({ t: 'bots', fill });
  await host.wait('lobby', (m) => m.fillBots === fill && m.players.length === n);
  return { host, others, code };
}

describe('멀티플레이 서버', () => {
  it('방을 만들고 참가하면 대기실에 모두 보인다', async () => {
    const { host, others } = await room(3);
    const lobby = await host.wait('lobby', (m) => m.players.length === 3);
    expect(lobby.players.map((p) => p.name)).toEqual(['방장', '손님1', '손님2']);
    expect(lobby.hostPid).toBe(0);
    expect((await others[1].wait('joined')).pid).toBe(2);
  });

  it('없는 방 코드나 가득 찬 방에는 들어갈 수 없다', async () => {
    const { code } = await room(4);
    const c = new Client();
    await c.ready();
    c.send({ t: 'join', code: 'ZZZZ', name: 'x' });
    expect((await c.wait('error')).message).toContain('없는 방');
    c.send({ t: 'join', code, name: 'x' });
    expect((await c.wait('error', (m) => m.message.includes('가득'))).message).toContain('가득');
  });

  it('방장만 시작할 수 있고, 각자 자기 정보만 받는다', async () => {
    const { host, others } = await room(2);
    const guest = others[0];
    guest.send({ t: 'start' });
    expect((await guest.wait('error')).message).toContain('방장');
    host.send({ t: 'start' });
    const a = (await host.wait('view')).view;
    const b = (await guest.wait('view')).view;
    expect(a.me.id).toBe(0);
    expect(b.me.id).toBe(1);
    expect(a.players).toHaveLength(2);
    // 다른 사람의 현금은 보이지 않는다
    expect(Object.keys(a.players[1])).not.toContain('cash');
    expect(a.offers).toEqual([]);
  });

  it('두 사람이 네트워크로 직거래하면 양쪽 화면에 반영된다', async () => {
    const { host, others } = await room(2);
    const guest = others[0];
    host.send({ t: 'start' });
    await host.wait('view');
    // 시장 → 경매 → 직거래
    for (const phase of ['auction', 'trade']) {
      expect((await cmd(host, { t: 'ready' })).ok).toBe(true);
      expect((await cmd(guest, { t: 'ready' })).ok).toBe(true);
      await host.wait('view', (m) => m.view.phase === phase);
    }
    const item = host.lastView().players[0].items[0];
    const offer = await cmd(host, { t: 'offer', to: 1, giveCash: 0, giveItems: [item], wantCash: 30_000, wantItems: [], guarantee: [], line: '상태 좋아요' });
    expect(offer.ok).toBe(true);
    const speech = await guest.wait('speech', (m) => m.who === 0);
    expect(speech.text).toBe('상태 좋아요');
    const seen = await guest.wait('view', (m) => m.view.offers.some((o) => o.status === 'pending'));
    const offerId = seen.view.offers[0].id;
    expect((await cmd(guest, { t: 'respond', offerId, accept: true })).ok).toBe(true);
    const after = await host.wait('view', (m) => m.view.players[1].items.includes(item));
    expect(after.view.me.cash).toBe(500_000 + 30_000 - 1_500);
  });

  it('같은 토큰으로 다시 접속하면 원래 자리로 돌아온다', async () => {
    const { host, others, code } = await room(2);
    const guest = others[0];
    const { token, pid } = await guest.wait('joined');
    host.send({ t: 'start' });
    await guest.wait('view');
    guest.ws.close();
    await host.wait('view', (m) => m.meta.offline.includes(pid));
    const back = new Client();
    await back.ready();
    back.send({ t: 'join', code, name: '아무개', token });
    expect((await back.wait('joined')).pid).toBe(pid);
    expect((await back.wait('view')).view.me.id).toBe(pid);
    // 시작한 방에 토큰 없이 들어올 수는 없다
    const stranger = new Client();
    await stranger.ready();
    stranger.send({ t: 'join', code, name: 'x' });
    expect((await stranger.wait('error')).message).toContain('시작');
  });

  it('NPC로 빈자리를 채우면 4인 게임이 된다', async () => {
    const { host } = await room(1, true);
    host.send({ t: 'start' });
    const { view, meta } = await host.wait('view');
    expect(view.players).toHaveLength(4);
    expect(meta.names.slice(1).every((n) => n.includes('NPC'))).toBe(true);
  });
});
