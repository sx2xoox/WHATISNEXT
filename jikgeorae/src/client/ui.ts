// 게임 화면. 원칙: 단계마다 "지금 할 일" 한 줄과 큰 버튼 하나. 자세한 정보는 눌러야 펼쳐진다.
import { CONFIG } from '../core/config';
import { describeEvent } from '../core/engine';
import { ITEM_TYPES, SERIES, SERIES_IDS, TYPE_BY_ID } from '../core/items';
import type { Command, Offer, Result } from '../core/types';
import type { ItemView, PlayerView } from '../core/view';
import { QUICK_LINES, type RoomMeta } from '../shared/protocol';
import { ITEM_ICONS } from './items3d';
import { PLAYER_CSS } from './scene';

const won = (v: number) => `${Math.round(v).toLocaleString()}원`;
const man = (v: number) => (v % 10_000 === 0 ? `${v / 10_000}만원` : won(v));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const roundTo = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

const PITCHES = ['상태 좋아요', '박스 풀셋이에요', '급처합니다', '하자 있어서 싸게 드려요', '이거 모으시잖아요'];
const STEPS = [
  ['market', '구경'],
  ['auction', '경매'],
  ['trade', '거래'],
  ['settle', '결과'],
] as const;

const MISSION: Record<string, { title: string; text: string; done: string }> = {
  market: {
    title: '새 물건 구경',
    text: '가운데에 물건 4개가 나왔어요. 진짜 상태가 궁금하면 감정해 보세요.',
    done: '구경 끝',
  },
  auction: {
    title: '몰래 입찰',
    text: '갖고 싶은 물건에 낼 돈을 정하세요. 제일 많이 쓴 사람이 가져가요.',
    done: '입찰 끝',
  },
  trade: {
    title: '사고팔기',
    text: '사람을 눌러 사거나 팔자고 제안하세요. 같은 시리즈를 모으면 보너스!',
    done: '거래 끝',
  },
  settle: { title: '이번 라운드 결과', text: '내 물건의 진짜 상태가 공개되고 시세가 바뀌었어요.', done: '다음 라운드' },
  end: { title: '게임 끝', text: '현금 + 물건 + 세트 보너스 + 목표를 합친 순위예요.', done: '' },
};

type Mode = 'buy' | 'sell' | 'swap';

interface Draft {
  to: number;
  mode: Mode;
  item: string | null; // 사기·팔기에서 고른 물건
  price: number;
  guarantee: boolean;
  line: string;
  // 교환(고급)
  give: string[];
  want: string[];
  giveCash: number;
  wantCash: number;
  counterOf: string | null;
}

