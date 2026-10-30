// 게임 규칙의 유일한 권한자. 지금은 브라우저에서 돌지만, 그대로 서버로 옮길 수 있도록
// DOM과 렌더링에 의존하지 않고 모든 변경은 dispatch()와 tick()으로만 일어난다.
import { CONFIG, type Condition } from './config';
import { ITEM_TYPES, SERIES, SERIES_IDS, TYPE_BY_ID } from './items';
import type {
  AuctionResult,
  Command,
  Envelope,
  EventKind,
  FinalScore,
  GameState,
  Goal,
  Item,
  MarketEvent,
  Offer,
  Player,
  Result,
} from './types';

// ---------- 난수 (시드 고정, 상태에 저장) ----------

export function rand(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const pick = <T>(s: GameState, arr: readonly T[]): T => arr[Math.floor(rand(s) * arr.length)];
const roundTo = (v: number, step = 1000) => Math.round(v / step) * step;

// ---------- 생성 ----------

export interface PlayerSetup {
  name: string;
  bot: boolean;
}

export function createGame(seed: number, setups: PlayerSetup[]): GameState {
  const s: GameState = {
    phase: 'lobby',
    round: 0,
    now: 0,
    phaseEndsAt: 0,
    rng: seed >>> 0,
    seq: 0,
    version: 0,
    players: [],
    items: {},
    prices: {},
    prevPrices: {},
    lots: [],
    bids: [],
    offers: [],
    auctionResults: [],
    dumped: {},
    guarantees: [],
    event: null,
    nextEvent: null,
    log: [],
    reports: {},
    processed: {},
    final: null,
  };
  for (const t of ITEM_TYPES) {
    s.prices[t.id] = t.base;
    s.prevPrices[t.id] = t.base;
  }
  const goals = dealGoals(s, setups.length);
  s.players = setups.map((p, i) => ({
    id: i,
    name: p.name,
    bot: p.bot,
    cash: CONFIG.startCash,
    tokens: CONFIG.guaranteeTokens,
    violations: 0,
    goal: goals[i],
    trades: 0,
    partners: [],
    ready: false,
  }));
  for (const p of s.players) {
    for (let k = 0; k < CONFIG.startItems; k++) {
      const it = spawnItem(s, pick(s, ITEM_TYPES).id, CONFIG.fakeOdds);
      it.owner = p.id;
    }
  }
  return s;
}

function dealGoals(s: GameState, n: number): Goal[] {
  const series = [...SERIES_IDS].sort(() => rand(s) - 0.5);
  const kinds: Goal['kind'][] = ['collector', 'networker', 'dealer'];
  return Array.from({ length: n }, (_, i) => {
    const kind = i < 2 ? 'collector' : pick(s, kinds);
    return kind === 'collector' ? { kind, series: series[i % series.length] } : { kind };
  });
}

function spawnItem(s: GameState, type: string, fakeOdds: number): Item {
  const r = rand(s);
  const o = CONFIG.condition.odds;
  const condition: Condition = r < o.normal ? 'normal' : r < o.normal + o.defect ? 'defect' : 'broken';
  const item: Item = {
    id: `i${++s.seq}`,
    type,
    condition,
    fake: rand(s) < fakeOdds,
    owner: null,
    knownBy: [],
    cert: false,
  };
  s.items[item.id] = item;
  return item;
}

// ---------- 가치 계산 ----------

export function trueMult(item: Item): number {
  return CONFIG.condition.mult[item.condition] * (item.fake ? CONFIG.fakeMult : 1);
}

export function ownedItems(s: GameState, pid: number): Item[] {
  return Object.values(s.items).filter((i) => i.owner === pid);
}

// 같은 시리즈의 서로 다른 진품 종류 수에 따라 보너스. 종류마다 가장 비싼 한 개만 센다.
export function setBonus(items: { type: string; value: number; genuine: boolean }[]): number {
  let bonus = 0;
  for (const sid of SERIES_IDS) {
    const best = new Map<string, number>();
    for (const it of items) {
      if (!it.genuine || TYPE_BY_ID[it.type].series !== sid) continue;
      best.set(it.type, Math.max(best.get(it.type) ?? 0, it.value));
    }
    const rate = CONFIG.setBonus[Math.min(best.size, CONFIG.setBonus.length - 1)];
    let sum = 0;
    for (const v of best.values()) sum += v;
    bonus += sum * rate;
  }
  return bonus;
}

function goalMet(s: GameState, p: Player): boolean {
  const g = p.goal;
  if (g.kind === 'collector') {
    const types = new Set(
      ownedItems(s, p.id)
        .filter((i) => !i.fake && TYPE_BY_ID[i.type].series === g.series)
        .map((i) => i.type),
    );
    return types.size >= CONFIG.collectorCount;
  }
  if (g.kind === 'networker') return p.partners.length >= CONFIG.networkerPartners;
  return p.trades >= CONFIG.dealerTrades;
}

export function scorePlayer(s: GameState, pid: number, prices: Record<string, number>): FinalScore {
  const p = s.players[pid];
  const owned = ownedItems(s, pid).map((i) => ({
    type: i.type,
    value: prices[i.type] * trueMult(i),
    genuine: !i.fake,
  }));
  const items = owned.reduce((a, b) => a + b.value, 0);
  const sets = setBonus(owned);
  const goal = goalMet(s, p) ? CONFIG.goalBonus[p.goal.kind] : 0;
  return {
    player: pid,
    cash: p.cash,
    items: Math.round(items),
    sets: Math.round(sets),
    goal,
    total: Math.round(p.cash + items + sets + goal),
  };
}

// ---------- 명령 처리 ----------

export function dispatch(s: GameState, env: Envelope): Result {
  const prev = s.processed[env.cmdId];
  if (prev) return prev;
  const p = s.players[env.player];
  const res: Result = p ? handle(s, p, env.cmd) : { ok: false, error: '없는 플레이어입니다' };
  s.processed[env.cmdId] = res;
  if (res.ok) s.version++;
  return res;
}

const fail = (error: string): Result => ({ ok: false, error });

function handle(s: GameState, p: Player, c: Command): Result {
  switch (c.t) {
    case 'bid':
      return bid(s, p, c.itemId, c.amount);
    case 'appraise':
      return appraise(s, p, c.itemId);
    case 'sell':
      return sell(s, p, c.itemId);
    case 'cert':
      return cert(s, p, c.itemId);
    case 'offer':
      return offer(s, p, c);
    case 'respond':
      return respond(s, p, c.offerId, c.accept);
    case 'cancel':
      return cancel(s, p, c.offerId);
    case 'ready':
      if (s.phase === 'lobby' || s.phase === 'end') return fail('지금은 준비할 단계가 아닙니다');
      p.ready = true;
      return { ok: true };
  }
}

function lockedBids(s: GameState, pid: number, except?: string): number {
  return s.bids.filter((b) => b.player === pid && b.itemId !== except).reduce((a, b) => a + b.amount, 0);
}

function bid(s: GameState, p: Player, itemId: string, amount: number): Result {
  if (s.phase !== 'auction') return fail('경매 단계가 아닙니다');
  const lot = s.lots.find((l) => l.itemId === itemId);
  if (!lot) return fail('없는 매물입니다');
  if (!Number.isInteger(amount) || amount < 0) return fail('입찰액이 올바르지 않습니다');
  if (amount > 0 && amount < lot.minBid) return fail(`최소 입찰가는 ${lot.minBid.toLocaleString()}원입니다`);
  if (lockedBids(s, p.id, itemId) + amount > p.cash) return fail('입찰 총액이 보유 현금을 넘습니다');
  s.bids = s.bids.filter((b) => !(b.player === p.id && b.itemId === itemId));
  if (amount > 0) s.bids.push({ player: p.id, itemId, amount });
  return { ok: true };
}

function canAppraise(s: GameState, p: Player, item: Item): boolean {
  if (item.owner === p.id) return true;
  if (item.owner === null) return s.lots.some((l) => l.itemId === item.id);
  return s.offers.some(
    (o) =>
      o.status === 'pending' &&
      (o.from === p.id || o.to === p.id) &&
      (o.giveItems.includes(item.id) || o.wantItems.includes(item.id)),
  );
}

export function appraisalCost(s: GameState): number {
  return s.event?.kind === 'fakeAlert' ? CONFIG.appraisalCost / 2 : CONFIG.appraisalCost;
}

function appraise(s: GameState, p: Player, itemId: string): Result {
  if (!['market', 'auction', 'trade'].includes(s.phase)) return fail('지금은 감정할 수 없습니다');
  const item = s.items[itemId];
  if (!item) return fail('없는 물건입니다');
  if (item.cert || item.knownBy.includes(p.id)) return fail('이미 상태를 알고 있습니다');
  if (!canAppraise(s, p, item)) return fail('내 물건, 경매 매물, 나와 관련된 거래 제안의 물건만 감정할 수 있습니다');
  const cost = appraisalCost(s);
  if (p.cash - lockedBids(s, p.id) < cost) return fail('현금이 부족합니다');
  p.cash -= cost;
  item.knownBy.push(p.id);
  return { ok: true };
}

export function instantPrice(s: GameState, item: Item): number {
  return roundTo(s.prices[item.type] * CONFIG.instantSellRate * trueMult(item));
}

function sell(s: GameState, p: Player, itemId: string): Result {
  if (s.phase !== 'market' && s.phase !== 'trade') return fail('시장 공개나 직거래 단계에서만 팔 수 있습니다');
  const item = s.items[itemId];
  if (!item || item.owner !== p.id) return fail('내 물건이 아닙니다');
  p.cash += instantPrice(s, item);
  item.owner = null;
  s.dumped[item.type] = (s.dumped[item.type] ?? 0) + 1;
  failOffersUsing(s, [itemId]);
  s.log.push({ round: s.round, text: `${p.name}: ${TYPE_BY_ID[item.type].name}을(를) 매입처에 팔았습니다` });
  return { ok: true };
}

function cert(s: GameState, p: Player, itemId: string): Result {
  const item = s.items[itemId];
  if (!item || item.owner !== p.id) return fail('내 물건이 아닙니다');
  if (!item.knownBy.includes(p.id)) return fail('감정한 물건만 감정서를 공개할 수 있습니다');
  item.cert = true;
  return { ok: true };
}

function validateTerms(
  s: GameState,
  from: Player,
  to: Player,
  o: { giveCash: number; giveItems: string[]; wantCash: number; wantItems: string[]; guarantee: string[] },
): string | null {
  if (from.id === to.id) return '자신과는 거래할 수 없습니다';
  for (const v of [o.giveCash, o.wantCash]) if (!Number.isInteger(v) || v < 0) return '금액이 올바르지 않습니다';
  if (new Set(o.giveItems).size !== o.giveItems.length || new Set(o.wantItems).size !== o.wantItems.length)
    return '같은 물건이 중복되었습니다';
  if (o.giveItems.length + o.wantItems.length === 0) return '물건이 하나도 없는 거래입니다';
  for (const id of o.giveItems) if (s.items[id]?.owner !== from.id) return '제안한 사람의 물건이 아닙니다';
  for (const id of o.wantItems) if (s.items[id]?.owner !== to.id) return '상대의 물건이 아닙니다';
  if (from.cash < o.giveCash) return '제안한 사람의 현금이 부족합니다';
  if (to.cash < o.wantCash) return '상대의 현금이 부족합니다';
  if (!o.guarantee.every((id) => o.giveItems.includes(id))) return '내가 주는 물건만 보증할 수 있습니다';
  if (from.tokens < o.guarantee.length) return '보증권이 부족합니다';
  return null;
}

function offer(s: GameState, p: Player, c: Extract<Command, { t: 'offer' }>): Result {
  if (s.phase !== 'trade') return fail('직거래 단계가 아닙니다');
  const to = s.players[c.to];
  if (!to) return fail('없는 상대입니다');
  let depth = 0;
  if (c.counterOf) {
    const orig = s.offers.find((o) => o.id === c.counterOf);
    if (!orig || orig.status !== 'pending' || orig.to !== p.id || orig.from !== c.to)
      return fail('역제안할 수 없는 제안입니다');
    depth = orig.depth + 1;
  }
  const pending = s.offers.filter((o) => o.from === p.id && o.status === 'pending').length;
  if (pending >= CONFIG.maxPendingOffers) return fail(`대기 중인 제안은 ${CONFIG.maxPendingOffers}개까지입니다`);
  const err = validateTerms(s, p, to, c);
  if (err) return fail(err);
  if (c.counterOf) {
    const orig = s.offers.find((o) => o.id === c.counterOf)!;
    orig.status = 'rejected';
  }
  const o: Offer = {
    id: `o${++s.seq}`,
    from: p.id,
    to: to.id,
    giveCash: c.giveCash,
    giveItems: [...c.giveItems],
    wantCash: c.wantCash,
    wantItems: [...c.wantItems],
    guarantee: [...c.guarantee],
    line: c.line.slice(0, 60),
    counterOf: c.counterOf ?? null,
    depth,
    status: 'pending',
    createdAt: s.now,
    expiresAt: s.now + CONFIG.offerTtl,
  };
  s.offers.push(o);
  return { ok: true, offerId: o.id };
}

function respond(s: GameState, p: Player, offerId: string, accept: boolean): Result {
  const o = s.offers.find((x) => x.id === offerId);
  if (!o || o.to !== p.id) return fail('받은 제안이 아닙니다');
  if (o.status !== 'pending') return fail('이미 처리된 제안입니다');
  if (!accept) {
    o.status = 'rejected';
    return { ok: true };
  }
  if (s.phase !== 'trade') return fail('직거래 단계가 아닙니다');
  const from = s.players[o.from];
  // 수락 시점에 모든 조건을 다시 검증한다. 그사이 물건이나 현금이 바뀌었을 수 있다.
  const err = validateTerms(s, from, p, o);
  if (err) {
    o.status = 'failed';
    o.failReason = err;
    return fail(err);
  }
  executeTrade(s, o, from, p);
  return { ok: true };
}

// 검증이 끝난 뒤 한 번에 실행한다. 이 함수 안에서는 실패할 수 있는 단계가 없다.
function executeTrade(s: GameState, o: Offer, from: Player, to: Player): void {
  const fee = (v: number) => Math.round(v * CONFIG.tradeFeeRate);
  from.cash += -o.giveCash + o.wantCash - fee(o.wantCash);
  to.cash += o.giveCash - fee(o.giveCash) - o.wantCash;
  for (const id of o.giveItems) s.items[id].owner = to.id;
  for (const id of o.wantItems) s.items[id].owner = from.id;
  from.tokens -= o.guarantee.length;
  for (const id of o.guarantee) s.guarantees.push({ itemId: id, seller: from.id, buyer: to.id });
  for (const [a, b] of [
    [from, to],
    [to, from],
  ]) {
    a.trades++;
    if (!a.partners.includes(b.id)) a.partners.push(b.id);
  }
  o.status = 'accepted';
  const names = (ids: string[]) => ids.map((id) => TYPE_BY_ID[s.items[id].type].name).join(', ') || '현금';
  const g = o.guarantee.length ? ` · 보증 ${o.guarantee.length}개` : '';
  s.log.push({ round: s.round, text: `${from.name} → ${to.name}: ${names(o.giveItems)} ⇄ ${names(o.wantItems)}${g}` });
  failOffersUsing(s, [...o.giveItems, ...o.wantItems], o.id);
}

function failOffersUsing(s: GameState, itemIds: string[], except?: string): void {
  for (const x of s.offers) {
    if (x.status !== 'pending' || x.id === except) continue;
    if ([...x.giveItems, ...x.wantItems].some((id) => itemIds.includes(id))) {
      x.status = 'failed';
      x.failReason = '물건이 이미 다른 곳으로 넘어갔습니다';
    }
  }
}

function cancel(s: GameState, p: Player, offerId: string): Result {
  const o = s.offers.find((x) => x.id === offerId);
  if (!o || o.from !== p.id) return fail('내가 보낸 제안이 아닙니다');
  if (o.status !== 'pending') return fail('이미 처리된 제안입니다');
  o.status = 'cancelled';
  return { ok: true };
}

// ---------- 시간 진행 ----------

export function tick(s: GameState, dt: number): void {
  s.now += dt;
  for (const o of s.offers) {
    if (o.status === 'pending' && s.now >= o.expiresAt) {
      o.status = 'expired';
      s.version++;
    }
  }
  if (s.phase === 'lobby' || s.phase === 'end') return;
  if (s.now >= s.phaseEndsAt || s.players.every((p) => p.ready)) advance(s);
}

export function start(s: GameState): void {
  if (s.phase === 'lobby') startRound(s);
}

function enter(s: GameState, phase: GameState['phase'], seconds: number): void {
  s.phase = phase;
  s.phaseEndsAt = s.now + seconds;
  for (const p of s.players) p.ready = false;
  s.version++;
}

function advance(s: GameState): void {
  switch (s.phase) {
    case 'market':
      enter(s, 'auction', CONFIG.phaseTime.auction);
      break;
    case 'auction':
      resolveAuction(s);
      enter(s, 'trade', CONFIG.phaseTime.trade);
      break;
    case 'trade':
      for (const o of s.offers) if (o.status === 'pending') o.status = 'expired';
      settle(s);
      enter(s, 'settle', CONFIG.phaseTime.settle);
      break;
    case 'settle':
      if (s.round >= CONFIG.rounds) finish(s);
      else startRound(s);
      break;
    default:
      break;
  }
}

function startRound(s: GameState): void {
  s.round++;
  s.event = s.nextEvent;
  s.nextEvent = null;
  s.offers = [];
  s.bids = [];
  s.guarantees = [];
  s.dumped = {};
  s.reports = {};
  s.auctionResults = [];
  if (s.event) applyEvent(s, s.event);
  const fakeOdds = s.event?.kind === 'fakeAlert' ? CONFIG.fakeOddsAlert : CONFIG.fakeOdds;
  s.lots = [];
  const used = new Set<string>();
  while (s.lots.length < CONFIG.lotsPerRound) {
    const t = pick(s, ITEM_TYPES);
    if (used.has(t.id)) continue;
    used.add(t.id);
    const item = spawnItem(s, t.id, fakeOdds);
    s.lots.push({ itemId: item.id, minBid: roundTo(s.prices[t.id] * CONFIG.minBidRate, CONFIG.bidStep) });
  }
  enter(s, 'market', CONFIG.phaseTime.market);
}

function applyEvent(s: GameState, e: MarketEvent): void {
  if (e.kind === 'fakeAlert') return;
  const mult = e.kind === 'newRelease' ? CONFIG.eventEffect.newRelease : CONFIG.eventEffect.collectorBoom;
  for (const t of ITEM_TYPES) if (t.series === e.series) s.prices[t.id] = roundTo(s.prices[t.id] * mult);
}

export function describeEvent(e: MarketEvent): string {
  if (e.kind === 'newRelease') return `신제품 출시: ${SERIES[e.series!].name} 시세 하락`;
  if (e.kind === 'collectorBoom') return `수집가 유행: ${SERIES[e.series!].name} 시세 상승`;
  return '가품 주의보: 새 매물의 가품 비율 증가, 감정비 반값';
}

function resolveAuction(s: GameState): void {
  const worth = (pid: number) => scorePlayer(s, pid, s.prices).total;
  s.auctionResults = [];
  for (const lot of s.lots) {
    const bids = s.bids.filter((b) => b.itemId === lot.itemId);
    const item = s.items[lot.itemId];
    const res: AuctionResult = { itemId: lot.itemId, winner: null, price: 0, bidders: bids.length };
    if (bids.length) {
      // 최고가 우선, 동점이면 현재 순자산이 낮은 사람 (역전 장치), 그래도 같으면 무작위
      const order = bids
        .map((b) => ({ b, w: worth(b.player), r: rand(s) }))
        .sort((x, y) => y.b.amount - x.b.amount || x.w - y.w || x.r - y.r);
      const win = order[0].b;
      const p = s.players[win.player];
      p.cash -= win.amount;
      item.owner = p.id;
      res.winner = p.id;
      res.price = win.amount;
      s.log.push({
        round: s.round,
        text: `경매: ${TYPE_BY_ID[item.type].name} → ${p.name} (${win.amount.toLocaleString()}원, 입찰 ${bids.length}명)`,
      });
    }
    s.auctionResults.push(res);
  }
  s.bids = [];
  s.lots = [];
}

function settle(s: GameState): void {
  const report = (pid: number, text: string) => (s.reports[pid] ??= []).push(text);

  // 가진 물건의 실제 상태를 주인에게 알려준다
  for (const item of Object.values(s.items)) {
    if (item.owner === null || item.knownBy.includes(item.owner)) continue;
    item.knownBy.push(item.owner);
    if (item.condition !== 'normal' || item.fake) {
      const bad = [item.fake ? '가품' : '', item.condition === 'defect' ? '하자' : item.condition === 'broken' ? '고장' : '']
        .filter(Boolean)
        .join(' · ');
      report(item.owner, `${TYPE_BY_ID[item.type].name}: 확인해 보니 ${bad}`);
    }
  }

  // 보증 위반 처리: 손실분 + 벌금을 판매자가 구매자에게 지급
  for (const g of s.guarantees) {
    const item = s.items[g.itemId];
    if (item.condition === 'normal' && !item.fake) continue;
    const price = s.prices[item.type];
    const comp = roundTo(price * (1 - trueMult(item)) + price * CONFIG.falseGuaranteeFine);
    s.players[g.seller].cash -= comp;
    s.players[g.buyer].cash += comp;
    s.players[g.seller].violations++;
    s.log.push({ round: s.round, text: `보증 위반: ${s.players[g.seller].name} → ${s.players[g.buyer].name}에게 ${comp.toLocaleString()}원 배상` });
    report(g.buyer, `보증 위반 배상금 ${comp.toLocaleString()}원을 받았습니다`);
    report(g.seller, `보증 위반으로 ${comp.toLocaleString()}원을 배상했습니다`);
  }

  for (const p of s.players) {
    if (p.cash <= 0) continue;
    const interest = Math.min(CONFIG.interestCap, roundTo(p.cash * CONFIG.interestRate));
    p.cash += interest;
    report(p.id, `이자 +${interest.toLocaleString()}원`);
  }

  updatePrices(s);

  if (s.round < CONFIG.rounds && rand(s) < CONFIG.eventChance) {
    const kind = pick<EventKind>(s, ['newRelease', 'collectorBoom', 'fakeAlert']);
    const elec = SERIES_IDS.filter((id) => SERIES[id].electronic);
    const coll = SERIES_IDS.filter((id) => !SERIES[id].electronic);
    s.nextEvent =
      kind === 'fakeAlert' ? { kind } : { kind, series: pick(s, kind === 'newRelease' ? elec : coll) };
  }
}

// 직거래 가격은 담합으로 조작할 수 있으므로 시세에 반영하지 않는다
function updatePrices(s: GameState): void {
  const clamp = s.round >= CONFIG.rounds ? CONFIG.lastRoundClamp : CONFIG.priceClamp;
  s.prevPrices = { ...s.prices };
  for (const t of ITEM_TYPES) {
    let ch = (rand(s) * 2 - 1) * CONFIG.priceDrift;
    for (const r of s.auctionResults) {
      if (s.items[r.itemId].type !== t.id) continue;
      if (r.winner === null) ch -= 0.08;
      else ch += Math.max(-0.15, Math.min(0.15, (r.price / s.prices[t.id] - 0.8) * 0.4)) + 0.02 * (r.bidders - 1);
    }
    ch -= 0.03 * (s.dumped[t.id] ?? 0);
    ch = Math.max(-clamp, Math.min(clamp, ch));
    s.prices[t.id] = Math.max(10_000, roundTo(s.prices[t.id] * (1 + ch)));
  }
}

function finish(s: GameState): void {
  const prices: Record<string, number> = {};
  for (const t of ITEM_TYPES) {
    prices[t.id] = s.prices[t.id] * CONFIG.finalWeight + s.prevPrices[t.id] * (1 - CONFIG.finalWeight);
  }
  s.final = s.players.map((p) => scorePlayer(s, p.id, prices)).sort((a, b) => b.total - a.total);
  enter(s, 'end', 0);
}
