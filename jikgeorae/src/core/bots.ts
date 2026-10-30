// NPC 플레이어. 사람과 똑같이 viewFor()로 보이는 정보만 보고 dispatch()로만 행동한다.
import { CONFIG } from './config';
import { dispatch } from './engine';
import { TYPE_BY_ID } from './items';
import type { Command, GameState, Offer } from './types';
import { type ItemView, type PlayerView, viewFor } from './view';

export interface Personality {
  label: string;
  greed: number; // 거래를 받아들이는 최소 이익 비율
  bidAggro: number; // 예상 가치 대비 입찰 비율
  scammer: boolean; // 알고 있는 하자를 숨기고 판다
  appraiser: boolean; // 경매 전에 감정을 자주 한다
}

export const PERSONALITIES: Personality[] = [
  { label: '급처형', greed: 0.02, bidAggro: 0.75, scammer: false, appraiser: false },
  { label: '사기꾼', greed: 0.1, bidAggro: 0.8, scammer: true, appraiser: true },
  { label: '고집형', greed: 0.2, bidAggro: 0.9, scammer: false, appraiser: true },
];

export interface Speech {
  who: number;
  to: number | null;
  text: string;
}

const LINES = {
  pitchGood: ['박스 풀셋이에요', '상태 진짜 좋아요', '이거 귀한 거예요', '실사용 거의 안 했어요'],
  pitchHonest: ['하자 있어서 싸게 드려요', '상태는 그냥 그래요. 가격 보세요', '급처합니다'],
  buy: ['그거 저한테 파세요', '그거 제가 모으는 거라서요', '현금 바로 드릴게요'],
  accept: ['콜!', '좋아요, 거래하죠', '오케이 접수'],
  reject: ['에이 그건 좀…', '너무 싼데요?', '패스할게요', '그 가격엔 안 돼요'],
  counter: ['이 정도면 생각해볼게요', '조금만 더 쓰시죠', '이렇게 하면 바로 할게요'],
  auction: ['이번 경매는 좀 써볼게요', '저건 꼭 가져가야지', '눈치싸움 시작이네'],
};

const PRIOR = 0.825; // 상태를 모를 때 기대 배율 (정상·하자·고장 확률 가중평균)

export class BotBrain {
  private nextAct = 0;
  private cmd = 0;
  private bidDone = -1;
  private appraiseDone = -1;
  private readyAt = 0;
  private lastPhase = '';

  constructor(
    readonly pid: number,
    readonly p: Personality,
  ) {}

  private send(s: GameState, cmd: Command) {
    return dispatch(s, { cmdId: `bot${this.pid}-${++this.cmd}`, player: this.pid, cmd });
  }

  update(s: GameState, say: (sp: Speech) => void): void {
    if (s.phase === 'lobby' || s.phase === 'end') return;
    if (s.phase !== this.lastPhase) {
      this.lastPhase = s.phase;
      this.nextAct = s.now + 1 + Math.random() * 2;
      this.readyAt = s.now + (s.phase === 'trade' ? 35 + Math.random() * 25 : 4 + Math.random() * 6);
    }
    if (s.now < this.nextAct) return;
    this.nextAct = s.now + 1.5 + Math.random() * 2.5;
    const v = viewFor(s, this.pid);

    if (s.phase === 'market') this.market(s, v);
    else if (s.phase === 'auction') this.auction(s, v, say);
    else if (s.phase === 'trade') this.trade(s, v, say);

    if (!v.me.ready && s.now >= this.readyAt) this.send(s, { t: 'ready' });
  }

  // ----- 가치 판단 -----

  private mult(v: PlayerView, it: ItemView, guaranteed = false): number {
    if (it.known) return it.known.mult;
    if (guaranteed) return 1;
    let m = PRIOR * (1 - (v.event?.kind === 'fakeAlert' && it.owner === null ? CONFIG.fakeOddsAlert : CONFIG.fakeOdds) * 0.8);
    const owner = v.players.find((p) => p.id === it.owner);
    if (owner && owner.violations > 0) m *= 0.85;
    return m;
  }

