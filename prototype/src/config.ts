// 경기장 크기 (월드 단위). x는 좌우, z는 화면 위아래.
export const ARENA_W = 20;
export const ARENA_H = 12;

// 시뮬레이션은 60Hz 고정, 유령 궤적은 30Hz로 기록
export const SIM_HZ = 60;
export const SAMPLE_EVERY = 2;
export const SAMPLE_DT = SAMPLE_EVERY / SIM_HZ;

export const ROUND_TIME = 20;
export const COUNTDOWN_TIME = 3;
export const ROUND_END_TIME = 2.2;
export const ROUNDS_PER_SET = 7;
export const GHOST_MEMORY = 3; // 최근 몇 라운드의 유령을 남길지
export const LAST_SURVIVOR_DELAY = 2.5;

export const PLAYER_RADIUS = 0.45;
export const GHOST_RADIUS = 0.38;
export const MOVE_SPEED = 6;
export const DASH_SPEED = 17;
export const DASH_TIME = 0.15;
export const DASH_COOLDOWN = 1.6;
export const PUSH_RANGE = 1.7;
export const PUSH_FORCE = 13;
export const PUSH_COOLDOWN = 1.0;
export const SPAWN_GRACE = 1.2;

export const COINS_PER_ROUND = 7;
export const COINS_SECOND_WAVE = 4;
export const COIN_PICK_RADIUS = 0.75;

export interface Slot {
  name: string;
  color: number;
  css: string;
}

export const PLAYER_SLOTS: Slot[] = [
  { name: '빨강', color: 0xff5a5f, css: '#ff5a5f' },
  { name: '파랑', color: 0x3ec1ff, css: '#3ec1ff' },
  { name: '노랑', color: 0xffc93c, css: '#ffc93c' },
  { name: '초록', color: 0x6fdc8c, css: '#6fdc8c' },
];
