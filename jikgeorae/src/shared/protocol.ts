// 클라이언트와 서버가 주고받는 메시지
import type { Command, Result } from '../core/types';
import type { PlayerView } from '../core/view';

export const MAX_PLAYERS = 4;

export const QUICK_LINES = ['얼마면 돼요?', '사기 아니죠?', '보증 붙여주세요', '그거 저 주세요', '에이 비싸요', '콜!', 'ㅋㅋㅋㅋ'];

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string; token?: string }
  | { t: 'bots'; fill: boolean }
  | { t: 'start' }
  | { t: 'restart' }
  | { t: 'cmd'; cmdId: string; cmd: Command }
  | { t: 'say'; text: string };

export interface LobbyPlayer {
  pid: number;
  name: string;
  connected: boolean;
  host: boolean;
}

export interface RoomMeta {
  names: string[];
  offline: number[];
  botLabels: string[]; // 게임이 끝났을 때만 채운다
  hostPid: number;
}

export type ServerMsg =
  | { t: 'joined'; code: string; pid: number; token: string }
  | { t: 'lobby'; code: string; players: LobbyPlayer[]; fillBots: boolean; hostPid: number }
  | { t: 'view'; view: PlayerView; meta: RoomMeta }
  | { t: 'result'; cmdId: string; result: Result }
  | { t: 'speech'; who: number; to: number | null; text: string }
  | { t: 'error'; message: string };
