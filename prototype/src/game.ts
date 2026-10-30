import {
  ARENA_H,
  ARENA_W,
  COIN_PICK_RADIUS,
  COINS_PER_ROUND,
  COINS_SECOND_WAVE,
  COUNTDOWN_TIME,
  DASH_COOLDOWN,
  DASH_SPEED,
  DASH_TIME,
  GHOST_MEMORY,
  GHOST_RADIUS,
  LAST_SURVIVOR_DELAY,
  MOVE_SPEED,
  PLAYER_RADIUS,
  PLAYER_SLOTS,
  PUSH_COOLDOWN,
  PUSH_FORCE,
  PUSH_RANGE,
  ROUND_END_TIME,
  ROUND_TIME,
  ROUNDS_PER_SET,
  SAMPLE_DT,
  SAMPLE_EVERY,
  SPAWN_GRACE,
  type Slot,
} from './config';
import { type CardId, count, drawCards } from './cards';
import { type Control, type Intent, idleIntent, KEYS_P1, KEYS_P2 } from './input';

export type Phase = 'title' | 'countdown' | 'play' | 'roundEnd' | 'draft' | 'setEnd';

// 한 플레이어가 한 라운드 동안 남긴 궤적. 다음 라운드부터 유령으로 재생된다.
export interface Track {
  owner: number;
  round: number;
  xs: Float32Array;
  zs: Float32Array;
  died: boolean;
}

export interface Coin {
  x: number;
  z: number;
  taken: boolean;
  bornAt: number;
}

export interface Fx {
  kind: 'push' | 'pickup' | 'death';
  x: number;
  z: number;
  color: number;
  age: number;
}

export interface Player {
  id: number;
  slot: Slot;
  label: string;
  bot: boolean;
  control: Control;
  x: number;
  z: number;
  vx: number;
  vz: number;
  kx: number; // 밀치기로 받은 넉백 속도
  kz: number;
  faceX: number;
  faceZ: number;
  dashX: number;
  dashZ: number;
  alive: boolean;
  deadT: number;
  score: number;
  roundGain: number;
  survived: boolean;
  dashT: number;
  dashCd: number;
  pushCd: number;
  grace: number;
  cards: CardId[];
  recX: number[];
  recZ: number[];
  wander: { x: number; z: number; t: number };
}

export interface DraftSlot {
  offer: CardId[];
  sel: number;
  done: boolean;
  botDelay: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

function newPlayer(id: number, control: Control, bot: boolean): Player {
  return {
    id,
    slot: PLAYER_SLOTS[id],
    label: bot ? `봇${id + 1}` : `P${id + 1}`,
    bot,
    control,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    kx: 0,
    kz: 0,
    faceX: 0,
    faceZ: 1,
    dashX: 0,
    dashZ: 1,
    alive: true,
    deadT: 0,
    score: 0,
    roundGain: 0,
    survived: false,
    dashT: 0,
    dashCd: 0,
    pushCd: 0,
    grace: 0,
    cards: [],
    recX: [],
    recZ: [],
    wander: { x: 0, z: 0, t: 0 },
  };
}

export class Game {
  phase: Phase = 'title';
  phaseT = 0;
  players: Player[] = [];
  tracks: Track[] = [];
  coins: Coin[] = [];
  fx: Fx[] = [];
  draft: DraftSlot[] = [];
  round = 0;
  roundT = 0;
  time = 0;
  secondWaveAt = -1;
  private endTimer = -1;
  private steps = 0;
  private draftClosing = -1;
  private tmp = { x: 0, z: 0 };

  configure(humans: number, fillBots: boolean): void {
    const total = fillBots || humans < 2 ? 4 : humans;
    this.players = [];
    for (let i = 0; i < total; i++) {
      const human = i < humans;
      let control: Control = [];
      if (human) {
        if (humans <= 2) {
          // 1~2인: 키보드와 패드 둘 다 받음
          control = [{ kind: 'keys', keys: i === 0 ? KEYS_P1 : KEYS_P2 }, { kind: 'pad', index: i }];
        } else {
          // 3~4인: P1, P2는 키보드, P3, P4는 패드 1, 2번
          control = i < 2 ? [{ kind: 'keys', keys: i === 0 ? KEYS_P1 : KEYS_P2 }] : [{ kind: 'pad', index: i - 2 }];
        }
      }
      this.players.push(newPlayer(i, control, !human));
    }
  }

  startSet(): void {
    for (const p of this.players) {
      p.score = 0;
      p.cards = [];
    }
    this.tracks = [];
    this.round = 0;
    this.nextRound();
  }

  toTitle(): void {
    this.phase = 'title';
    this.tracks = [];
    this.coins = [];
  }

