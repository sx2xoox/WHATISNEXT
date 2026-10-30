// 게임 시작 전 화면: 혼자 하기, 방 만들기, 방 참가, 대기실
import { MAX_PLAYERS } from '../shared/protocol';
import { PLAYER_CSS } from './scene';
import type { LobbyState } from './source';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Screen = { kind: 'home'; error?: string } | { kind: 'connecting' } | { kind: 'room'; lobby: LobbyState; me: number; error?: string };

export class Menu {
  private screen: Screen = { kind: 'home' };
  onSolo: (name: string) => void = () => {};
  onCreate: (name: string) => void = () => {};
  onJoin: (name: string, code: string) => void = () => {};
  onBots: (fill: boolean) => void = () => {};
  onStart: () => void = () => {};
  onLeave: () => void = () => {};

  constructor(
    private root: HTMLElement,
    private online: boolean,
    private presetCode = '',
  ) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-m]');
      if (!el) return;
      const name = this.value('m-name');
      if (name) saveName(name);
      switch (el.dataset.m) {
        case 'solo':
          this.onSolo(name || '나');
          break;
        case 'create':
          this.onCreate(name);
          break;
        case 'join': {
          const code = this.value('m-code').toUpperCase();
          if (code.length !== 4) return this.home('방 코드 4자리를 입력하세요');
          this.onJoin(name, code);
          break;
        }
        case 'bots':
          if (this.screen.kind === 'room') this.onBots(!this.screen.lobby.fillBots);
          break;
        case 'start':
          this.onStart();
          break;
        case 'copy':
          this.copyLink(el);
          break;
        case 'leave':
          this.onLeave();
          break;
      }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).id === 'm-code') root.querySelector<HTMLElement>('[data-m=join]')?.click();
    });
    this.home();
  }

  private value(id: string): string {
    return this.root.querySelector<HTMLInputElement>(`#${id}`)?.value.trim() ?? '';
  }

  hide(): void {
    this.root.hidden = true;
  }

  home(error?: string): void {
    this.screen = { kind: 'home', error };
    this.draw();
  }

  connecting(): void {
    this.screen = { kind: 'connecting' };
    this.draw();
  }

  room(lobby: LobbyState, me: number, error?: string): void {
    this.screen = { kind: 'room', lobby, me, error };
    this.draw();
  }

  error(message: string): void {
    if (this.screen.kind === 'room') this.room(this.screen.lobby, this.screen.me, message);
    else this.home(message);
  }

  private inviteLink(code: string): string {
    return `${location.origin}${location.pathname}?room=${code}`;
  }

  private async copyLink(el: HTMLElement): Promise<void> {
    if (this.screen.kind !== 'room') return;
    const link = this.inviteLink(this.screen.lobby.code);
    try {
      await navigator.clipboard.writeText(link);
      el.textContent = '복사됨';
    } catch {
      this.root.querySelector<HTMLInputElement>('#m-link')?.select();
    }
  }

  private draw(): void {
    this.root.hidden = false;
    const s = this.screen;
    let body = '';
    if (s.kind === 'home') {
      const online = this.online
        ? `<div class="m-online">
            <button class="primary big" data-m="create">친구랑 하기 (방 만들기)</button>
            <div class="m-join"><label for="m-code">받은 방 코드</label>
              <input id="m-code" maxlength="4" autocomplete="off" value="${esc(this.presetCode)}" placeholder="ABCD">
              <button data-m="join">참가</button></div>
          </div>`
        : `<p class="hint">친구랑 하려면 게임 서버 주소로 접속하세요.</p>`;
      body = `
        <h1>직거래</h1>
        <p class="lede">중고 물건을 싸게 사서 비싸게 팔자! 친구를 속이거나, 속지 않거나.</p>
        <div class="m-name"><label for="m-name">내 이름</label><input id="m-name" maxlength="10" autocomplete="nickname" value="${esc(loadName())}" placeholder="이름"></div>
        <div class="m-actions">
          <button class="${this.online ? '' : 'primary'} big" data-m="solo">혼자 연습하기</button>
          ${online}
        </div>
        ${s.error ? `<p class="m-error">${esc(s.error)}</p>` : ''}`;
    } else if (s.kind === 'connecting') {
      body = `<h2>접속 중…</h2><p class="hint">서버에 연결하고 있습니다.</p>`;
    } else {
      const { lobby, me } = s;
      const host = lobby.hostPid === me;
      const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => {
        const p = lobby.players[i];
        if (p) {
          return `<li style="--c:${PLAYER_CSS[i]}"><span class="dot"></span>${esc(p.name)}${p.pid === me ? ' (나)' : ''}
            ${p.host ? '<i class="st cert">방장</i>' : ''}${p.connected ? '' : '<i class="st">연결 끊김</i>'}</li>`;
        }
        return `<li class="emptyslot">${lobby.fillBots ? 'NPC가 채웁니다' : '빈자리'}</li>`;
      }).join('');
      const canStart = lobby.fillBots || lobby.players.length >= 2;
      const controls = host
        ? `<div class="m-actions">
            <button data-m="bots" class="${lobby.fillBots ? 'on' : ''}">빈자리 NPC ${lobby.fillBots ? '켜짐' : '꺼짐'}</button>
            <button class="primary" data-m="start" ${canStart ? '' : 'disabled'}>게임 시작</button>
          </div>`
        : `<p class="hint">방장이 게임을 시작하기를 기다리는 중입니다.</p>`;
      body = `
        <h2>대기실</h2>
        <div class="m-code"><span>방 코드</span><b>${lobby.code}</b></div>
        <div class="m-link"><input id="m-link" readonly value="${esc(this.inviteLink(lobby.code))}" aria-label="초대 링크">
          <button data-m="copy">링크 복사</button></div>
        <ul class="m-players">${slots}</ul>
        ${controls}
        ${s.error ? `<p class="m-error">${esc(s.error)}</p>` : ''}
        <button class="m-leave" data-m="leave">나가기</button>`;
    }
    this.root.innerHTML = `<div class="sheet intro">${body}</div>`;
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem('jg:name') ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem('jg:name', name);
  } catch {
    // 이름 기억만 안 될 뿐
  }
}
