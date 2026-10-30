import './style.css';
import { SIM_HZ } from './config';
import { Game } from './game';
import { Hud, type MenuState } from './hud';
import {
  anyPadStart,
  clearEdges,
  connectedPads,
  idleIntent,
  installInput,
  type Intent,
  keyPressed,
  pollInput,
  readIntent,
} from './input';
import { View } from './view';

installInput();

const game = new Game();
const view = new View(document.getElementById('stage')!);
const menu: MenuState = { humans: 1, fillBots: true, pads: 0 };

function start(): void {
  game.configure(menu.humans, menu.fillBots);
  view.setPlayers(game.players);
  game.startSet();
}

function act(action: string): void {
  if (action.startsWith('humans-')) menu.humans = Number(action.slice(7));
  else if (action === 'bots') menu.fillBots = !menu.fillBots;
  else if (action === 'start') start();
  else if (action === 'restart') game.startSet();
  else if (action === 'title') game.toTitle();
  else if (action.startsWith('pick-')) {
    const [, who, which] = action.split('-').map(Number);
    game.pickCard(who, which);
  }
}

const hud = new Hud(document.getElementById('hud')!, act);

function handleMenus(): void {
  const go = keyPressed('Enter') || keyPressed('Space') || anyPadStart();
  if (game.phase === 'title') {
    for (let n = 1; n <= 4; n++) if (keyPressed(`Digit${n}`)) menu.humans = n;
    if (keyPressed('KeyB')) menu.fillBots = !menu.fillBots;
    if (go) start();
  } else if (game.phase === 'setEnd') {
    if (go) act('restart');
    if (keyPressed('Escape')) act('title');
  }
}

// 고정 스텝이 한 번도 돌지 않은 프레임의 버튼 입력이 사라지지 않도록 모아 둔다
let pending: Intent[] = [];

function mergeIntents(fresh: Intent[]): void {
  pending = fresh.map((f, i) => {
    const p = pending[i];
    if (!p) return f;
    return {
      ...f,
      dash: f.dash || p.dash,
      push: f.push || p.push,
      left: f.left || p.left,
      right: f.right || p.right,
      confirm: f.confirm || p.confirm,
    };
  });
}

const STEP = 1 / SIM_HZ;
let acc = 0;
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  pollInput();
  menu.pads = connectedPads();
  handleMenus();

  mergeIntents(game.players.map((p) => (p.bot ? game.botIntent(p) : readIntent(p.control))));
  acc += dt;
  while (acc >= STEP) {
    game.update(STEP, pending);
    pending = pending.map((p) => ({ ...idleIntent(), mx: p.mx, mz: p.mz }));
    acc -= STEP;
  }

  view.render(game);
  hud.render(game, menu);
  clearEdges();
  requestAnimationFrame(frame);
}

// ?demo 로 열면 봇 4명이 플레이하는 관전 모드로 바로 시작
if (new URLSearchParams(location.search).has('demo')) {
  menu.humans = 0;
  menu.fillBots = true;
  start();
}

requestAnimationFrame(frame);
