import './style.css';
import { describeEvent } from '../core/engine';
import { loadName, Menu } from './menu';
import { Scene3D } from './scene';
import { type GameSource, hasToken, LocalSource, OnlineSource } from './source';
import { Ui } from './ui';

declare global {
  interface Window {
    __ONLINE__?: boolean;
  }
}

// 게임 서버로 열었을 때(또는 개발 중)만 온라인 메뉴를 보여준다
const onlineAvailable = window.__ONLINE__ === true || import.meta.env.DEV;
const presetCode = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';

const scene = new Scene3D(document.getElementById('stage')!, document.getElementById('labels')!);
let source: GameSource | null = null;
let seatKey = '';

const ui = new Ui(document.getElementById('ui')!, (cmd) =>
  source ? source.act(cmd) : Promise.resolve({ ok: false, error: '게임이 시작되지 않았습니다' }),
);
const menu = new Menu(document.getElementById('menu')!, onlineAvailable, presetCode);

function use(src: GameSource): void {
  source = src;
  seatKey = '';
  ui.online = src.online;
  src.onSpeech = (who, to, text) => scene.say(who, text, to);
  ui.onSay = (text) => src.say(text);
  ui.onRestart = () => src.restart();
}

menu.onSolo = (name) => {
  use(new LocalSource(name));
  menu.hide();
};

function goOnline(name: string, code?: string): void {
  const net = new OnlineSource(name);
  use(net);
  net.onLobby = () => net.lobby && menu.room(net.lobby, net.me);
  net.onError = (message) => (net.view() ? ui.toast(message) : menu.error(message));
  net.onStatus = (connected) => {
    if (!connected && net.view()) ui.toast('연결이 끊겼습니다. 다시 접속하는 중…');
  };
  menu.onBots = (fill) => net.setBots(fill);
  menu.onStart = () => net.start();
  menu.onLeave = () => {
    net.close();
    source = null;
    menu.home();
  };
  menu.connecting();
  net.connect(code);
}

menu.onCreate = (name) => goOnline(name);
// 초대 링크로 들어왔고 이 방의 자리 토큰이 있으면 (새로고침 등) 바로 다시 들어간다
if (onlineAvailable && presetCode && hasToken(presetCode)) goOnline(loadName(), presetCode);
menu.onJoin = (name, code) => goOnline(name, code);
scene.onPick = (pid) => ui.openComposer(pid);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  source?.update(dt);
  const v = source?.view() ?? null;
  if (source && v) {
    menu.hide();
    const meta = source.meta();
    const key = `${source.me}|${meta.names.join(',')}`;
    if (key !== seatKey) {
      seatKey = key;
      scene.assign(source.me, meta.names);
    }
    const eventText = v.event
      ? describeEvent(v.event)
      : v.nextEvent && v.phase === 'settle'
        ? `예고 · ${describeEvent(v.nextEvent)}`
        : '';
    scene.update(v, dt, eventText, meta.offline);
    ui.render(v, meta);
  } else {
    scene.idle(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