  ghostSpeed(owner: number): number {
    return Math.pow(1.5, count(this.players[owner].cards, 'fastforward'));
  }

  // 유령의 t초 시점 위치. 탈락한 궤적은 끝나면 사라진다.
  ghostAt(tr: Track, t: number, out: { x: number; z: number }): boolean {
    const last = tr.xs.length - 1;
    if (last < 0 || t < 0) return false;
    const f = (t * this.ghostSpeed(tr.owner)) / SAMPLE_DT;
    if (f >= last) {
      if (tr.died) return false;
      out.x = tr.xs[last];
      out.z = tr.zs[last];
      return true;
    }
    const i = Math.floor(f);
    const a = f - i;
    out.x = tr.xs[i] + (tr.xs[i + 1] - tr.xs[i]) * a;
    out.z = tr.zs[i] + (tr.zs[i + 1] - tr.zs[i]) * a;
    return true;
  }

  // 화면에 유령을 그릴 시각. 음수면 숨김.
  ghostTime(): number {
    if (this.phase === 'play' || this.phase === 'roundEnd') return this.roundT;
    if (this.phase === 'countdown') return 0;
    return -1;
  }

  update(dt: number, intents: Intent[]): void {
    this.time += dt;
    for (const f of this.fx) f.age += dt;
    this.fx = this.fx.filter((f) => f.age < 0.7);

    switch (this.phase) {
      case 'countdown':
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          this.phase = 'play';
          this.record();
        }
        break;
      case 'play':
        this.simulate(dt, intents);
        break;
      case 'roundEnd':
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          if (this.round >= ROUNDS_PER_SET) this.phase = 'setEnd';
          else this.startDraft();
        }
        break;
      case 'draft':
        this.updateDraft(dt, intents);
        break;
      default:
        break;
    }
  }

  private nextRound(): void {
    this.round++;
    this.roundT = 0;
    this.endTimer = -1;
    this.secondWaveAt = -1;
    this.steps = 0;
    this.coins = [];
    this.placeSpawns();
    this.spawnCoins(COINS_PER_ROUND, 2.2);
    this.phase = 'countdown';
    this.phaseT = COUNTDOWN_TIME;
  }

  // 유령들의 출발점에서 먼 곳부터 스폰 위치로 사용
  private placeSpawns(): void {
    const starts = this.tracks
      .filter((t) => t.xs.length > 0)
      .map((t) => ({ x: t.xs[0], z: t.zs[0] }));
    const cands: { x: number; z: number; s: number }[] = [];
    for (const x of [-7.5, -2.5, 2.5, 7.5]) {
      for (const z of [-3.5, 3.5]) {
        let s = 99;
        for (const st of starts) s = Math.min(s, dist(x, z, st.x, st.z));
        cands.push({ x, z, s: s + Math.random() * 0.8 });
      }
    }
    cands.sort((a, b) => b.s - a.s);
    const picks = cands.slice(0, this.players.length).sort(() => Math.random() - 0.5);
    this.players.forEach((p, i) => {
      p.x = picks[i].x;
      p.z = picks[i].z;
      p.vx = p.vz = p.kx = p.kz = 0;
      const l = Math.hypot(p.x, p.z) || 1;
      p.faceX = -p.x / l;
      p.faceZ = -p.z / l;
      p.alive = true;
      p.survived = false;
      p.deadT = 0;
      p.dashT = 0;
      p.dashCd = 0;
      p.pushCd = 0;
      p.grace = SPAWN_GRACE;
      p.roundGain = 0;
      p.recX = [];
      p.recZ = [];
    });
  }

  private spawnCoins(n: number, playerClearance: number): void {
    let placed = 0;
    for (let tries = 0; placed < n && tries < 400; tries++) {
      const x = rand(-ARENA_W / 2 + 1.2, ARENA_W / 2 - 1.2);
      const z = rand(-ARENA_H / 2 + 1.2, ARENA_H / 2 - 1.2);
      if (this.coins.some((c) => !c.taken && dist(x, z, c.x, c.z) < 1.8)) continue;
      if (this.players.some((p) => p.alive && dist(x, z, p.x, p.z) < playerClearance)) continue;
      this.coins.push({ x, z, taken: false, bornAt: this.time });
      placed++;
    }
  }

  private record(): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      p.recX.push(p.x);
      p.recZ.push(p.z);
    }
  }

  private kill(p: Player): void {
    p.alive = false;
    p.deadT = 0;
    p.recX.push(p.x);
    p.recZ.push(p.z);
    this.fx.push({ kind: 'death', x: p.x, z: p.z, color: p.slot.color, age: 0 });
  }

  private doPush(p: Player): void {
    this.fx.push({ kind: 'push', x: p.x, z: p.z, color: p.slot.color, age: 0 });
    const power = PUSH_FORCE * Math.pow(1.6, count(p.cards, 'heavy'));
    for (const q of this.players) {
      if (q === p || !q.alive) continue;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > PUSH_RANGE || d < 0.01) continue;
      const f = power * Math.pow(0.5, count(q.cards, 'heavy')) * (1 - (0.4 * d) / PUSH_RANGE);
      q.kx += (dx / d) * f;
      q.kz += (dz / d) * f;
    }
  }

  private simulate(dt: number, intents: Intent[]): void {
    this.roundT += dt;
    const xMax = ARENA_W / 2 - PLAYER_RADIUS;
    const zMax = ARENA_H / 2 - PLAYER_RADIUS;

    for (const p of this.players) {
      if (!p.alive) {
        p.deadT += dt;
        continue;
      }
      const it = intents[p.id] ?? idleIntent();
      p.grace = Math.max(0, p.grace - dt);
      p.dashT = Math.max(0, p.dashT - dt);
      p.dashCd = Math.max(0, p.dashCd - dt);
      p.pushCd = Math.max(0, p.pushCd - dt);

      const len = Math.hypot(it.mx, it.mz);
      if (len > 0.15) {
        p.faceX = it.mx / len;
        p.faceZ = it.mz / len;
      }
      if (it.dash && p.dashCd <= 0) {
        p.dashT = DASH_TIME;
        p.dashCd = DASH_COOLDOWN * Math.pow(0.6, count(p.cards, 'sprint'));
        p.dashX = p.faceX;
        p.dashZ = p.faceZ;
      }
      if (p.dashT > 0) {
        p.vx = p.dashX * DASH_SPEED;
        p.vz = p.dashZ * DASH_SPEED;
      } else {
        const sp = MOVE_SPEED * Math.pow(0.9, count(p.cards, 'heavy'));
        const a = Math.min(1, dt * 14);
        p.vx += (it.mx * sp - p.vx) * a;
        p.vz += (it.mz * sp - p.vz) * a;
      }
      if (it.push && p.pushCd <= 0) {
        p.pushCd = PUSH_COOLDOWN;
        this.doPush(p);
      }

      const decay = Math.exp(-5 * dt);
      p.kx *= decay;
      p.kz *= decay;
      p.x += (p.vx + p.kx) * dt;
      p.z += (p.vz + p.kz) * dt;
      if (p.x < -xMax || p.x > xMax) {
        p.x = Math.max(-xMax, Math.min(xMax, p.x));
        p.kx *= -0.3;
      }
      if (p.z < -zMax || p.z > zMax) {
        p.z = Math.max(-zMax, Math.min(zMax, p.z));
        p.kz *= -0.3;
      }
    }

    // 플레이어끼리 겹치지 않게
    const alive = this.players.filter((p) => p.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = PLAYER_RADIUS * 2;
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
        }
      }
    }

    for (const p of alive) {
      const r = COIN_PICK_RADIUS * Math.pow(1.8, count(p.cards, 'magnet'));
      for (const c of this.coins) {
        if (c.taken || dist(p.x, p.z, c.x, c.z) > r) continue;
        c.taken = true;
        p.score++;
        p.roundGain++;
        this.fx.push({ kind: 'pickup', x: c.x, z: c.z, color: 0xffd34d, age: 0 });
      }
    }

    const g = this.tmp;
    const hit = PLAYER_RADIUS + GHOST_RADIUS - 0.12;
    for (const p of alive) {
      if (p.grace > 0 || p.dashT > 0) continue;
      const shadow = count(p.cards, 'shadow') > 0;
      for (const tr of this.tracks) {
        if (shadow && tr.owner === p.id) continue;
        if (!this.ghostAt(tr, this.roundT, g)) continue;
        if (dist(p.x, p.z, g.x, g.z) < hit) {
          this.kill(p);
          break;
        }
      }
    }

    this.steps++;
    if (this.steps % SAMPLE_EVERY === 0) this.record();

    if (this.secondWaveAt < 0 && this.roundT >= ROUND_TIME / 2) {
      this.secondWaveAt = this.time;
      this.spawnCoins(COINS_SECOND_WAVE, 1.5);
    }

    const aliveCount = this.players.filter((p) => p.alive).length;
    if (this.players.length > 1 && aliveCount <= 1 && this.endTimer < 0) {
      this.endTimer = aliveCount === 0 ? 0.8 : LAST_SURVIVOR_DELAY;
    }
    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        this.endRound();
        return;
      }
    }
    if (this.roundT >= ROUND_TIME) this.endRound();
  }

  private endRound(): void {
    for (const p of this.players) {
      if (p.alive) {
        p.survived = true;
        p.score++;
        p.roundGain++;
      }
      if (p.recX.length >= 2) {
        this.tracks.push({
          owner: p.id,
          round: this.round,
          xs: Float32Array.from(p.recX),
          zs: Float32Array.from(p.recZ),
          died: !p.alive,
        });
      }
    }
    this.tracks = this.tracks.filter((t) => t.round > this.round - GHOST_MEMORY);
    this.phase = 'roundEnd';
    this.phaseT = ROUND_END_TIME;
  }

  // 모두 동시에 고른다. 꼴찌는 후보가 4장.
  private startDraft(): void {
    const minScore = Math.min(...this.players.map((p) => p.score));
    this.draft = this.players.map((p) => ({
      offer: drawCards(p.score === minScore ? 4 : 3),
      sel: 0,
      done: false,
      botDelay: rand(0.6, 1.6),
    }));
    this.draftClosing = -1;
    this.phase = 'draft';
  }

  private updateDraft(dt: number, intents: Intent[]): void {
    this.draft.forEach((d, i) => {
      if (d.done) return;
      const p = this.players[i];
      if (p.bot) {
        d.botDelay -= dt;
        if (d.botDelay <= 0) {
          d.sel = Math.floor(Math.random() * d.offer.length);
          d.done = true;
          p.cards.push(d.offer[d.sel]);
        }
        return;
      }
      const it = intents[i];
      if (!it) return;
      if (it.left) d.sel = (d.sel - 1 + d.offer.length) % d.offer.length;
      if (it.right) d.sel = (d.sel + 1) % d.offer.length;
      if (it.confirm) {
        d.done = true;
        p.cards.push(d.offer[d.sel]);
      }
    });
    if (this.draft.every((d) => d.done)) {
      if (this.draftClosing < 0) this.draftClosing = 0.6;
      this.draftClosing -= dt;
      if (this.draftClosing <= 0) this.nextRound();
    }
  }

  // 마우스로 카드 선택 (사람 플레이어만)
  pickCard(playerId: number, index: number): void {
    const d = this.draft[playerId];
    const p = this.players[playerId];
    if (this.phase !== 'draft' || !d || d.done || p.bot) return;
    d.sel = index;
    d.done = true;
    p.cards.push(d.offer[index]);
  }

  botIntent(p: Player): Intent {
    const it = idleIntent();
    if (!p.alive || this.phase !== 'play') return it;

    let tx = p.wander.x;
    let tz = p.wander.z;
    let best = Infinity;
    for (const c of this.coins) {
      if (c.taken) continue;
      const d = dist(p.x, p.z, c.x, c.z);
      let penalty = 0;
      for (const q of this.players) {
        if (q !== p && q.alive && dist(q.x, q.z, c.x, c.z) < d * 0.7) penalty += 3;
      }
      if (d + penalty < best) {
        best = d + penalty;
        tx = c.x;
        tz = c.z;
      }
    }
    if (best === Infinity && this.time > p.wander.t) {
      p.wander = { x: rand(-7, 7), z: rand(-4, 4), t: this.time + rand(1.5, 3) };
    }
    let dx = tx - p.x;
    let dz = tz - p.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;

    // 유령의 현재·가까운 미래 위치를 피한다
    let ax = 0;
    let az = 0;
    let danger = 0;
    const g = this.tmp;
    const shadow = count(p.cards, 'shadow') > 0;
    for (const tr of this.tracks) {
      if (shadow && tr.owner === p.id) continue;
      for (const look of [0, 0.25, 0.5]) {
        if (!this.ghostAt(tr, this.roundT + look, g)) continue;
        const ex = p.x - g.x;
        const ez = p.z - g.z;
        const d = Math.hypot(ex, ez) || 0.01;
        const R = 2.0;
        if (d < R) {
          const w = ((R - d) / R) * (1 - look);
          ax += (ex / d) * w * 3;
          az += (ez / d) * w * 3;
          danger = Math.max(danger, w);
        }
      }
    }
    const edge = 1.2;
    if (p.x > ARENA_W / 2 - edge) ax -= 0.8;
    if (p.x < -ARENA_W / 2 + edge) ax += 0.8;
    if (p.z > ARENA_H / 2 - edge) az -= 0.8;
    if (p.z < -ARENA_H / 2 + edge) az += 0.8;

    let mx = dx * (1 - Math.min(danger, 0.8)) + ax;
    let mz = dz * (1 - Math.min(danger, 0.8)) + az;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    it.mx = mx;
    it.mz = mz;
    if (danger > 0.7 && p.dashCd <= 0 && Math.random() < 0.12) it.dash = true;
    for (const q of this.players) {
      if (q !== p && q.alive && dist(p.x, p.z, q.x, q.z) < 1.4 && p.pushCd <= 0 && Math.random() < 0.03) {
        it.push = true;
      }
    }
    return it;
  }
}
