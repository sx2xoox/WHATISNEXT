import { CONFIG } from '../core/config';
import { describeEvent } from '../core/engine';
import { ITEM_TYPES, SERIES, SERIES_IDS, TYPE_BY_ID } from '../core/items';
import type { Command, Offer, Result } from '../core/types';
import type { ItemView, PlayerView } from '../core/view';
import { QUICK_LINES, type RoomMeta } from '../shared/protocol';
import { PLAYER_CSS } from './scene';

const won = (v: number) => `${Math.round(v).toLocaleString()}원`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const PITCHES = ['', '박스 풀셋이에요', '상태 좋아요', '급처합니다', '하자 있어서 싸게 드려요', '이거 모으시잖아요', '마지막 제안이에요'];

interface Draft {
  to: number;
  give: string[];
  want: string[];
  guarantee: string[];
  giveCash: number;
  wantCash: number;
  line: string;
  counterOf: string | null;
}

export class Ui {
  private cache = new Map<string, string>();
  private tab: 'prices' | 'log' = 'prices';
  private draft: Draft | null = null;
  private v: PlayerView | null = null;
  private toastTimer = 0;
  private meta: RoomMeta = { names: [], offline: [], botLabels: [], hostPid: 0 };
  online = false;
  onRestart: () => void = () => {};
  onSay: (text: string) => void = () => {};

