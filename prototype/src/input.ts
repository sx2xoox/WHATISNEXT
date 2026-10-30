export interface Intent {
  mx: number;
  mz: number;
  dash: boolean;
  push: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
}

export const idleIntent = (): Intent => ({
  mx: 0,
  mz: 0,
  dash: false,
  push: false,
  left: false,
  right: false,
  confirm: false,
});

export interface KeySet {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  dash: string[];
  push: string[];
}

export type Source = { kind: 'keys'; keys: KeySet } | { kind: 'pad'; index: number };
// 빈 배열이면 봇
export type Control = Source[];

export const KEYS_P1: KeySet = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  dash: ['KeyF', 'Space'],
  push: ['KeyG'],
};

export const KEYS_P2: KeySet = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  dash: ['Slash', 'Numpad0'],
  push: ['Period', 'NumpadDecimal'],
};

const PAD_A = 0;
const PAD_B = 1;
const PAD_X = 2;
const PAD_START = 9;

const down = new Set<string>();
const pressed = new Set<string>();
const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash']);

export function installInput(): void {
  window.addEventListener('keydown', (e) => {
    if (!e.repeat) pressed.add(e.code);
    down.add(e.code);
    if (BLOCKED.has(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
}

interface PadState {
  buttons: boolean[];
  ax: number;
  ay: number;
}

let padNow: (PadState | null)[] = [];
let padPrev: (PadState | null)[] = [];

// 매 프레임 시작에 호출
export function pollInput(): void {
  padPrev = padNow;
  padNow = [];
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (let i = 0; i < pads.length; i++) {
    const g = pads[i];
    padNow[i] = g ? { buttons: g.buttons.map((b) => b.pressed), ax: g.axes[0] ?? 0, ay: g.axes[1] ?? 0 } : null;
  }
}

// 매 프레임 끝에 호출
export function clearEdges(): void {
  pressed.clear();
}

export const keyPressed = (code: string): boolean => pressed.has(code);

const anyDown = (codes: string[]) => codes.some((c) => down.has(c));
const anyPressed = (codes: string[]) => codes.some((c) => pressed.has(c));

function padEdge(i: number, b: number): boolean {
  return !!padNow[i]?.buttons[b] && !padPrev[i]?.buttons[b];
}

function padAxisEdge(i: number, dir: -1 | 1): boolean {
  const n = padNow[i]?.ax ?? 0;
  const p = padPrev[i]?.ax ?? 0;
  return dir < 0 ? n < -0.6 && p >= -0.6 : n > 0.6 && p <= 0.6;
}

export function anyPadStart(): boolean {
  return padNow.some((_, i) => padEdge(i, PAD_A) || padEdge(i, PAD_START));
}

export function connectedPads(): number {
  return padNow.filter(Boolean).length;
}

export function readIntent(control: Control): Intent {
  const it = idleIntent();
  for (const s of control) {
    if (s.kind === 'keys') {
      const k = s.keys;
      it.mx += (anyDown(k.right) ? 1 : 0) - (anyDown(k.left) ? 1 : 0);
      it.mz += (anyDown(k.down) ? 1 : 0) - (anyDown(k.up) ? 1 : 0);
      it.dash ||= anyPressed(k.dash);
      it.push ||= anyPressed(k.push);
      it.left ||= anyPressed(k.left);
      it.right ||= anyPressed(k.right);
      it.confirm ||= anyPressed(k.dash);
    } else {
      const i = s.index;
      const p = padNow[i];
      if (!p) continue;
      let ax = Math.abs(p.ax) > 0.2 ? p.ax : 0;
      let ay = Math.abs(p.ay) > 0.2 ? p.ay : 0;
      if (p.buttons[14]) ax = -1;
      if (p.buttons[15]) ax = 1;
      if (p.buttons[12]) ay = -1;
      if (p.buttons[13]) ay = 1;
      it.mx += ax;
      it.mz += ay;
      it.dash ||= padEdge(i, PAD_A);
      it.push ||= padEdge(i, PAD_X) || padEdge(i, PAD_B);
      it.left ||= padEdge(i, 14) || padAxisEdge(i, -1);
      it.right ||= padEdge(i, 15) || padAxisEdge(i, 1);
      it.confirm ||= padEdge(i, PAD_A);
    }
  }
  const len = Math.hypot(it.mx, it.mz);
  if (len > 1) {
    it.mx /= len;
    it.mz /= len;
  }
  return it;
}
