import type { Condition } from './config';
import type { SeriesId } from './items';

export type Phase = 'lobby' | 'market' | 'auction' | 'trade' | 'settle' | 'end';

export interface Item {
  id: string;
  type: string;
  condition: Condition;
  fake: boolean;
  owner: number | null; // null = 경매 매물이거나 매입처에 팔려 사라짐
  knownBy: number[]; // 실제 상태를 아는 플레이어
  cert: boolean; // 감정서가 공개되어 모두가 상태를 앎
}

export interface Lot {
  itemId: string;
  minBid: number;
}

export interface Bid {
  player: number;
  itemId: string;
  amount: number;
}

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'failed';

export interface Offer {
  id: string;
  from: number;
  to: number;
  giveCash: number;
  giveItems: string[];
  wantCash: number;
  wantItems: string[];
  guarantee: string[]; // 보낸 사람이 보증하는 자기 물건 (giveItems의 부분집합)
  line: string;
  counterOf: string | null;
  depth: number; // 역제안이 몇 번 이어졌는지
  status: OfferStatus;
  createdAt: number;
  expiresAt: number;
  failReason?: string;
}

export type GoalKind = 'collector' | 'networker' | 'dealer';

export interface Goal {
  kind: GoalKind;
  series?: SeriesId;
}

export interface Player {
  id: number;
  name: string;
  bot: boolean;
  cash: number;
  tokens: number;
  violations: number; // 보증 위반 횟수 (공개)
  goal: Goal;
  trades: number;
  partners: number[];
  ready: boolean;
}

export type EventKind = 'newRelease' | 'collectorBoom' | 'fakeAlert';

export interface MarketEvent {
  kind: EventKind;
  series?: SeriesId;
}

export interface GuaranteeRecord {
  itemId: string;
  seller: number;
  buyer: number;
}

export interface LogEntry {
  round: number;
  text: string;
}

export interface AuctionResult {
  itemId: string;
  winner: number | null;
  price: number;
  bidders: number;
}

export interface FinalScore {
  player: number;
  cash: number;
  items: number;
  sets: number;
  goal: number;
  total: number;
}

export interface GameState {
  phase: Phase;
  round: number;
  now: number;
  phaseEndsAt: number;
  rng: number;
  seq: number;
  version: number;
  players: Player[];
  items: Record<string, Item>;
  prices: Record<string, number>;
  prevPrices: Record<string, number>;
  lots: Lot[];
  bids: Bid[];
  offers: Offer[];
  auctionResults: AuctionResult[];
  dumped: Record<string, number>;
  guarantees: GuaranteeRecord[];
  event: MarketEvent | null;
  nextEvent: MarketEvent | null;
  log: LogEntry[];
  reports: Record<number, string[]>; // 정산 때 각자에게만 보이는 메시지
  processed: Record<string, Result>;
  final: FinalScore[] | null;
}

export type Command =
  | { t: 'bid'; itemId: string; amount: number }
  | { t: 'appraise'; itemId: string }
  | { t: 'sell'; itemId: string }
  | { t: 'cert'; itemId: string }
  | {
      t: 'offer';
      to: number;
      giveCash: number;
      giveItems: string[];
      wantCash: number;
      wantItems: string[];
      guarantee: string[];
      line: string;
      counterOf?: string;
    }
  | { t: 'respond'; offerId: string; accept: boolean }
  | { t: 'cancel'; offerId: string }
  | { t: 'ready' };

// 같은 cmdId로 다시 보내면 처음 결과를 그대로 돌려준다 (중복 요청 방지)
export interface Envelope {
  cmdId: string;
  player: number;
  cmd: Command;
}

export type Result = { ok: true; offerId?: string } | { ok: false; error: string };