export class Ui {
  private cache = new Map<string, string>();
  private drawer: 'closed' | 'prices' | 'log' = 'closed';
  private openItem: string | null = null;
  private chatOpen = false;
  private help = false;
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
      <aside class="drawer panel"></aside>
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
    this.help = !seenHelp();
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
    this.refresh();
    return r;
  }

  private refresh(): void {
    if (this.v) this.render(this.v, this.meta, true);
  }

  // ---------- 클릭 ----------

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !this.v) return;
    const v = this.v;
    const { act, id = '', n = '0' } = el.dataset;
    const num = Number(n);
    const d = this.draft;
    switch (act) {
      case 'ready':
        this.run({ t: 'ready' });
        break;
      case 'help':
        this.help = !this.help;
        if (!this.help) markHelpSeen();
        break;
      case 'drawer':
        this.drawer = this.drawer === id ? 'closed' : (id as 'prices' | 'log');
        break;
      case 'item':
        this.openItem = this.openItem === id ? null : id;
        break;
      case 'chat':
        this.chatOpen = !this.chatOpen;
        break;
      case 'say':
        this.onSay(QUICK_LINES[num]);
        this.toast(`나: ${QUICK_LINES[num]}`);
        this.chatOpen = false;
        break;
      case 'appraise':
        this.run({ t: 'appraise', itemId: id });
        break;
      case 'sell':
        this.run({ t: 'sell', itemId: id });
        this.openItem = null;
        break;
      case 'cert':
        this.run({ t: 'cert', itemId: id });
        break;
      case 'bid':
        this.run({ t: 'bid', itemId: id, amount: Math.max(0, num) });
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
      case 'restart':
        if (this.online && this.meta.hostPid !== v.me.id) this.toast('방장만 다시 시작할 수 있어요');
        else this.onRestart();
        break;
      case 'pick':
        this.openComposer(num);
        break;
      case 'counter': {
        const o = v.offers.find((x) => x.id === id);
        if (o) this.openComposer(o.from, o);
        break;
      }
      case 'd-mode':
        if (d) Object.assign(d, { mode: id as Mode, item: null, guarantee: false });
        break;
      case 'd-item':
        if (d) {
          d.item = id;
          d.price = roundTo(v.prices[v.items[id].type], 5_000);
          d.guarantee = false;
        }
        break;
      case 'd-price':
        if (d) d.price = Math.max(0, d.price + num);
        break;
      case 'd-guar':
        if (d) d.guarantee = !d.guarantee;
        break;
      case 'd-line':
        if (d) d.line = d.line === PITCHES[num] ? '' : PITCHES[num];
        break;
      case 'd-give':
      case 'd-want':
        if (d) {
          const key = act === 'd-give' ? 'give' : 'want';
          d[key] = d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id];
        }
        break;
      case 'd-cash':
        if (d) {
          const key = id as 'giveCash' | 'wantCash';
          d[key] = Math.max(0, d[key] + num);
        }
        break;
      case 'd-send':
        this.sendDraft();
        break;
      case 'd-close':
        this.draft = null;
        break;
    }
    this.refresh();
  }

  openComposer(to: number, counter?: Offer): void {
    if (!this.v || this.v.phase !== 'trade' || to === this.v.me.id) return;
    const base: Draft = {
      to,
      mode: 'buy',
      item: null,
      price: 0,
      guarantee: false,
      line: '',
      give: [],
      want: [],
      giveCash: 0,
      wantCash: 0,
      counterOf: null,
    };
    if (counter) {
      base.counterOf = counter.id;
      const simpleSell = counter.giveItems.length === 1 && counter.wantItems.length === 0 && counter.giveCash === 0;
      const simpleBuy = counter.wantItems.length === 1 && counter.giveItems.length === 0 && counter.wantCash === 0;
      if (simpleSell) Object.assign(base, { mode: 'buy', item: counter.giveItems[0], price: counter.wantCash });
      else if (simpleBuy) Object.assign(base, { mode: 'sell', item: counter.wantItems[0], price: counter.giveCash });
      else
        Object.assign(base, {
          mode: 'swap',
          give: [...counter.wantItems],
          want: [...counter.giveItems],
          giveCash: counter.wantCash,
          wantCash: counter.giveCash,
        });
    }
    this.draft = base;
    this.refresh();
  }

  private async sendDraft(): Promise<void> {
    const d = this.draft;
    if (!d) return;
    let cmd: Extract<Command, { t: 'offer' }>;
    const common = { t: 'offer' as const, to: d.to, line: d.line, ...(d.counterOf ? { counterOf: d.counterOf } : {}) };
    if (d.mode === 'swap') {
      cmd = { ...common, giveCash: d.giveCash, giveItems: d.give, wantCash: d.wantCash, wantItems: d.want, guarantee: [] };
    } else {
      if (!d.item) return this.toast('물건을 먼저 고르세요');
      cmd =
        d.mode === 'buy'
          ? { ...common, giveCash: d.price, giveItems: [], wantCash: 0, wantItems: [d.item], guarantee: [] }
          : { ...common, giveCash: 0, giveItems: [d.item], wantCash: d.price, wantItems: [], guarantee: d.guarantee ? [d.item] : [] };
    }
    const r = await this.run(cmd);
    if (r.ok) {
      this.draft = null;
      this.toast('제안을 보냈어요');
      this.refresh();
    }
  }

  // ---------- 그리기 ----------

  render(v: PlayerView, meta: RoomMeta, force = false): void {
    this.v = v;
    this.meta = meta;
    if (force) this.cache.clear();
    this.root.dataset.phase = v.phase;
    if (v.phase !== 'trade') this.draft = null;
    if (this.openItem && !v.players[v.me.id].items.includes(this.openItem)) this.openItem = null;
    this.set('.top', this.top(v));
    this.set('.drawer', this.drawerHtml(v));
    this.set('.right', this.right(v));
    this.set('.dock', this.dock(v));
    const modal = this.root.querySelector<HTMLElement>('.modal')!;
    const html = this.draft ? this.composer(v, this.draft) : this.help ? this.helpHtml() : '';
    modal.hidden = !html;
    this.set('.modal', html);
  }

  private name(v: PlayerView, pid: number): string {
    return pid === v.me.id ? '나' : esc(v.players[pid].name);
  }

  private who(v: PlayerView, pid: number): string {
    return `<b class="who" style="--c:${PLAYER_CSS[pid]}">${this.name(v, pid)}</b>`;
  }

  // 상태 표시: 모르면 "?", 알면 정상/하자/고장/가품
  private tag(it: ItemView): string {
    if (!it.known) return '<i class="tag unk" title="진짜 상태를 몰라요">상태 ?</i>';
    const k = it.known;
    if (k.fake) return '<i class="tag bad">가품</i>';
    if (k.condition === 'normal') return '<i class="tag good">정상</i>';
    if (k.condition === 'defect') return '<i class="tag warn">하자</i>';
    return '<i class="tag bad">고장</i>';
  }

  private itemName(v: PlayerView, id: string): string {
    const t = TYPE_BY_ID[v.items[id].type];
    return `${icon(t.id)}<span class="dot" style="--s:${hex(SERIES[t.series].color)}" title="${SERIES[t.series].name}"></span>${t.name}`;
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
      return `${SERIES[g.series!].name} 서로 다른 ${CONFIG.collectorCount}종 모으기 <b>${have}/${CONFIG.collectorCount}</b>`;
    }
    if (g.kind === 'networker') return `서로 다른 ${CONFIG.networkerPartners}명과 거래 <b>${v.me.partners.length}/${CONFIG.networkerPartners}</b>`;
    return `거래 ${CONFIG.dealerTrades}번 성사 <b>${v.me.trades}/${CONFIG.dealerTrades}</b>`;
  }

  private top(v: PlayerView): string {
    const m = MISSION[v.phase];
    if (!m) return '';
    const sec = Math.ceil(v.timeLeft);
    const idx = STEPS.findIndex(([p]) => p === v.phase);
    const steps = STEPS.map(
      ([, label], i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${label}</li>`,
    ).join('');
    const readyCount = v.players.filter((p) => p.ready).length;
    const button =
      v.phase === 'end'
        ? ''
        : v.me.ready
          ? `<button class="primary big" disabled>기다리는 중 ${readyCount}/${v.players.length}</button>`
          : `<button class="primary big" data-act="ready">${m.done} ▶</button>`;
    const ev = v.event ? `<p class="event">📣 ${describeEvent(v.event)}</p>` : '';
    return `
      <div class="bar">
        <span class="round">${v.phase === 'end' ? '최종' : `${v.round}/${CONFIG.rounds} 라운드`}</span>
        ${v.phase === 'end' ? '' : `<ol class="steps4">${steps}</ol><span class="clock ${sec <= 5 ? 'low' : ''}">${sec}초</span>`}
        <button class="ghost" data-act="help" aria-label="게임 방법">?</button>
      </div>
      <div class="mission"><div><h2>${m.title}</h2><p>${m.text}</p>${ev}</div>${button}</div>`;
  }

  private drawerHtml(v: PlayerView): string {
    const tabs = `<div class="tabs">
      <button data-act="drawer" data-id="prices" class="${this.drawer === 'prices' ? 'on' : ''}">시세표</button>
      <button data-act="drawer" data-id="log" class="${this.drawer === 'log' ? 'on' : ''}">거래 기록</button></div>`;
    if (this.drawer === 'closed') return tabs;
    if (this.drawer === 'log') {
      const rows = [...v.log]
        .reverse()
        .map((l) => `<li><span class="r">${l.round}R</span>${esc(l.text)}</li>`)
        .join('');
      return `${tabs}<ul class="log">${rows || '<li class="muted">아직 없어요</li>'}</ul>`;
    }
    const mine = new Set(v.players[v.me.id].items.map((id) => v.items[id].type));
    const groups = SERIES_IDS.map((sid) => {
      const rows = ITEM_TYPES.filter((t) => t.series === sid)
        .map((t) => {
          const p = v.prices[t.id];
          const ch = (p / v.prevPrices[t.id] - 1) * 100;
          const arrow = ch > 0.5 ? `<span class="up">▲${ch.toFixed(0)}%</span>` : ch < -0.5 ? `<span class="down">▼${(-ch).toFixed(0)}%</span>` : '';
          return `<tr class="${mine.has(t.id) ? 'mine' : ''}"><td>${t.name}</td><td class="num">${p.toLocaleString()}</td><td class="num">${arrow}</td></tr>`;
        })
        .join('');
      return `<tbody><tr class="series"><th colspan="3"><span class="dot" style="--s:${hex(SERIES[sid].color)}"></span>${SERIES[sid].name}</th></tr>${rows}</tbody>`;
    }).join('');
    return `${tabs}<table class="prices">${groups}</table>`;
  }

  private right(v: PlayerView): string {
    const me = v.me;
    const canAppraise = ['market', 'auction', 'trade'].includes(v.phase);
    const canSell = v.phase === 'market' || v.phase === 'trade';
    const items = v.players[me.id].items
      .map((id) => {
        const it = v.items[id];
        const open = this.openItem === id;
        const acts: string[] = [];
        if (open) {
          if (!it.known && canAppraise) acts.push(`<button data-act="appraise" data-id="${id}">감정하기 (${man(v.appraisalCost)})</button>`);
          if (it.known && !it.cert && it.known.mult === 1)
            acts.push(`<button data-act="cert" data-id="${id}">감정서 보여주기</button>`);
          if (canSell && it.instantPrice !== null) acts.push(`<button data-act="sell" data-id="${id}">가게에 바로 팔기 ${won(it.instantPrice)}</button>`);
          if (!acts.length) acts.push('<span class="muted">거래 단계에서 다른 사람에게 팔 수 있어요</span>');
        }
        return `<li class="${open ? 'open' : ''}">
          <button class="row" data-act="item" data-id="${id}">${this.itemName(v, id)}${this.tag(it)}<span class="num muted">${man(v.prices[it.type])}</span></button>
          ${open ? `<div class="acts">${acts.join('')}</div>` : ''}</li>`;
      })
      .join('');
    const chat = this.online
      ? `<button class="ghost wide" data-act="chat">💬 말하기</button>${
          this.chatOpen
            ? `<div class="quick">${QUICK_LINES.map((q, i) => `<button class="mini" data-act="say" data-n="${i}">${q}</button>`).join('')}</div>`
            : ''
        }`
      : '';
    return `
      <div class="wallet"><span>내 돈</span><b class="num">${won(me.cash)}</b></div>
      <p class="goal">🎯 ${this.goalText(v)}</p>
      <h3>내 물건 <span class="muted">눌러서 감정·판매</span></h3>
      <ul class="inv">${items || '<li class="muted">아직 없어요</li>'}</ul>
      <p class="tokens">보증권 ${me.tokens}장 <span class="muted">· 팔 때 "하자 없음"을 약속하는 표</span></p>
      ${chat}`;
  }

  private dock(v: PlayerView): string {
    switch (v.phase) {
      case 'market':
      case 'auction':
        return this.lots(v);
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

  private lots(v: PlayerView): string {
    const bidding = v.phase === 'auction';
    const step = 10_000;
    const cards = v.lots
      .map((l) => {
        const it = v.items[l.itemId];
        const price = v.prices[it.type];
        const my = v.myBids[l.itemId] ?? 0;
        const appraise = !it.known ? `<button class="mini" data-act="appraise" data-id="${l.itemId}">감정 ${man(v.appraisalCost)}</button>` : '';
        const bid = bidding
          ? `<div class="stepper">
              <button data-act="bid" data-id="${l.itemId}" data-n="${my - step >= l.minBid ? my - step : 0}" ${my ? '' : 'disabled'} aria-label="1만원 내리기">−</button>
              <b class="num">${my ? man(my) : '입찰 안 함'}</b>
              <button data-act="bid" data-id="${l.itemId}" data-n="${my ? my + step : roundTo(l.minBid, 5_000)}" aria-label="1만원 올리기">+</button>
            </div>
            <button class="mini ghost" data-act="bid" data-id="${l.itemId}" data-n="${roundTo(price, 5_000)}">시세만큼 쓰기</button>`
          : '';
        return `<article class="lot ${my ? 'bidding' : ''}">
          ${icon(it.type, 'ico-big')}
          <div class="iname">${this.itemName(v, l.itemId).replace(/<img[^>]*>/, '')}</div>
          <p class="price">시세 <b class="num">${man(price)}</b></p>
          <div class="line">${this.tag(it)}${appraise}</div>
          ${bid}</article>`;
      })
      .join('');
    const foot = bidding
      ? `<p class="foot">쓸 돈 합계 <b class="num">${won(v.me.locked)}</b> / 내 돈 ${won(v.me.cash)} · 다른 사람은 내 입찰을 못 봐요</p>`
      : `<p class="foot">입찰은 다음 단계에서 해요</p>`;
    return `<div class="lots">${cards}</div>${foot}`;
  }

  // 제안 내용을 한 문장으로
  private sentence(v: PlayerView, o: Offer, incoming: boolean): string {
    const list = (ids: string[]) => ids.map((id) => `${icon(v.items[id].type)}<b>${TYPE_BY_ID[v.items[id].type].name}</b>`).join(', ');
    const other = incoming ? o.from : o.to;
    const subj = incoming ? this.who(v, other) : `나 → ${this.who(v, other)}`;
    const sellsToMe = o.giveItems.length > 0 && o.wantItems.length === 0 && o.giveCash === 0;
    const buysFromMe = o.wantItems.length > 0 && o.giveItems.length === 0 && o.wantCash === 0;
    if (sellsToMe)
      return incoming
        ? `${subj}: ${list(o.giveItems)} <b>${won(o.wantCash)}</b>에 사실래요?`
        : `${subj}에게 ${list(o.giveItems)} <b>${won(o.wantCash)}</b>에 팔기`;
    if (buysFromMe)
      return incoming
        ? `${subj}: 당신의 ${list(o.wantItems)} <b>${won(o.giveCash)}</b>에 살게요`
        : `${subj}에게서 ${list(o.wantItems)} <b>${won(o.giveCash)}</b>에 사기`;
    const side = (cash: number, ids: string[]) => [ids.length ? list(ids) : '', cash ? `<b>${won(cash)}</b>` : ''].filter(Boolean).join(' + ') || '없음';
    return incoming
      ? `${subj}: ${side(o.giveCash, o.giveItems)}을(를) 줄 테니 ${side(o.wantCash, o.wantItems)}을(를) 주세요`
      : `${subj}: ${side(o.giveCash, o.giveItems)} ⇄ ${side(o.wantCash, o.wantItems)}`;
  }

  private incomingCard(v: PlayerView, o: Offer): string {
    const left = Math.max(0, Math.ceil(o.expiresAt - v.now));
    const theirs = o.giveItems.map((id) => v.items[id]);
    const info = theirs
      .map((it) => {
        const t = TYPE_BY_ID[it.type];
        const g = o.guarantee.includes(it.id) ? '<i class="tag good">🛡 보증 · 하자면 물어줌</i>' : '';
        const ap = !it.known ? `<button class="mini" data-act="appraise" data-id="${it.id}">감정 ${man(v.appraisalCost)}</button>` : '';
        return `<span class="info">${t.name} 시세 ${man(v.prices[it.type])} ${this.tag(it)}${g}${ap}</span>`;
      })
      .join('');
    return `<article class="offer in" style="--c:${PLAYER_CSS[o.from]}">
      <p class="say">${this.sentence(v, o, true)}</p>
      ${o.line ? `<q>“${esc(o.line)}”</q>` : ''}
      ${info ? `<div class="infos">${info}</div>` : ''}
      <footer>
        <button class="primary" data-act="accept" data-id="${o.id}">좋아요</button>
        <button data-act="counter" data-id="${o.id}">가격 바꾸기</button>
        <button class="ghost" data-act="reject" data-id="${o.id}">싫어요</button>
        <span class="muted">${left}초</span>
      </footer></article>`;
  }

  private trades(v: PlayerView): string {
    const incoming = v.offers.filter((o) => o.to === v.me.id && o.status === 'pending');
    const mine = v.offers
      .filter((o) => o.from === v.me.id)
      .slice(-3)
      .reverse();
    const status: Record<string, string> = {
      pending: '답 기다리는 중',
      accepted: '✅ 성사',
      rejected: '거절됨',
      expired: '시간 초과',
      cancelled: '취소함',
      failed: '실패',
    };
    const people = v.players
      .filter((p) => p.id !== v.me.id)
      .map((p) => {
        const off = this.meta.offline.includes(p.id) ? ' · 끊김' : '';
        const warn = p.violations ? ` · ⚠ 보증 어김 ${p.violations}` : '';
        return `<button class="person" style="--c:${PLAYER_CSS[p.id]}" data-act="pick" data-n="${p.id}">
          <b>${esc(p.name)}</b><span>물건 ${p.items.length}개${off}${warn}</span></button>`;
      })
      .join('');
    const sent = mine
      .map(
        (o) => `<li>${this.sentence(v, o, false)} <span class="muted">${status[o.status]}${o.status === 'pending' ? ` ${Math.max(0, Math.ceil(o.expiresAt - v.now))}초` : ''}</span>
          ${o.status === 'pending' ? `<button class="mini ghost" data-act="cancel" data-id="${o.id}">취소</button>` : ''}</li>`,
      )
      .join('');
    return `
      ${incoming.length ? `<h3>받은 제안 ${incoming.length}</h3><div class="offers">${incoming.map((o) => this.incomingCard(v, o)).join('')}</div>` : ''}
      <h3>누구랑 거래할까요?</h3>
      <div class="people">${people}</div>
      ${sent ? `<ul class="sent">${sent}</ul>` : ''}`;
  }

  private settle(v: PlayerView): string {
    const lines: string[] = [];
    for (const r of v.auctionResults) {
      const it = v.items[r.itemId];
      if (!it) continue;
      lines.push(
        r.winner === null
          ? `${this.itemName(v, r.itemId)} — 아무도 안 삼`
          : `${this.itemName(v, r.itemId)} → ${this.who(v, r.winner)} ${won(r.price)}`,
      );
    }
    const news = v.reports.map((r) => `<li>${esc(r)}</li>`).join('');
    const next = v.nextEvent ? `<p class="event">📣 다음 라운드: ${describeEvent(v.nextEvent)}</p>` : '';
    return `<div class="cols">
        <div><h3>경매 결과</h3><ul class="plain">${lines.map((l) => `<li>${l}</li>`).join('') || '<li class="muted">없음</li>'}</ul></div>
        <div><h3>내 소식</h3><ul class="plain">${news || '<li class="muted">특별한 일 없음</li>'}</ul>${next}</div>
      </div>`;
  }

  private final(v: PlayerView): string {
    const rows = (v.final ?? [])
      .map((f, i) => {
        const label = this.meta.botLabels[f.player] ? `<i class="tag">${this.meta.botLabels[f.player]}</i>` : '';
        return `<tr class="${f.player === v.me.id ? 'me' : ''}"><td>${i + 1}위</td>
          <td>${this.who(v, f.player)} ${label}</td>
          <td class="num total">${won(f.total)}</td>
          <td class="num muted">현금 ${f.cash.toLocaleString()} · 물건 ${f.items.toLocaleString()} · 세트 ${f.sets.toLocaleString()} · 목표 ${f.goal.toLocaleString()}</td></tr>`;
      })
      .join('');
    return `<div class="scroll"><table class="final"><tbody>${rows}</tbody></table></div>
      <button class="primary big wide" data-act="restart">한 판 더</button>`;
  }

  private helpHtml(): string {
    return `<div class="sheet help">
      <h2>이렇게 해요</h2>
      <ol class="howto">
        <li><b>목표</b> 5라운드 뒤 <b>돈 + 물건 값</b>이 제일 많으면 승리</li>
        <li><b>구경</b> 새 물건 4개. 상태가 궁금하면 <b>감정</b>(1만원)</li>
        <li><b>경매</b> 갖고 싶은 물건에 몰래 입찰. 제일 많이 쓴 사람이 가져감</li>
        <li><b>거래</b> 사람을 눌러 사거나 팔기. 상대 말은 거짓말일 수도 있어요</li>
        <li><b>결과</b> 산 물건의 진짜 상태가 공개돼요. 고장이면 값이 뚝</li>
      </ol>
      <p class="tip">💡 같은 시리즈(같은 색 점)의 서로 다른 물건을 모으면 <b>보너스</b>가 커요</p>
      <p class="tip">🛡 팔 때 <b>보증</b>을 붙이면 비싸게 팔기 쉽지만, 하자면 물어줘야 해요</p>
      <button class="primary big wide" data-act="help">시작하기</button></div>`;
  }

  private composer(v: PlayerView, d: Draft): string {
    const target = v.players[d.to];
    const tab = (m: Mode, label: string) => `<button class="${d.mode === m ? 'on' : ''}" data-act="d-mode" data-id="${m}">${label}</button>`;
    const card = (id: string) => {
      const it = v.items[id];
      return `<button class="pickcard ${d.item === id ? 'on' : ''}" data-act="d-item" data-id="${id}">
        ${icon(it.type, 'ico-mid')}<span class="iname">${this.itemName(v, id).replace(/<img[^>]*>/, '')}</span><span class="num">시세 ${man(v.prices[it.type])}</span>${this.tag(it)}</button>`;
    };
    let body = '';
    let summary = '';
    let canSend = false;
    if (d.mode === 'swap') {
      const list = (ids: string[], picked: string[], act: string) =>
        ids
          .map(
            (id) =>
              `<button class="pickcard ${picked.includes(id) ? 'on' : ''}" data-act="${act}" data-id="${id}"><span class="iname">${this.itemName(v, id)}</span>${this.tag(v.items[id])}</button>`,
          )
          .join('') || '<p class="muted">물건 없음</p>';
      const cash = (key: 'giveCash' | 'wantCash') => `<div class="stepper small">
        <button data-act="d-cash" data-id="${key}" data-n="-10000">−</button><b class="num">현금 ${won(d[key])}</b>
        <button data-act="d-cash" data-id="${key}" data-n="10000">+</button></div>`;
      body = `<div class="cols2">
        <section><h3>내가 줄 것</h3><div class="picks">${list(v.players[v.me.id].items, d.give, 'd-give')}</div>${cash('giveCash')}</section>
        <section><h3>받을 것</h3><div class="picks">${list(target.items, d.want, 'd-want')}</div>${cash('wantCash')}</section></div>`;
      canSend = d.give.length + d.want.length > 0;
      summary = canSend ? '물건과 현금을 섞어서 교환을 제안해요' : '주고받을 물건을 고르세요';
    } else {
      const ids = d.mode === 'buy' ? target.items : v.players[v.me.id].items;
      const pickTitle = d.mode === 'buy' ? `${esc(target.name)}의 물건 중 뭘 살까요?` : '내 물건 중 뭘 팔까요?';
      body = `<h3>${pickTitle}</h3><div class="picks">${ids.map(card).join('') || '<p class="muted">물건이 없어요</p>'}</div>`;
      if (d.item) {
        const name = TYPE_BY_ID[v.items[d.item].type].name;
        body += `<h3>얼마에?</h3><div class="stepper">
          <button data-act="d-price" data-n="-10000" aria-label="1만원 내리기">−</button><b class="num">${won(d.price)}</b>
          <button data-act="d-price" data-n="10000" aria-label="1만원 올리기">+</button></div>`;
        if (d.mode === 'sell') {
          body += `<button class="check ${d.guarantee ? 'on' : ''}" data-act="d-guar" ${v.me.tokens < 1 ? 'disabled' : ''}>
            ${d.guarantee ? '☑' : '☐'} 🛡 보증 붙이기 <span class="muted">— 하자면 물어줘요 (남은 보증권 ${v.me.tokens}장)</span></button>`;
        }
        summary =
          d.mode === 'buy'
            ? `${esc(target.name)}에게 <b>${name}</b>을(를) <b>${won(d.price)}</b>에 사겠다고 해요`
            : `${esc(target.name)}에게 <b>${name}</b>을(를) <b>${won(d.price)}</b>에 팔겠다고 해요${d.guarantee ? ' (보증)' : ''}`;
        canSend = d.price > 0;
      } else summary = '물건을 고르세요';
    }
    const lines = PITCHES.map(
      (p, i) => `<button class="mini ${d.line === p ? 'on' : ''}" data-act="d-line" data-n="${i}">${p}</button>`,
    ).join('');
    return `<div class="sheet composer" style="--c:${PLAYER_CSS[d.to]}">
      <header><h2>${esc(target.name)}와 거래</h2><button class="ghost" data-act="d-close" aria-label="닫기">✕</button></header>
      <div class="tabs">${tab('buy', '사기')}${tab('sell', '팔기')}${tab('swap', '교환')}</div>
      ${body}
      <div class="lines"><span class="muted">한마디 (선택)</span><div class="quick">${lines}</div></div>
      <p class="summary">${summary}</p>
      <button class="primary big wide" data-act="d-send" ${canSend ? '' : 'disabled'}>제안 보내기</button>
    </div>`;
  }
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const icon = (typeId: string, cls = 'ico') => (ITEM_ICONS[typeId] ? `<img class="${cls}" src="${ITEM_ICONS[typeId]}" alt="">` : '');

function seenHelp(): boolean {
  try {
    return localStorage.getItem('jg:help') === '1';
  } catch {
    return false;
  }
}

function markHelpSeen(): void {
  try {
    localStorage.setItem('jg:help', '1');
  } catch {
    // 다음에 다시 보일 뿐
  }
}