  constructor(
    private root: HTMLElement,
    private act: (cmd: Command) => Promise<Result>,
  ) {
    root.innerHTML = `
      <header class="top"></header>
      <aside class="left panel"></aside>
      <aside class="right panel"></aside>
      <section class="dock panel"></section>
      <div class="modal" hidden></div>
      <div class="toast" hidden></div>`;
    // 화면이 1초마다 다시 그려져도 클릭이 사라지지 않도록 누르는 순간 처리한다.
    // 키보드로 누른 버튼은 click(detail 0)으로 들어온다.
    root.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.onClick(e);
    });
    root.addEventListener('click', (e) => {
      if (e.detail === 0) this.onClick(e);
    });
    root.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.id === 'pitch' && this.draft) this.draft.line = t.value;
    });
  }

  private set(sel: string, html: string): void {
    if (this.cache.get(sel) === html) return;
    this.cache.set(sel, html);
    this.root.querySelector<HTMLElement>(sel)!.innerHTML = html;
  }

  toast(text: string): void {
    const el = this.root.querySelector<HTMLElement>('.toast')!;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (el.hidden = true), 2600);
  }

  private async run(cmd: Command): Promise<Result> {
    const r = await this.act(cmd);
    if (!r.ok) this.toast(r.error);
    if (this.v) this.render(this.v, this.meta, true);
    return r;
  }

  // ---------- 클릭 처리 ----------

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !this.v) return;
    const v = this.v;
    const { act, id = '', n = '0' } = el.dataset;
    const amount = Number(n);
    switch (act) {
      case 'say':
        this.onSay(QUICK_LINES[amount]);
        this.toast(`나: ${QUICK_LINES[amount]}`);
        break;
      case 'restart':
        if (this.online && this.meta.hostPid !== v.me.id) this.toast('방장만 다시 시작할 수 있습니다');
        else this.onRestart();
        break;
      case 'ready':
        this.run({ t: 'ready' });
        break;
      case 'tab':
        this.tab = id as 'prices' | 'log';
        break;
      case 'appraise':
        this.run({ t: 'appraise', itemId: id });
        break;
      case 'sell':
        this.run({ t: 'sell', itemId: id });
        break;
      case 'cert':
        this.run({ t: 'cert', itemId: id });
        break;
      case 'bid':
        this.run({ t: 'bid', itemId: id, amount: Math.max(0, amount) });
        break;
      case 'accept':
        this.run({ t: 'respond', offerId: id, accept: true });
        break;
      case 'reject':
        this.run({ t: 'respond', offerId: id, accept: false });
        break;
      case 'cancel':
        this.run({ t: 'cancel', offerId: id });
        break;
      case 'pick':
        this.openComposer(Number(id));
        break;
      case 'counter': {
        const o = v.offers.find((x) => x.id === id);
        if (o) this.openComposer(o.from, o);
        break;
      }
      case 'd-give':
      case 'd-want':
      case 'd-guar':
        this.toggleDraft(act, id);
        break;
      case 'd-cash':
        if (this.draft) {
          const key = id as 'giveCash' | 'wantCash';
          this.draft[key] = Math.max(0, this.draft[key] + amount);
        }
        break;
      case 'd-send':
        this.sendDraft();
        break;
      case 'd-close':
        this.draft = null;
        break;
    }
    this.render(v, this.meta, true);
  }

  openComposer(to: number, counter?: Offer): void {
    if (!this.v || this.v.phase !== 'trade') return;
    this.draft = counter
      ? {
          to,
          give: [...counter.wantItems],
          want: [...counter.giveItems],
          guarantee: [],
          giveCash: counter.wantCash,
          wantCash: counter.giveCash,
          line: '',
          counterOf: counter.id,
        }
      : { to, give: [], want: [], guarantee: [], giveCash: 0, wantCash: 0, line: '', counterOf: null };
    this.render(this.v, this.meta, true);
  }

  private toggleDraft(act: string, id: string): void {
    const d = this.draft;
    if (!d) return;
    const flip = (arr: string[]) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
    if (act === 'd-give') {
      d.give = flip(d.give);
      d.guarantee = d.guarantee.filter((x) => d.give.includes(x));
    } else if (act === 'd-want') d.want = flip(d.want);
    else if (d.give.includes(id)) d.guarantee = flip(d.guarantee);
  }

  private async sendDraft(): Promise<void> {
    const d = this.draft;
    if (!d) return;
    const r = await this.run({
      t: 'offer',
      to: d.to,
      giveCash: d.giveCash,
      giveItems: d.give,
      wantCash: d.wantCash,
      wantItems: d.want,
      guarantee: d.guarantee,
      line: d.line,
      ...(d.counterOf ? { counterOf: d.counterOf } : {}),
    });
    if (r.ok) {
      this.draft = null;
      this.toast('제안을 보냈습니다');
      if (this.v) this.render(this.v, this.meta, true);
    }
  }

  // ---------- 그리기 ----------

  render(v: PlayerView, meta: RoomMeta, force = false): void {
    this.v = v;
    this.meta = meta;
    if (force) this.cache.clear();
    this.root.dataset.phase = v.phase;
    if (v.phase !== 'trade') this.draft = null;
    this.set('.top', this.top(v));
    this.set('.left', this.left(v));
    this.set('.right', this.right(v));
    this.set('.dock', this.dock(v));
    const modal = this.root.querySelector<HTMLElement>('.modal')!;
    const modalHtml = this.draft ? this.composer(v, this.draft) : '';
    modal.hidden = !modalHtml;
    this.set('.modal', modalHtml);
  }

  private name(v: PlayerView, pid: number): string {
    return pid === v.me.id ? '나' : v.players[pid].name;
  }

  private badge(it: ItemView): string {
    if (!it.known) return '<i class="st unk">상태 ?</i>';
    const k = it.known;
    const parts: string[] = [];
    if (k.fake) parts.push('<i class="st bad">가품</i>');
    parts.push(
      k.condition === 'normal'
        ? '<i class="st good">정상</i>'
        : k.condition === 'defect'
          ? '<i class="st warn">하자</i>'
          : '<i class="st bad">고장</i>',
    );
    if (it.cert) parts.push('<i class="st cert">감정서</i>');
    return parts.join('');
  }

  private itemName(v: PlayerView, id: string): string {
    const t = TYPE_BY_ID[v.items[id].type];
    return `<span class="dot" style="--s:#${SERIES[t.series].color.toString(16).padStart(6, '0')}"></span>${t.name}`;
  }

  private goalText(v: PlayerView): string {
    const g = v.me.goal;
    if (g.kind === 'collector') {
      const have = new Set(
        v.players[v.me.id].items
          .map((id) => v.items[id])
          .filter((it) => TYPE_BY_ID[it.type].series === g.series && !it.known?.fake)
          .map((it) => it.type),
      ).size;
      return `${SERIES[g.series!].name} ${CONFIG.collectorCount}종 모으기 (${have}/${CONFIG.collectorCount}) · +${won(CONFIG.goalBonus.collector)}`;
    }
    if (g.kind === 'networker')
      return `서로 다른 ${CONFIG.networkerPartners}명과 거래 (${v.me.partners.length}/${CONFIG.networkerPartners}) · +${won(CONFIG.goalBonus.networker)}`;
    return `거래 ${CONFIG.dealerTrades}회 성사 (${v.me.trades}/${CONFIG.dealerTrades}) · +${won(CONFIG.goalBonus.dealer)}`;
  }

  private top(v: PlayerView): string {
    if (v.phase === 'lobby') return '';
    const sec = Math.ceil(v.timeLeft);
    const time = v.phase === 'end' ? '' : `<span class="clock ${sec <= 5 ? 'low' : ''}">${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</span>`;
    const ev = v.event ? `<span class="chip">이번 라운드 · ${describeEvent(v.event)}</span>` : '';
    const ready =
      v.phase === 'end'
        ? ''
        : `<button class="primary" data-act="ready" ${v.me.ready ? 'disabled' : ''}>${v.me.ready ? '다른 사람 기다리는 중' : '준비 완료'}</button>`;
    return `<div class="round">라운드 ${v.round} / ${CONFIG.rounds}</div>${time}${ev}${ready}`;
  }

  private left(v: PlayerView): string {
    if (v.phase === 'lobby') return '';
    const tabs = `<div class="tabs">
      <button data-act="tab" data-id="prices" class="${this.tab === 'prices' ? 'on' : ''}">시세판</button>
      <button data-act="tab" data-id="log" class="${this.tab === 'log' ? 'on' : ''}">거래 기록</button></div>`;
    if (this.tab === 'log') {
      const rows = [...v.log]
        .reverse()
        .map((l) => `<li><span class="r">R${l.round}</span>${esc(l.text)}</li>`)
        .join('');
      return `${tabs}<ul class="log">${rows || '<li class="empty">아직 거래가 없습니다</li>'}</ul>`;
    }
    const mine = new Set(v.players[v.me.id].items.map((id) => v.items[id].type));
    const groups = SERIES_IDS.map((sid) => {
      const rows = ITEM_TYPES.filter((t) => t.series === sid)
        .map((t) => {
          const p = v.prices[t.id];
          const ch = (p / v.prevPrices[t.id] - 1) * 100;
          const cls = ch > 0.5 ? 'up' : ch < -0.5 ? 'down' : '';
          const arrow = ch > 0.5 ? '▲' : ch < -0.5 ? '▼' : '';
          return `<tr class="${mine.has(t.id) ? 'mine' : ''}"><td>${t.name}</td><td class="num">${p.toLocaleString()}</td><td class="num ${cls}">${arrow}${Math.abs(ch).toFixed(0)}%</td></tr>`;
        })
        .join('');
      const color = `#${SERIES[sid].color.toString(16).padStart(6, '0')}`;
      return `<tbody><tr class="series"><th colspan="3"><span class="dot" style="--s:${color}"></span>${SERIES[sid].name}</th></tr>${rows}</tbody>`;
    }).join('');
    return `${tabs}<table class="prices">${groups}</table>
      <p class="hint">세트 보너스: 같은 시리즈 다른 진품 2종 +20%, 3종 +60%, 4종 +100%</p>`;
  }

  private right(v: PlayerView): string {
    if (v.phase === 'lobby') return '';
    const me = v.me;
    const canAppraise = ['market', 'auction', 'trade'].includes(v.phase);
    const canSell = v.phase === 'market' || v.phase === 'trade';
    const items = v.players[me.id].items
      .map((id) => {
        const it = v.items[id];
        const acts: string[] = [];
        if (!it.known && canAppraise) acts.push(`<button data-act="appraise" data-id="${id}">감정 ${won(v.appraisalCost)}</button>`);
        if (it.known && !it.cert) acts.push(`<button data-act="cert" data-id="${id}" title="모두에게 실제 상태를 공개합니다">감정서 공개</button>`);
        if (canSell && it.instantPrice !== null)
          acts.push(`<button data-act="sell" data-id="${id}">매입처 ${won(it.instantPrice)}</button>`);
        return `<li><div class="iname">${this.itemName(v, id)}<span class="num">${v.prices[it.type].toLocaleString()}</span></div>
          <div class="badges">${this.badge(it)}</div><div class="acts">${acts.join('')}</div></li>`;
      })
      .join('');
    const quick = this.online
      ? `<div class="quick">${QUICK_LINES.map((q, i) => `<button class="mini" data-act="say" data-n="${i}">${q}</button>`).join('')}</div>`
      : '';
    return `<h2>내 자리</h2>${quick}
      <dl class="stats">
        <div><dt>현금</dt><dd class="num">${won(me.cash)}</dd></div>
        <div><dt>입찰 잠금</dt><dd class="num">${won(me.locked)}</dd></div>
        <div><dt>보증권</dt><dd>${me.tokens} / ${CONFIG.guaranteeTokens}장</dd></div>
        <div><dt>거래</dt><dd>${me.trades}회</dd></div>
      </dl>
      <p class="goal"><b>비밀 목표</b>${this.goalText(v)}</p>
      <h3>보유 물건 ${v.players[me.id].items.length}개</h3>
      <ul class="inv">${items || '<li class="empty">가진 물건이 없습니다</li>'}</ul>`;
  }

  private dock(v: PlayerView): string {
    switch (v.phase) {
      case 'market':
        return this.lots(v, false);
      case 'auction':
        return this.lots(v, true);
      case 'trade':
        return this.trades(v);
      case 'settle':
        return this.settle(v);
      case 'end':
        return this.final(v);
      default:
        return '';
    }
  }

  private lots(v: PlayerView, bidding: boolean): string {
    const cards = v.lots
      .map((l) => {
        const it = v.items[l.itemId];
        const price = v.prices[it.type];
        const my = v.myBids[l.itemId] ?? 0;
        const step = CONFIG.bidStep;
        const q = (r: number) => Math.max(l.minBid, Math.round((price * r) / step) * step);
        const bidUi = bidding
          ? `<div class="bid"><span class="label">내 입찰</span><b class="num">${my ? won(my) : '없음'}</b></div>
             <div class="row">
               <button data-act="bid" data-id="${l.itemId}" data-n="${my ? my - step * 2 : 0}">−1만</button>
               <button data-act="bid" data-id="${l.itemId}" data-n="${my ? my + step * 2 : l.minBid}">+1만</button>
               <button data-act="bid" data-id="${l.itemId}" data-n="${q(0.8)}">시세 80%</button>
               <button data-act="bid" data-id="${l.itemId}" data-n="${q(1)}">100%</button>
               ${my ? `<button data-act="bid" data-id="${l.itemId}" data-n="0">취소</button>` : ''}
             </div>`
          : '';
        const appraise = !it.known ? `<button data-act="appraise" data-id="${l.itemId}">감정 ${won(v.appraisalCost)}</button>` : '';
        return `<article class="lot">
          <div class="iname">${this.itemName(v, l.itemId)}</div>
          <dl><div><dt>시세</dt><dd class="num">${won(price)}</dd></div><div><dt>최소 입찰</dt><dd class="num">${won(l.minBid)}</dd></div></dl>
          <div class="badges">${this.badge(it)}${appraise}</div>${bidUi}</article>`;
      })
      .join('');
    const head = bidding
      ? `<h2>비공개 경매</h2><p class="sub">입찰 합계 ${won(v.me.locked)} / 현금 ${won(v.me.cash)} · 다른 사람은 내 입찰액을 볼 수 없습니다. 최고가가 낙찰, 동점이면 순자산이 낮은 사람</p>`
      : `<h2>새 매물</h2><p class="sub">지금은 살펴보고 감정만 할 수 있습니다. 입찰은 다음 단계에서 비공개로 합니다</p>`;
    return `${head}<div class="lots">${cards}</div>`;
  }

  private offerCard(v: PlayerView, o: Offer): string {
    const incoming = o.to === v.me.id;
    const side = (cash: number, items: string[], guaranteed: string[]) => {
      const list = items.map((id) => {
        const it = v.items[id];
        const g = guaranteed.includes(id) ? '<i class="st cert">보증</i>' : '';
        const ap =
          incoming && o.status === 'pending' && !it.known
            ? `<button class="mini" data-act="appraise" data-id="${id}">감정</button>`
            : '';
        return `<li>${this.itemName(v, id)} <span class="num muted">${v.prices[it.type].toLocaleString()}</span> ${this.badge(it)}${g}${ap}</li>`;
      });
      if (cash) list.push(`<li class="cash num">현금 ${won(cash)}</li>`);
      return `<ul>${list.join('') || '<li class="muted">없음</li>'}</ul>`;
    };
    const left = Math.max(0, Math.ceil(o.expiresAt - v.now));
    const status: Record<string, string> = {
      pending: `${left}초 남음`,
      accepted: '거래 성사',
      rejected: '거절됨',
      expired: '만료됨',
      cancelled: '취소됨',
      failed: `실패: ${o.failReason ?? ''}`,
    };
    const buttons =
      o.status !== 'pending'
        ? ''
        : incoming
          ? `<button class="primary" data-act="accept" data-id="${o.id}">수락</button>
             <button data-act="counter" data-id="${o.id}">역제안</button>
             <button data-act="reject" data-id="${o.id}">거절</button>`
          : `<button data-act="cancel" data-id="${o.id}">취소</button>`;
    const who = incoming ? `${this.name(v, o.from)} → 나` : `나 → ${this.name(v, o.to)}`;
    return `<article class="offer ${o.status}" style="--c:${PLAYER_CSS[incoming ? o.from : o.to]}">
      <header><b>${who}</b>${o.counterOf ? '<i class="st">역제안</i>' : ''}<span class="status">${status[o.status]}</span></header>
      ${o.line ? `<q>${esc(o.line)}</q>` : ''}
      <div class="terms"><div><h4>${incoming ? '받는 것' : '주는 것'}</h4>${side(o.giveCash, o.giveItems, o.guarantee)}</div>
      <div><h4>${incoming ? '주는 것' : '받는 것'}</h4>${side(o.wantCash, o.wantItems, [])}</div></div>
      <footer>${buttons}</footer></article>`;
  }

  private trades(v: PlayerView): string {
    const incoming = v.offers.filter((o) => o.to === v.me.id && o.status === 'pending');
    const recent = v.offers
      .filter((o) => !(o.to === v.me.id && o.status === 'pending'))
      .slice(-4)
      .reverse();
    const people = v.players
      .filter((p) => p.id !== v.me.id)
      .map(
        (p) =>
          `<button class="person" style="--c:${PLAYER_CSS[p.id]}" data-act="pick" data-id="${p.id}">${esc(p.name)}에게 제안${p.violations ? ` <i class="st bad">보증 위반 ${p.violations}</i>` : ''}${this.meta.offline.includes(p.id) ? ' <i class="st">연결 끊김</i>' : ''}</button>`,
      )
      .join('');
    return `<h2>직거래</h2>
      <p class="sub">상대 캐릭터를 클릭하거나 아래 버튼으로 거래를 제안하세요. 현금을 받는 쪽은 수수료 ${CONFIG.tradeFeeRate * 100}%를 냅니다</p>
      <div class="people">${people}</div>
      <div class="offers">
        ${incoming.map((o) => this.offerCard(v, o)).join('') || '<p class="empty">받은 제안이 없습니다</p>'}
        ${recent.map((o) => this.offerCard(v, o)).join('')}
      </div>`;
  }

  private settle(v: PlayerView): string {
    const results = v.auctionResults
      .map((r) => {
        const it = v.items[r.itemId];
        const who = r.winner === null ? '유찰' : `${this.name(v, r.winner)} · ${won(r.price)}`;
        return `<li><span>${it ? this.itemName(v, r.itemId) : ''}</span><span>${who}</span></li>`;
      })
      .join('');
    const movers = ITEM_TYPES.map((t) => ({ t, ch: v.prices[t.id] / v.prevPrices[t.id] - 1 }))
      .sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch))
      .slice(0, 4)
      .map((m) => `<li>${m.t.name}<span class="${m.ch > 0 ? 'up' : 'down'}">${m.ch > 0 ? '▲' : '▼'}${Math.abs(m.ch * 100).toFixed(0)}%</span></li>`)
      .join('');
    const reports = v.reports.map((r) => `<li>${esc(r)}</li>`).join('');
    const next = v.nextEvent ? `<p class="next">다음 라운드 예고 · <b>${describeEvent(v.nextEvent)}</b></p>` : '';
    return `<h2>감정 · 정산</h2>${next}
      <div class="cols">
        <div><h4>이번 경매</h4><ul class="plain">${results || '<li class="muted">기록 없음</li>'}</ul></div>
        <div><h4>나에게 온 소식</h4><ul class="plain">${reports || '<li class="muted">특별한 일 없음</li>'}</ul></div>
        <div><h4>시세 변동</h4><ul class="plain">${movers}</ul></div>
      </div>`;
  }

  private final(v: PlayerView): string {
    const rows = (v.final ?? [])
      .map((f, i) => {
        const label = this.meta.botLabels[f.player] ? `<i class="st">${this.meta.botLabels[f.player]}</i>` : '';
        return `<tr class="${f.player === v.me.id ? 'me' : ''}"><td>${i + 1}</td>
          <td><span class="dot" style="--s:${PLAYER_CSS[f.player]}"></span>${this.name(v, f.player)} ${label}</td>
          <td class="num">${f.cash.toLocaleString()}</td><td class="num">${f.items.toLocaleString()}</td>
          <td class="num">${f.sets.toLocaleString()}</td><td class="num">${f.goal.toLocaleString()}</td>
          <td class="num total">${f.total.toLocaleString()}</td></tr>`;
      })
      .join('');
    return `<h2>최종 순자산</h2>
      <p class="sub">물건 평가 = 마지막 시세 70% + 직전 시세 30%, 실제 상태 반영. 상대의 성격도 공개합니다</p>
      <div class="scroll"><table class="final"><thead><tr><th></th><th>플레이어</th><th>현금</th><th>물건</th><th>세트</th><th>목표</th><th>합계</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <button class="primary wide" data-act="restart">한 판 더</button>`;
  }


  private composer(v: PlayerView, d: Draft): string {
    const target = v.players[d.to];
    const priceOf = (ids: string[]) => ids.reduce((a, id) => a + v.prices[v.items[id].type], 0);
    const mine = v.players[v.me.id].items
      .map((id) => {
        const on = d.give.includes(id);
        const g = d.guarantee.includes(id);
        const guar = on
          ? `<button class="mini ${g ? 'on' : ''}" data-act="d-guar" data-id="${id}" ${!g && d.guarantee.length >= v.me.tokens ? 'disabled' : ''}>${g ? '보증함' : '보증'}</button>`
          : '';
        return `<li class="${on ? 'on' : ''}"><button class="pick" data-act="d-give" data-id="${id}">${this.itemName(v, id)}
          <span class="num muted">${v.prices[v.items[id].type].toLocaleString()}</span></button>${this.badge(v.items[id])}${guar}</li>`;
      })
      .join('');
    const theirs = target.items
      .map((id) => {
        const on = d.want.includes(id);
        return `<li class="${on ? 'on' : ''}"><button class="pick" data-act="d-want" data-id="${id}">${this.itemName(v, id)}
          <span class="num muted">${v.prices[v.items[id].type].toLocaleString()}</span></button>${this.badge(v.items[id])}</li>`;
      })
      .join('');
    const cash = (key: 'giveCash' | 'wantCash') => `<div class="cashrow"><span>현금</span>
      <button class="mini" data-act="d-cash" data-id="${key}" data-n="-50000">−5만</button>
      <button class="mini" data-act="d-cash" data-id="${key}" data-n="-10000">−1만</button>
      <b class="num">${won(d[key])}</b>
      <button class="mini" data-act="d-cash" data-id="${key}" data-n="10000">+1만</button>
      <button class="mini" data-act="d-cash" data-id="${key}" data-n="50000">+5만</button></div>`;
    const giveV = priceOf(d.give) + d.giveCash;
    const wantV = priceOf(d.want) + d.wantCash;
    const options = PITCHES.map((p) => `<option value="${esc(p)}" ${p === d.line ? 'selected' : ''}>${p ? `“${p}”` : '한마디 없이 보내기'}</option>`).join('');
    return `<div class="sheet composer" style="--c:${PLAYER_CSS[d.to]}">
      <header><h2>${esc(target.name)}에게 ${d.counterOf ? '역제안' : '거래 제안'}</h2><button class="x" data-act="d-close" aria-label="닫기">✕</button></header>
      <div class="cols2">
        <section><h4>내가 줄 것</h4><ul class="picklist">${mine || '<li class="muted">물건 없음</li>'}</ul>${cash('giveCash')}</section>
        <section><h4>받고 싶은 것</h4><ul class="picklist">${theirs || '<li class="muted">물건 없음</li>'}</ul>${cash('wantCash')}</section>
      </div>
      <p class="sum">시세 기준: 주는 쪽 <b class="num">${won(giveV)}</b> · 받는 쪽 <b class="num">${won(wantV)}</b>
        ${d.guarantee.length ? ` · 보증권 ${d.guarantee.length}장 사용` : ''}</p>
      <div class="sendrow"><label for="pitch">한마디</label><select id="pitch">${options}</select>
        <button class="primary" data-act="d-send">제안 보내기</button></div>
      <p class="hint">보증한 물건이 정산 때 하자·가품으로 드러나면 손실분과 벌금 ${CONFIG.falseGuaranteeFine * 100}%를 물어주고 위반 기록이 공개됩니다.</p>
    </div>`;
  }
}
