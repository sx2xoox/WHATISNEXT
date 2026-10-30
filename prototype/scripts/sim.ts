// 봇 4명으로 세트를 여러 번 돌려 라운드별 생존율과 점수를 확인하는 밸런스 점검용 스크립트
import { Game } from '../src/game';
import { SIM_HZ } from '../src/config';

declare const process: { argv: string[] };
const SETS = Number(process.argv[2] ?? 30);
const dt = 1 / SIM_HZ;
const survivedByRound: number[] = [];
const playedByRound: number[] = [];
const roundLength: number[] = [];
const winnerScores: number[] = [];

for (let s = 0; s < SETS; s++) {
  const game = new Game();
  game.configure(0, true);
  game.startSet();
  let guard = 0;
  while (game.phase !== 'setEnd' && guard++ < 200000) {
    const prevPhase = game.phase;
    game.update(dt, game.players.map((p) => game.botIntent(p)));
    if (prevPhase === 'play' && game.phase === 'roundEnd') {
      const r = game.round - 1;
      survivedByRound[r] = (survivedByRound[r] ?? 0) + game.players.filter((p) => p.survived).length;
      playedByRound[r] = (playedByRound[r] ?? 0) + game.players.length;
      roundLength[r] = (roundLength[r] ?? 0) + game.roundT;
    }
  }
  winnerScores.push(Math.max(...game.players.map((p) => p.score)));
}

console.log('round | survival | avg length(s)');
survivedByRound.forEach((v, r) => {
  console.log(`${r + 1}     | ${((v / playedByRound[r]) * 100).toFixed(0).padStart(3)}%     | ${(roundLength[r] / SETS).toFixed(1)}`);
});
console.log('avg winner score', (winnerScores.reduce((a, b) => a + b, 0) / SETS).toFixed(1));
