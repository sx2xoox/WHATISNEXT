import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/core/config';
import { createGame, dispatch, scorePlayer, setBonus, start, tick } from '../src/core/engine';
import type { Command, GameState } from '../src/core/types';

let n = 0;
const send = (s: GameState, player: number, cmd: Command, cmdId = `c${++n}`) => dispatch(s, { cmdId, player, cmd });

function newGame(): GameState {
  const s = createGame(42, [
    { name: 'A', bot: false },
    { name: 'B', bot: false },
    { name: 'C', bot: false },
    { name: 'D', bot: false },
  ]);
  start(s);
  return s;
}

// 모두 준비 완료를 눌러 다음 단계로 넘긴다
function skipPhase(s: GameState) {
  for (const p of s.players) send(s, p.id, { t: 'ready' });
  tick(s, 0);
}

function toTrade(s: GameState) {
  skipPhase(s); // market → auction
  skipPhase(s); // auction → trade
  expect(s.phase).toBe('trade');
}

const itemsOf = (s: GameState, pid: number) =>
  Object.values(s.items)
    .filter((i) => i.owner === pid)
    .map((i) => i.id);

describe('경매', () => {
  it('최고가 입찰자가 낙찰받고 입찰액을 지불한다', () => {
    const s = newGame();
    skipPhase(s);
    const lot = s.lots[0];
    expect(send(s, 0, { t: 'bid', itemId: lot.itemId, amount: lot.minBid }).ok).toBe(true);
    expect(send(s, 1, { t: 'bid', itemId: lot.itemId, amount: lot.minBid + 10_000 }).ok).toBe(true);
    skipPhase(s);
    expect(s.items[lot.itemId].owner).toBe(1);
    expect(s.players[1].cash).toBe(CONFIG.startCash - lot.minBid - 10_000);
    expect(s.players[0].cash).toBe(CONFIG.startCash);
  });

  it('입찰 총액은 보유 현금을 넘을 수 없다', () => {
    const s = newGame();
    skipPhase(s);
    const [a, b] = s.lots;
    expect(send(s, 0, { t: 'bid', itemId: a.itemId, amount: 400_000 }).ok).toBe(true);
    expect(send(s, 0, { t: 'bid', itemId: b.itemId, amount: 200_000 }).ok).toBe(false);
    // 같은 매물 입찰 수정은 기존 입찰을 빼고 계산
    expect(send(s, 0, { t: 'bid', itemId: a.itemId, amount: 450_000 }).ok).toBe(true);
  });

  it('실패한 입찰 수정은 기존 입찰을 지우지 않는다', () => {
    const s = newGame();
    skipPhase(s);
    const lot = s.lots[0];
    send(s, 0, { t: 'bid', itemId: lot.itemId, amount: lot.minBid });
    expect(send(s, 0, { t: 'bid', itemId: lot.itemId, amount: 1 }).ok).toBe(false);
    expect(s.bids.find((b) => b.player === 0)?.amount).toBe(lot.minBid);
  });

  it('동점이면 순자산이 낮은 플레이어가 이긴다', () => {
    const s = newGame();
    s.players[1].cash -= 100_000;
    skipPhase(s);
    const lot = s.lots[0];
    send(s, 0, { t: 'bid', itemId: lot.itemId, amount: lot.minBid });
    send(s, 1, { t: 'bid', itemId: lot.itemId, amount: lot.minBid });
    skipPhase(s);
    expect(s.items[lot.itemId].owner).toBe(1);
  });
});

