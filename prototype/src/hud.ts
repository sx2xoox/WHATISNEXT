import { CARDS } from './cards';
import { ROUND_TIME, ROUNDS_PER_SET } from './config';
import type { Game } from './game';

export interface MenuState {
  humans: number;
  fillBots: boolean;
  pads: number;
}

export class Hud {
  private cache = new Map<string, string>();
  private timerFill: HTMLElement;

  constructor(
    private root: HTMLElement,
    onAction: (action: string) => void,
  ) {
    root.innerHTML = `
      <div class="top"><div class="round"></div><div class="timer"><div class="fill"></div></div></div>
      <div class="scores"></div>
      <div class="banner"></div>
      <div class="overlay"></div>`;
    this.timerFill = root.querySelector('.fill')!;
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (el) onAction(el.dataset.action!);
    });
  }

  // 내용이 바뀐 경우에만 DOM을 갱신
  private set(sel: string, html: string): void {
    if (this.cache.get(sel) === html) return;
    this.cache.set(sel, html);
    this.root.querySelector<HTMLElement>(sel)!.innerHTML = html;
  }

  render(game: Game, menu: MenuState): void {
    const inRound = game.phase === 'countdown' || game.phase === 'play' || game.phase === 'roundEnd';
    this.root.classList.toggle('in-round', inRound);
    this.root.classList.toggle('in-match', game.phase !== 'title');

    this.set('.round', inRound ? `라운드 <b>${game.round}</b> / ${ROUNDS_PER_SET}` : '');
    const left = game.phase === 'countdown' ? 1 : Math.max(0, 1 - game.roundT / ROUND_TIME);
    this.timerFill.style.width = `${left * 100}%`;

    this.set('.scores', game.phase === 'title' ? '' : this.scores(game));
    this.set('.banner', this.banner(game));
    this.set('.overlay', this.overlay(game, menu));
  }

  private scores(game: Game): string {
    return game.players
      .map((p) => {
        const icons = p.cards.map((c) => `<span title="${CARDS[c].name}">${CARDS[c].icon}</span>`).join('');
        const dead = game.phase === 'play' && !p.alive ? ' dead' : '';
        return `<div class="chip${dead}" style="--c:${p.slot.css}">
          <span class="dot"></span><b>${p.label}</b><span class="pts">${p.score}</span>
          <span class="cards">${icons}</span></div>`;
      })
      .join('');
  }

  private banner(game: Game): string {
    if (game.phase === 'countdown') {
      const hint = game.round === 1 ? '첫 라운드는 유령이 없습니다' : '흐릿한 유령 = 지난 라운드의 모두';
      return `<div class="big">${Math.ceil(game.phaseT)}</div><div class="hint">코인 위치 확인! · ${hint}</div>`;
    }
    if (game.phase === 'play') {
      if (game.roundT < 0.7) return `<div class="big go">GO!</div>`;
      if (game.secondWaveAt >= 0 && game.time - game.secondWaveAt < 1.2) return `<div class="mid">코인 추가!</div>`;
      return '';
    }
    if (game.phase === 'roundEnd') {
      const rows = game.players
        .map(
          (p) =>
            `<span style="color:${p.slot.css}">${p.label} +${p.roundGain}${p.survived ? ' 생존' : ''}</span>`,
        )
        .join('');
      return `<div class="mid">라운드 ${game.round} 종료</div><div class="gains">${rows}</div>`;
    }
    return '';
  }

  private overlay(game: Game, menu: MenuState): string {
    if (game.phase === 'title') return this.title(menu);
    if (game.phase === 'draft') return this.draft(game);
    if (game.phase === 'setEnd') return this.results(game);
    return '';
  }

  private title(menu: MenuState): string {
    const humanBtns = [1, 2, 3, 4]
      .map((n) => `<button data-action="humans-${n}" class="${menu.humans === n ? 'on' : ''}">${n}</button>`)
      .join('');
    const padNote =
      menu.humans >= 3
        ? `<p class="note">3인 이상은 P3, P4가 게임패드를 씁니다. 연결된 패드: ${menu.pads}개</p>`
        : '';
    return `<div class="panel">
      <h1>잔상 아레나</h1>
      <p class="sub">프로토타입 v0.1 · 내 움직임이 다음 라운드의 함정이 된다</p>
      <ul class="rules">
        <li>코인을 주우면 <b>+1</b>, 라운드 끝까지 살아남으면 <b>+1</b></li>
        <li>지난 3라운드 동안 <b>모두가 움직인 궤적</b>이 유령이 되어 똑같이 다시 움직입니다. 닿으면 탈락 (내 유령 포함)</li>
        <li>대시 중에는 무적. 밀치기로 상대를 유령 쪽으로 밀어내세요</li>
        <li>라운드마다 카드 1장을 고릅니다. 꼴찌는 후보가 4장</li>
      </ul>
      <div class="row"><span>사람 수</span><div class="btns">${humanBtns}</div></div>
      <div class="row"><span>빈자리 봇 (B)</span><div class="btns">
        <button data-action="bots" class="${menu.fillBots ? 'on' : ''}">${menu.fillBots ? '켜짐' : '꺼짐'}</button></div></div>
      ${padNote}
      <table class="keys">
        <tr><th></th><th>이동</th><th>대시</th><th>밀치기</th></tr>
        <tr><td>P1</td><td>W A S D</td><td>F / Space</td><td>G</td></tr>
        <tr><td>P2</td><td>방향키</td><td>/</td><td>.</td></tr>
        <tr><td>패드</td><td>스틱</td><td>A</td><td>X</td></tr>
      </table>
      <button class="start" data-action="start">시작 (Enter)</button>
    </div>`;
  }

  private draft(game: Game): string {
    const cols = game.players
      .map((p, i) => {
        const d = game.draft[i];
        if (!d) return '';
        const cards = d.offer
          .map((id, k) => {
            const c = CARDS[id];
            const cls = ['card', k === d.sel ? 'sel' : '', d.done && k !== d.sel ? 'dim' : ''].join(' ');
            const action = p.bot || d.done ? '' : `data-action="pick-${i}-${k}"`;
            return `<div class="${cls}" ${action}><div class="icon">${c.icon}</div><b>${c.name}</b><small>${c.desc}</small></div>`;
          })
          .join('');
        const state = d.done ? '✓ 선택 완료' : p.bot ? '고르는 중…' : '← → 로 고르고 대시 키로 확정';
        return `<div class="pick" style="--c:${p.slot.css}">
          <div class="who"><span class="dot"></span>${p.label} · ${p.score}점</div>
          <div class="cards">${cards}</div><div class="state">${state}</div></div>`;
      })
      .join('');
    return `<div class="panel wide"><h2>카드 선택</h2><div class="picks">${cols}</div></div>`;
  }

  private results(game: Game): string {
    const ranked = [...game.players].sort((a, b) => b.score - a.score);
    const rows = ranked
      .map(
        (p, i) =>
          `<li style="--c:${p.slot.css}"><span class="rank">${i + 1}</span><span class="dot"></span>${p.label}
          <span class="pts">${p.score}점</span><span class="cards">${p.cards.map((c) => CARDS[c].icon).join('')}</span></li>`,
      )
      .join('');
    return `<div class="panel">
      <h2>${ranked[0].label} 승리!</h2>
      <ol class="ranking">${rows}</ol>
      <div class="btns center">
        <button class="start" data-action="restart">한 판 더 (Enter)</button>
        <button data-action="title">처음으로 (Esc)</button>
      </div></div>`;
  }
}