  // 보유 물건 묶음의 예상 가치: 시세 × 상태 + 세트 보너스 + 목표 보너스
  private portfolio(v: PlayerView, ids: string[], guaranteed: string[] = []): number {
    let value = 0;
    const bySeries = new Map<string, Map<string, number>>();
    for (const id of ids) {
      const it = v.items[id];
      const val = v.prices[it.type] * this.mult(v, it, guaranteed.includes(id));
      value += val;
      if (it.known?.fake) continue;
      const series = TYPE_BY_ID[it.type].series;
      const m = bySeries.get(series) ?? new Map<string, number>();
      m.set(it.type, Math.max(m.get(it.type) ?? 0, val));
      bySeries.set(series, m);
    }
    for (const [series, m] of bySeries) {
      let sum = 0;
      for (const x of m.values()) sum += x;
      value += sum * CONFIG.setBonus[Math.min(m.size, CONFIG.setBonus.length - 1)] * 0.9;
      const g = v.me.goal;
      if (g.kind === 'collector' && g.series === series && m.size >= CONFIG.collectorCount) value += CONFIG.goalBonus.collector;
    }
    return value;
  }

  private mine(v: PlayerView): string[] {
    return v.players[this.pid].items;
  }

  private marginal(v: PlayerView, add: string[], remove: string[], guaranteed: string[] = []): number {
    const base = this.mine(v);
    const after = [...base.filter((id) => !remove.includes(id)), ...add];
    return this.portfolio(v, after, guaranteed) - this.portfolio(v, base);
  }

  // ----- 단계별 행동 -----

  private market(s: GameState, v: PlayerView): void {
    if (!this.p.appraiser || this.appraiseDone === v.round || v.me.cash < 150_000) return;
    this.appraiseDone = v.round;
    const best = v.lots
      .map((l) => ({ id: l.itemId, g: this.marginal(v, [l.itemId], []) }))
      .sort((a, b) => b.g - a.g)[0];
    if (best) this.send(s, { t: 'appraise', itemId: best.id });
  }

  private auction(s: GameState, v: PlayerView, say: (sp: Speech) => void): void {
    if (this.bidDone === v.round) return;
    this.bidDone = v.round;
    let budget = v.me.cash * 0.75;
    const wants = v.lots
      .map((l) => ({ l, g: this.marginal(v, [l.itemId], []) }))
      .sort((a, b) => b.g - a.g);
    let bids = 0;
    for (const { l, g } of wants) {
      const amount = Math.floor((g * this.p.bidAggro * (0.85 + Math.random() * 0.25)) / CONFIG.bidStep) * CONFIG.bidStep;
      if (amount < l.minBid || amount > budget) continue;
      if (this.send(s, { t: 'bid', itemId: l.itemId, amount }).ok) {
        budget -= amount;
        bids++;
      }
    }
    if (bids && Math.random() < 0.5) say({ who: this.pid, to: null, text: pickLine(LINES.auction) });
  }

  private trade(s: GameState, v: PlayerView, say: (sp: Speech) => void): void {
    // 받은 제안부터 처리 (사람처럼 조금 고민한 뒤에)
    const incoming = v.offers.filter((o) => o.to === this.pid && o.status === 'pending' && v.now - o.createdAt > 2.5);
    if (incoming.length) {
      this.respond(s, v, incoming[0], say);
      return;
    }
    if (v.me.cash < 40_000) {
      const dump = this.mine(v)
        .map((id) => v.items[id])
        .filter((it) => it.instantPrice !== null)
        .sort((a, b) => this.marginal(v, [], [a.id]) - this.marginal(v, [], [b.id]))
        .pop();
      if (dump) {
        this.send(s, { t: 'sell', itemId: dump.id });
        return;
      }
    }
    const pending = v.offers.filter((o) => o.from === this.pid && o.status === 'pending').length;
    if (pending >= 2 || Math.random() < 0.6) return;
    if (Math.random() < 0.5) this.proposeBuy(s, v, say);
    else this.proposeSell(s, v, say);
  }

  private proposeBuy(s: GameState, v: PlayerView, say: (sp: Speech) => void): void {
    const cands: { id: string; owner: number; gain: number; fair: number }[] = [];
    for (const p of v.players) {
      if (p.id === this.pid) continue;
      for (const id of p.items) {
        if (v.offers.some((o) => o.from === this.pid && o.status === 'pending' && o.wantItems.includes(id))) continue;
        const it = v.items[id];
        const fair = v.prices[it.type] * this.mult(v, it);
        cands.push({ id, owner: p.id, gain: this.marginal(v, [id], []) - fair, fair });
      }
    }
    const best = cands.sort((a, b) => b.gain - a.gain)[0];
    if (!best || best.gain < best.fair * 0.1) return;
    const cash = Math.min(Math.floor(v.me.cash * 0.6), round5k(best.fair * (0.85 + Math.random() * 0.25)));
    if (cash <= 0) return;
    const line = pickLine(LINES.buy);
    const r = this.send(s, {
      t: 'offer',
      to: best.owner,
      giveCash: cash,
      giveItems: [],
      wantCash: 0,
      wantItems: [best.id],
      guarantee: [],
      line,
    });
    if (r.ok) say({ who: this.pid, to: best.owner, text: line });
  }