describe('직거래', () => {
  it('수락하면 물건과 현금이 한 번에 교환되고 수수료가 빠진다', () => {
    const s = newGame();
    toTrade(s);
    const item = itemsOf(s, 0)[0];
    const r = send(s, 0, { t: 'offer', to: 1, giveCash: 0, giveItems: [item], wantCash: 100_000, wantItems: [], guarantee: [], line: '' });
    expect(r.ok).toBe(true);
    const offerId = (r as { offerId: string }).offerId;
    expect(s.items[item].owner).toBe(0); // 수락 전에는 소유권이 그대로
    expect(send(s, 1, { t: 'respond', offerId, accept: true }).ok).toBe(true);
    expect(s.items[item].owner).toBe(1);
    expect(s.players[0].cash).toBe(CONFIG.startCash + 100_000 - 5_000);
    expect(s.players[1].cash).toBe(CONFIG.startCash - 100_000);
  });

  it('같은 요청을 두 번 보내도 한 번만 처리된다', () => {
    const s = newGame();
    toTrade(s);
    const item = itemsOf(s, 0)[0];
    const r = send(s, 0, { t: 'offer', to: 1, giveCash: 0, giveItems: [item], wantCash: 50_000, wantItems: [], guarantee: [], line: '' });
    const offerId = (r as { offerId: string }).offerId;
    const first = send(s, 1, { t: 'respond', offerId, accept: true }, 'dup');
    const again = send(s, 1, { t: 'respond', offerId, accept: true }, 'dup');
    expect(first).toEqual(again);
    expect(s.players[1].cash).toBe(CONFIG.startCash - 50_000);
  });

  it('같은 물건을 두 명에게 제안해도 한 명에게만 넘어간다', () => {
    const s = newGame();
    toTrade(s);
    const item = itemsOf(s, 0)[0];
    const o1 = send(s, 0, { t: 'offer', to: 1, giveCash: 0, giveItems: [item], wantCash: 50_000, wantItems: [], guarantee: [], line: '' }) as { offerId: string };
    const o2 = send(s, 0, { t: 'offer', to: 2, giveCash: 0, giveItems: [item], wantCash: 60_000, wantItems: [], guarantee: [], line: '' }) as { offerId: string };
    expect(send(s, 2, { t: 'respond', offerId: o2.offerId, accept: true }).ok).toBe(true);
    expect(send(s, 1, { t: 'respond', offerId: o1.offerId, accept: true }).ok).toBe(false);
    expect(s.items[item].owner).toBe(2);
    expect(s.offers.find((o) => o.id === o1.offerId)?.status).toBe('failed');
    expect(s.players[1].cash).toBe(CONFIG.startCash);
  });

  it('수락 시점에 현금이 부족하면 거래가 실패한다', () => {
    const s = newGame();
    toTrade(s);
    const item = itemsOf(s, 1)[0];
    const o = send(s, 0, { t: 'offer', to: 1, giveCash: 300_000, giveItems: [], wantCash: 0, wantItems: [item], guarantee: [], line: '' }) as { offerId: string };
    s.players[0].cash = 100_000;
    expect(send(s, 1, { t: 'respond', offerId: o.offerId, accept: true }).ok).toBe(false);
    expect(s.items[item].owner).toBe(1);
  });

  it('제안은 만료 시간이 지나면 수락할 수 없다', () => {
    const s = newGame();
    toTrade(s);
    const item = itemsOf(s, 0)[0];
    const o = send(s, 0, { t: 'offer', to: 1, giveCash: 0, giveItems: [item], wantCash: 10_000, wantItems: [], guarantee: [], line: '' }) as { offerId: string };
    tick(s, CONFIG.offerTtl + 0.1);
    expect(send(s, 1, { t: 'respond', offerId: o.offerId, accept: true }).ok).toBe(false);
  });

  it('보증권보다 많이 보증할 수 없다', () => {
    const s = newGame();
    toTrade(s);
    s.players[0].tokens = 0;
    const item = itemsOf(s, 0)[0];
    const r = send(s, 0, { t: 'offer', to: 1, giveCash: 0, giveItems: [item], wantCash: 10_000, wantItems: [], guarantee: [item], line: '' });
    expect(r.ok).toBe(false);
  });
});

describe('보증과 정산', () => {
  it('보증한 물건이 고장이면 판매자가 배상하고 위반 기록이 남는다', () => {
    const s = newGame();
    toTrade(s);
    const item = itemsOf(s, 0)[0];
    s.items[item].condition = 'broken';
    s.items[item].fake = false;
    const o = send(s, 0, { t: 'offer', to: 1, giveCash: 0, giveItems: [item], wantCash: 50_000, wantItems: [], guarantee: [item], line: '' }) as { offerId: string };
    send(s, 1, { t: 'respond', offerId: o.offerId, accept: true });
    const before = s.players[1].cash;
    const price = s.prices[s.items[item].type];
    skipPhase(s); // trade → settle
    expect(s.players[0].violations).toBe(1);
    const comp = Math.round((price * 0.75 + price * CONFIG.falseGuaranteeFine) / 1000) * 1000;
    expect(s.players[1].cash).toBeGreaterThanOrEqual(before + comp);
  });

  it('정산 때 주인은 자기 물건의 실제 상태를 알게 된다', () => {
    const s = newGame();
    toTrade(s);
    const item = itemsOf(s, 2)[0];
    expect(s.items[item].knownBy).not.toContain(2);
    skipPhase(s);
    expect(s.items[item].knownBy).toContain(2);
  });

  it('세트 보너스는 서로 다른 진품 종류 수로 계산한다', () => {
    const v = 100;
    expect(setBonus([{ type: 'gameboy', value: v, genuine: true }])).toBe(0);
    expect(setBonus([
      { type: 'gameboy', value: v, genuine: true },
      { type: 'gameboy', value: v, genuine: true },
    ])).toBe(0);
    expect(setBonus([
      { type: 'gameboy', value: v, genuine: true },
      { type: 'cartridge', value: v, genuine: true },
      { type: 'padset', value: v, genuine: true },
    ])).toBeCloseTo(300 * 0.6);
    expect(setBonus([
      { type: 'gameboy', value: v, genuine: true },
      { type: 'cartridge', value: v, genuine: false },
    ])).toBe(0);
  });

  it('5라운드가 끝나면 순자산 순위가 나온다', () => {
    const s = newGame();
    for (let i = 0; i < CONFIG.rounds * 4 && s.phase !== 'end'; i++) skipPhase(s);
    expect(s.phase).toBe('end');
    expect(s.final).toHaveLength(4);
    const totals = s.final!.map((f) => f.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    expect(scorePlayer(s, 0, s.prices).cash).toBe(s.players[0].cash);
  });
});
