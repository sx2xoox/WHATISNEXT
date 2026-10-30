import './style.css';
import { BotBrain, PERSONALITIES } from '../core/bots';
import { createGame, describeEvent, dispatch, start, tick } from '../core/engine';
import type { Command, GameState } from '../core/types';
import { viewFor } from '../core/view';
import { Scene3D } from './scene';
import { Ui } from './ui';

const NAMES = ['나', '민수', '지은', '태호'];
const ME = 0;

const scene = new Scene3D(document.getElementById('stage')!, document.getElementById('labels')!);
let game: GameState;
let brains: BotBrain[] = [];
let cmdSeq = 0;

const ui = new Ui(document.getElementById('ui')!, (cmd: Command) =>
  dispatch(game, { cmdId: `me-${++cmdSeq}`, player: ME, cmd }),
);

function newGame(): void {
  game = createGame(Math.floor(Math.random() * 2 ** 31), NAMES.map((name, i) => ({ name, bot: i !== ME })));
  // 성격은 숨겨 두고 끝나면 공개한다
  const personas = [...PERSONALITIES].sort(() => Math.random() - 0.5);
  brains = personas.map((p, i) => new BotBrain(i + 1, p));
  ui.botLabels = ['', ...personas.map((p) => p.label)];
  scene.setNames(NAMES);
}

ui.onEnter = () => start(game);
ui.onRestart = () => {
  newGame();
  start(game);
};
scene.onPick = (pid) => ui.openComposer(pid);

newGame();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(game, dt);
  for (const b of brains) b.update(game, (sp) => scene.say(sp.who, sp.text, sp.to));
  const v = viewFor(game, ME);
  const eventText = v.event ? describeEvent(v.event) : v.nextEvent && v.phase === 'settle' ? `예고 · ${describeEvent(v.nextEvent)}` : '';
  scene.update(v, dt, eventText);
  ui.render(v);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
