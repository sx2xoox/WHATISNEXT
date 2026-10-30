// NPC 4명으로 여러 판을 돌려 거래 수, 경매 낙찰, 보증 위반, 점수 분포를 확인한다
import { BotBrain, PERSONALITIES } from '../src/core/bots';
import { createGame, start, tick } from '../src/core/engine';

declare const process: { argv: string[] };
const GAMES = Number(process.argv[2] ?? 20);
const persona = [PERSONALITIES[0], ...PERSONALITIES];
const stats = { trades: 0, offers: 0, accepted: 0, countered: 0, auctions: 0, unsold: 0, violations: 0, dumps: 0 };
const wins: Record<string, number> = {};
const spreads: number[] = [];

for (let g = 0; g < GAMES; g++) {
  const s = createGame(1000 + g, persona.map((p, i) => ({ name: `${p.label}${i}`, bot: true })));
  const brains = persona.map((p, i) => new BotBrain(i, p));
  start(s);
  let guard = 0;
  let offersSeen = new Set<string>();
  while (s.phase !== 'end' && guard++ < 200000) {
    for (const b of brains) b.update(s, () => {});
    for (const o of s.offers) {
      if (offersSeen.has(o.id)) continue;
      if (o.status === 'pending') continue;
      offersSeen.add(o.id);
      stats.offers++;
      if (o.status === 'accepted') stats.accepted++;
      if (o.counterOf) stats.countered++;
    }
    if (s.phase === 'settle' && s.auctionResults.length) {
      for (const r of s.auctionResults) r.winner === null ? stats.unsold++ : stats.auctions++;
      s.auctionResults = [];
    }
    tick(s, 0.1);
  }
  stats.trades += s.log.filter((l) => l.text.includes('⇄')).length;
  stats.violations += s.log.filter((l) => l.text.startsWith('보증 위반')).length;
  stats.dumps += s.log.filter((l) => l.text.includes('매입처')).length;
  const f = s.final!;
  wins[s.players[f[0].player].name.replace(/\d$/, '')] = (wins[s.players[f[0].player].name.replace(/\d$/, '')] ?? 0) + 1;
  spreads.push(f[0].total - f[f.length - 1].total);
  if (g === 0) console.log('sample final', f, '\nlog tail', s.log.slice(-12).map((l) => l.text));
}
const per = (v: number) => (v / GAMES).toFixed(1);
console.log({ tradesPerGame: per(stats.trades), offersPerGame: per(stats.offers), acceptRate: (stats.accepted / stats.offers).toFixed(2), countersPerGame: per(stats.countered), soldLots: per(stats.auctions), unsoldLots: per(stats.unsold), violationsPerGame: per(stats.violations), dumpsPerGame: per(stats.dumps) });
console.log('wins', wins, 'avg spread', Math.round(spreads.reduce((a, b) => a + b, 0) / GAMES));