  private proposeSell(s: GameState, v: PlayerView, say: (sp: Speech) => void): void {
    const offered = new Set(
      v.offers.filter((o) => o.from === this.pid && o.status === 'pending').flatMap((o) => o.giveItems),
    );
    const mine = this.mine(v).filter((id) => !offered.has(id));
    if (!mine.length) return;
    // 나한테 가치가 가장 적게 남는 물건을 판다. 사기꾼은 하자를 아는 물건부터.
    const scored = mine
      .map((id) => {
        const it = v.items[id];
        const bad = it.known && it.known.mult < 1;
        return { it, keep: -this.marginal(v, [], [id]) - (this.p.scammer && bad ? 1e6 : 0) };
      })
      .sort((a, b) => a.keep - b.keep);
    const it = scored[0].it;
    const others = v.players.filter((p) => p.id !== this.pid);
    // 같은 시리즈를 모으는 상대를 우선 노린다
    const series = TYPE_BY_ID[it.type].series;
    const target =
      others.find((p) => p.items.some((id) => TYPE_BY_ID[v.items[id].type].series === series)) ??
      others[Math.floor(Math.random() * others.length)];
    const known = it.known;
    const bad = !!known && known.mult < 1;
    const price = v.prices[it.type];
    let ask: number;
    let line: string;
    let guarantee: string[] = [];
    if (bad && this.p.scammer) {
      ask = round5k(price * (0.85 + Math.random() * 0.2));
      line = pickLine(LINES.pitchGood);
    } else if (bad) {
      ask = round5k(price * known!.mult * (1 + Math.random() * 0.15));
      line = pickLine(LINES.pitchHonest);
    } else {
      ask = round5k(price * (known ? 1 : PRIOR) * (1 + Math.random() * 0.2));
      line = pickLine(LINES.pitchGood);
      if (known && v.me.tokens > 0 && Math.random() < 0.5) {
        guarantee = [it.id];
        ask = round5k(ask * 1.1);
      }
    }
    if (ask <= 0) return;
    const r = this.send(s, {
      t: 'offer',
      to: target.id,
      giveCash: 0,
      giveItems: [it.id],
      wantCash: ask,
      wantItems: [],
      guarantee,
      line: guarantee.length ? `${line} (보증 붙여요)` : line,
    });
    if (r.ok) say({ who: this.pid, to: target.id, text: guarantee.length ? `${line}. 보증까지 해드려요` : line });
  }

  private respond(s: GameState, v: PlayerView, o: Offer, say: (sp: Speech) => void): void {
    const cashIn = o.giveCash * (1 - CONFIG.tradeFeeRate);
    const net = this.marginal(v, o.giveItems, o.wantItems, o.guarantee) + cashIn - o.wantCash;
    const scale = Math.max(
      20_000,
      o.wantCash,
      o.wantItems.reduce((a, id) => a + v.prices[v.items[id].type], 0),
    );
    if (net >= this.p.greed * scale) {
      if (this.send(s, { t: 'respond', offerId: o.id, accept: true }).ok) {
        say({ who: this.pid, to: o.from, text: pickLine(LINES.accept) });
      }
      return;
    }
    const deficit = round5k(this.p.greed * scale * 1.5 - net);
    const canCounter = o.depth < 2 && net > -scale * 0.35;
    if (canCounter) {
      // 내가 현금을 받는 쪽이면 더 달라고, 주는 쪽이면 덜 주겠다고 한다
      let giveCash = o.wantCash;
      let wantCash = o.giveCash;
      if (wantCash > 0 || giveCash === 0) wantCash += deficit;
      else giveCash = Math.max(0, giveCash - deficit);
      const line = pickLine(LINES.counter);
      const r = this.send(s, {
        t: 'offer',
        to: o.from,
        giveCash,
        giveItems: o.wantItems,
        wantCash,
        wantItems: o.giveItems,
        guarantee: [],
        line,
        counterOf: o.id,
      });
      if (r.ok) {
        say({ who: this.pid, to: o.from, text: line });
        return;
      }
    }
    this.send(s, { t: 'respond', offerId: o.id, accept: false });
    say({ who: this.pid, to: o.from, text: pickLine(LINES.reject) });
  }
}

const pickLine = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
const round5k = (v: number) => Math.max(0, Math.round(v / 5000) * 5000);
