// 플레이어 한 명에게 보여줄 수 있는 정보만 걸러낸다.
// 온라인 버전에서는 서버가 이 결과만 각 클라이언트로 보낸다.
import type { Condition } from './config';
import { appraisalCost, instantPrice, trueMult } from './engine';
import type { AuctionResult, FinalScore, GameState, Goal, LogEntry, MarketEvent, Offer, Phase } from './types';

export interface ItemView {
  id: string;
  type: string;
  owner: number | null;
  known: { condition: Condition; fake: boolean; mult: number } | null;
  cert: boolean;
  instantPrice: number | null; // 내 물건이고 상태를 알 때만
}

export interface OtherPlayerView {
  id: number;
  name: string;
  bot: boolean;
  violations: number;
  trades: number;
  ready: boolean;
  items: string[];
}

export interface PlayerView {
  me: {
    id: number;
    cash: number;
    locked: number;
    tokens: number;
    goal: Goal;
    trades: number;
    partners: number[];
    ready: boolean;
  };
  players: OtherPlayerView[];
  items: Record<string, ItemView>;
  lots: { itemId: string; minBid: number }[];
  myBids: Record<string, number>;
  offers: Offer[];
  prices: Record<string, number>;
  prevPrices: Record<string, number>;
  phase: Phase;
  round: number;
  timeLeft: number;
  now: number;
  event: MarketEvent | null;
  nextEvent: MarketEvent | null;
  appraisalCost: number;
  auctionResults: AuctionResult[];
  log: LogEntry[];
  reports: string[];
  final: FinalScore[] | null;
  version: number;
}

export function viewFor(s: GameState, pid: number): PlayerView {
  const me = s.players[pid];
  const visible = new Set<string>();
  for (const l of s.lots) visible.add(l.itemId);
  for (const r of s.auctionResults) visible.add(r.itemId);
  for (const it of Object.values(s.items)) if (it.owner !== null) visible.add(it.id);

  const items: Record<string, ItemView> = {};
  for (const id of visible) {
    const it = s.items[id];
    const knows = it.cert || it.knownBy.includes(pid);
    items[id] = {
      id,
      type: it.type,
      owner: it.owner,
      known: knows ? { condition: it.condition, fake: it.fake, mult: trueMult(it) } : null,
      cert: it.cert,
      instantPrice: it.owner === pid && knows ? instantPrice(s, it) : null,
    };
  }

  const myBids: Record<string, number> = {};
  for (const b of s.bids) if (b.player === pid) myBids[b.itemId] = b.amount;

  return {
    me: {
      id: pid,
      cash: me.cash,
      locked: Object.values(myBids).reduce((a, b) => a + b, 0),
      tokens: me.tokens,
      goal: me.goal,
      trades: me.trades,
      partners: [...me.partners],
      ready: me.ready,
    },
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      violations: p.violations,
      trades: p.trades,
      ready: p.ready,
      items: Object.values(s.items)
        .filter((i) => i.owner === p.id)
        .map((i) => i.id),
    })),
    items,
    lots: s.lots.map((l) => ({ ...l })),
    myBids,
    offers: s.offers.filter((o) => o.from === pid || o.to === pid).map((o) => ({ ...o })),
    prices: { ...s.prices },
    prevPrices: { ...s.prevPrices },
    phase: s.phase,
    round: s.round,
    timeLeft: Math.max(0, s.phaseEndsAt - s.now),
    now: s.now,
    event: s.event,
    nextEvent: s.nextEvent,
    appraisalCost: appraisalCost(s),
    auctionResults: s.auctionResults.map((r) => ({ ...r })),
    log: s.log.slice(-40),
    reports: [...(s.reports[pid] ?? [])],
    final: s.final,
    version: s.version,
  };
}
