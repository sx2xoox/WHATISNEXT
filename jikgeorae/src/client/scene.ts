// 1인칭 토론장. 모델 파일 없이 기본 도형만으로 만든다.
import * as THREE from 'three';
import { TYPE_BY_ID } from '../core/items';
import type { PlayerView } from '../core/view';
import { makeItemModel } from './items3d';

export const PLAYER_COLORS = [0xf2c14e, 0xe8524a, 0x4f8ef7, 0x6fcf8a];
export const PLAYER_CSS = ['#f2c14e', '#e8524a', '#4f8ef7', '#6fcf8a'];

const R = 3.4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// 0번(나)은 앞쪽, 나머지는 맞은편 호를 따라 선다
const SEAT_ANGLES = [0, Math.PI * 0.72, Math.PI, Math.PI * 1.28];
const PHASE_NAME: Record<string, string> = {
  lobby: '대기',
  market: '시장 공개',
  auction: '비공개 경매',
  trade: '직거래',
  settle: '감정 · 정산',
  end: '최종 결과',
};

interface Seat {
  pid: number; // 이 자리에 앉은 플레이어. 나는 항상 0번 자리
  pos: THREE.Vector3;
  stripe: THREE.Mesh;
  podium: THREE.Group;
  shelf: THREE.Group;
  body?: THREE.Group;
  mats: THREE.MeshToonMaterial[];
  bubble?: HTMLDivElement;
  bubbleUntil: number;
  lookAt: THREE.Vector3;
  shelfKey: string;
}

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.05, 100);
  private gradient: THREE.DataTexture;
  private seats: Seat[] = [];
  private table = new THREE.Group();
  private lotModels = new Map<string, THREE.Group>();
  private lotLabels = new Map<string, HTMLDivElement>();
  private screenCanvas = document.createElement('canvas');
  private screenTex: THREE.CanvasTexture;
  private screenKey = '';
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2(0, 0);
  private look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 };
  private hover = -1;
  private time = 0;
  onPick: (pid: number) => void = () => {};

  constructor(
    private host: HTMLElement,
    private labels: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.gradient = new THREE.DataTexture(new Uint8Array([80, 160, 255]), 3, 1, THREE.RedFormat);
    this.gradient.minFilter = this.gradient.magFilter = THREE.NearestFilter;
    this.gradient.needsUpdate = true;

    this.screenCanvas.width = 1024;
    this.screenCanvas.height = 320;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x14111a);
    this.scene.fog = new THREE.Fog(0x14111a, 9, 18);
    this.buildRoom();
    for (let i = 0; i < SEAT_ANGLES.length; i++) this.seats.push(this.buildSeat(i));
    // 내 물건은 오른쪽 패널에 있으니 카메라 바로 앞 단상에는 놓지 않는다 (화면을 가림)
    this.seats[0].shelf.visible = false;
    this.scene.add(this.table);

    const cam = this.seats[0].pos;
    this.camera.position.set(cam.x, 1.62, cam.z + 0.25);

    const canvas = this.renderer.domElement;
    // 드래그해서 둘러본다. 마우스를 가만히 두는 위치에 따라 시점이 돌아가지 않게.
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
    window.addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (!drag) return;
      this.look.tYaw = clamp(this.look.tYaw + (e.clientX - drag.x) * 0.004, -1.1, 1.1);
      this.look.tPitch = clamp(this.look.tPitch - (e.clientY - drag.y) * 0.003, -0.35, 0.3);
      drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerleave', () => (this.hover = -1));
    canvas.addEventListener('click', () => {
      if (this.hover > 0) this.onPick(this.seats[this.hover].pid);
    });
    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  private toon(color: number, emissive = 0x000000): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({ color, emissive, gradientMap: this.gradient });
  }

  private fit(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 화면이 좁으면 시야를 넓혀 맞은편 세 명이 모두 보이게
    this.camera.fov = w / h < 1.2 ? 80 : 62;
    this.camera.updateProjectionMatrix();
  }

  private buildRoom(): void {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64).rotateX(-Math.PI / 2), this.toon(0x2a2230));
    this.scene.add(floor);
    const rug = new THREE.Mesh(new THREE.RingGeometry(2.2, 4.6, 64).rotateX(-Math.PI / 2), this.toon(0x3d2a3a));
    rug.position.y = 0.005;
    this.scene.add(rug);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(7.5, 7.5, 7, 64, 1, true),
      new THREE.MeshToonMaterial({ color: 0x241d2b, side: THREE.BackSide, gradientMap: this.gradient }),
    );
    wall.position.y = 3.5;
    this.scene.add(wall);
    // 벽의 세로 조명
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      if (Math.abs(a - Math.PI) < 0.5) continue; // 전광판 자리는 비운다
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 4, 0.06),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0x5b3f6e : 0x8a5a3c }),
      );
      strip.position.set(Math.sin(a) * 7.3, 2.6, Math.cos(a) * 7.3);
      this.scene.add(strip);
    }
    // 맞은편 벽의 전광판
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.62), new THREE.MeshBasicMaterial({ map: this.screenTex }));
    screen.position.set(0, 3.9, -7.1);
    this.scene.add(screen);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.9, 0.1), this.toon(0x111014));
    frame.position.set(0, 3.9, -7.2);
    this.scene.add(frame);

    // 가운데 경매대
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.8, 40), this.toon(0x3a3040));
    base.position.y = 0.4;
    this.scene.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.08, 48), this.toon(0x5a4a5e));
    top.position.y = 0.84;
    this.scene.add(top);
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.22, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf2a33a }),
    );
    glow.position.y = 0.885;
    this.scene.add(glow);

    this.scene.add(new THREE.HemisphereLight(0xffe7d0, 0x2a1f35, 1.3));
    const key = new THREE.DirectionalLight(0xfff0e0, 1.6);
    key.position.set(2, 8, 4);
    this.scene.add(key);
    const warm = new THREE.PointLight(0xffb070, 18, 9);
    warm.position.set(0, 3.2, 0);
    this.scene.add(warm);
  }

  private nameplate(name: string, color: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#16131b';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = color;
    g.fillRect(0, 112, 512, 16);
    g.fillStyle = '#f4ede4';
    g.font = '700 64px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, 256, 58);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildSeat(i: number): Seat {
    const a = SEAT_ANGLES[i];
    const pos = new THREE.Vector3(Math.sin(a) * R, 0, Math.cos(a) * R);
    const yaw = Math.atan2(-pos.x, -pos.z);
    const color = PLAYER_COLORS[i];

    const podium = new THREE.Group();
    const pPos = pos.clone().multiplyScalar((R - 0.55) / R);
    podium.position.copy(pPos);
    podium.rotation.y = yaw;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.05, 0.55), this.toon(0x2e2633));
    box.position.y = 0.525;
    podium.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.06, 0.66), this.toon(0x4a3b4f));
    lid.position.y = 1.08;
    podium.add(lid);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.31, 0.05, 0.56), new THREE.MeshBasicMaterial({ color }));
    stripe.position.y = 0.2;
    podium.add(stripe);
    this.scene.add(podium);

    const shelf = new THREE.Group();
    shelf.position.y = 1.11;
    podium.add(shelf);

    const seat: Seat = {
      pid: i,
      pos,
      stripe,
      podium,
      shelf,
      mats: [],
      bubbleUntil: 0,
      lookAt: new THREE.Vector3(0, 1.4, 0),
      shelfKey: '',
    };

    if (i > 0) {
      const body = new THREE.Group();
      body.position.copy(pos);
      body.rotation.y = yaw;
      const mat = this.toon(color);
      seat.mats.push(mat);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.75, 8, 20), mat);
      torso.position.y = 1.25;
      body.add(torso);
      const white = this.toon(0xffffff);
      const black = new THREE.MeshBasicMaterial({ color: 0x141018 });
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), white);
        eye.position.set(sx * 0.15, 1.62, 0.34);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), black);
        pupil.position.set(sx * 0.15, 1.63, 0.44);
        body.add(eye, pupil);
      }
      this.scene.add(body);
      seat.body = body;
      torso.userData.seat = i;

      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 0.25),
        new THREE.MeshBasicMaterial({ map: this.nameplate('', PLAYER_CSS[i]) }),
      );
      plate.name = 'plate';
      plate.position.set(0, 0.72, 0.281);
      podium.add(plate);
      box.userData.seat = i;

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.style.setProperty('--c', PLAYER_CSS[i]);
      this.labels.appendChild(bubble);
      seat.bubble = bubble;
    }
    return seat;
  }

  // 내 번호를 기준으로 자리를 돌려 앉힌다. 인원이 4명보다 적으면 남는 자리는 숨긴다.
  assign(me: number, names: string[]): void {
    const n = names.length;
    this.seats.forEach((seat, i) => {
      const used = i < n;
      seat.podium.visible = used;
      if (seat.body) seat.body.visible = used;
      if (!used) {
        seat.pid = -1;
        return;
      }
      const pid = (me + i) % n;
      seat.pid = pid;
      seat.shelfKey = '';
      (seat.stripe.material as THREE.MeshBasicMaterial).color.setHex(PLAYER_COLORS[pid]);
      for (const m of seat.mats) m.color.setHex(PLAYER_COLORS[pid]);
      seat.bubble?.style.setProperty('--c', PLAYER_CSS[pid]);
      const plate = seat.podium.getObjectByName('plate') as THREE.Mesh | undefined;
      if (plate) {
        const mat = plate.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.map = this.nameplate(names[pid], PLAYER_CSS[pid]);
        mat.needsUpdate = true;
      }
    });
  }

  private seatOf(pid: number): Seat | undefined {
    return this.seats.find((s) => s.pid === pid);
  }

  say(who: number, text: string, to: number | null): void {
    const seat = this.seatOf(who);
    if (!seat?.bubble) return;
    seat.bubble.textContent = text;
    seat.bubbleUntil = this.time + 3.5;
    seat.lookAt = to === null ? new THREE.Vector3(0, 1.4, 0) : this.headOf(to);
  }

  private headOf(pid: number): THREE.Vector3 {
    const seat = this.seatOf(pid);
    if (!seat || seat === this.seats[0]) return this.camera.position.clone();
    return seat.pos.clone().setY(1.6);
  }

  private syncLots(v: PlayerView): void {
    const show = v.phase === 'market' || v.phase === 'auction';
    const ids = show ? v.lots.map((l) => l.itemId) : [];
    for (const [id, m] of this.lotModels) {
      if (ids.includes(id)) continue;
      this.table.remove(m);
      this.lotModels.delete(id);
      this.lotLabels.get(id)?.remove();
      this.lotLabels.delete(id);
    }
    ids.forEach((id, i) => {
      let m = this.lotModels.get(id);
      if (!m) {
        m = makeItemModel(v.items[id].type);
        m.scale.setScalar(0.4);
        this.table.add(m);
        this.lotModels.set(id, m);
        const label = document.createElement('div');
        label.className = 'lot-label';
        this.labels.appendChild(label);
        this.lotLabels.set(id, label);
      }
      const n = ids.length;
      const x = (i - (n - 1) / 2) * 0.55;
      m.position.set(x, 0.92 + Math.sin(this.time * 2 + i) * 0.03, 0.35 - Math.abs(x) * 0.25);
      m.rotation.y = Math.sin(this.time * 0.8 + i) * 0.6;
      const it = v.items[id];
      const label = this.lotLabels.get(id)!;
      const known = it.known ? `<em class="${it.known.mult < 1 ? 'bad' : 'good'}">감정 완료</em>` : '';
      label.innerHTML = `<b>${TYPE_BY_ID[it.type].name}</b><span>${v.prices[it.type].toLocaleString()}원</span>${known}`;
    });
  }

  private syncShelves(v: PlayerView): void {
    v.players.forEach((p) => {
      const seat = this.seatOf(p.id);
      if (!seat) return;
      const key = p.items.join(',');
      if (seat.shelfKey === key) return;
      seat.shelfKey = key;
      seat.shelf.clear();
      const n = p.items.length;
      const step = Math.min(0.24, 1.2 / Math.max(n, 1));
      p.items.forEach((id, k) => {
        const m = makeItemModel(v.items[id].type);
        m.scale.setScalar(0.2);
        m.position.set((k - (n - 1) / 2) * step, 0, 0.05);
        seat.shelf.add(m);
      });
    });
  }

  private drawScreen(v: PlayerView, eventText: string): void {
    const sec = Math.ceil(v.timeLeft);
    const key = `${v.phase}|${v.round}|${sec}|${eventText}`;
    if (key === this.screenKey) return;
    this.screenKey = key;
    const g = this.screenCanvas.getContext('2d')!;
    g.fillStyle = '#0d0b10';
    g.fillRect(0, 0, 1024, 320);
    g.fillStyle = '#f2a33a';
    g.font = '700 40px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    g.textAlign = 'left';
    g.fillText(v.phase === 'end' ? '경기 종료' : `라운드 ${v.round}`, 48, 76);
    g.fillStyle = '#f4ede4';
    g.font = '800 92px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    g.fillText(PHASE_NAME[v.phase], 48, 180);
    if (v.phase !== 'end' && v.phase !== 'lobby') {
      g.textAlign = 'right';
      g.fillStyle = sec <= 5 ? '#e8524a' : '#f4ede4';
      g.fillText(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, 976, 180);
    }
    g.textAlign = 'left';
    g.fillStyle = '#b9a9c6';
    g.font = '500 34px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    g.fillText(eventText, 48, 262);
    this.screenTex.needsUpdate = true;
  }

  private place(el: HTMLElement, world: THREE.Vector3, below = false): void {
    const p = world.clone().project(this.camera);
    const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    el.style.display = visible ? '' : 'none';
    if (!visible) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, ${below ? '0' : '-100%'})`;
  }

  // 게임 시작 전 메뉴 뒤에서 방을 천천히 둘러본다
  idle(dt: number): void {
    this.time += dt;
    const a = Math.sin(this.time * 0.15) * 0.35;
    this.camera.lookAt(this.camera.position.clone().add(new THREE.Vector3(Math.sin(a), -0.08, -Math.cos(a))));
    this.renderer.render(this.scene, this.camera);
  }

  update(v: PlayerView, dt: number, eventText: string, offline: number[] = []): void {
    this.time += dt;
    const k = Math.min(1, dt * 5);
    this.look.yaw += (this.look.tYaw - this.look.yaw) * k;
    this.look.pitch += (this.look.tPitch - this.look.pitch) * k;
    const target = new THREE.Vector3(0, 1.3, -1.2);
    const dir = target.sub(this.camera.position).normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.look.yaw);
    dir.y += this.look.pitch;
    this.camera.lookAt(this.camera.position.clone().add(dir));

    this.syncLots(v);
    this.syncShelves(v);
    this.drawScreen(v, eventText);

    // 마우스가 가리키는 상대 캐릭터
    this.ray.setFromCamera(this.pointer, this.camera);
    const targets = this.seats.flatMap((s) => (s.body && s.pid >= 0 ? [s.body, s.podium] : []));
    const hit = this.ray.intersectObjects(targets, true)[0];
    let hover = -1;
    for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) {
      if (typeof o.userData.seat === 'number') {
        hover = o.userData.seat;
        break;
      }
      const idx = this.seats.findIndex((s) => s.body === o || s.podium === o);
      if (idx > 0) {
        hover = idx;
        break;
      }
    }
    this.hover = v.phase === 'trade' ? hover : -1;
    this.renderer.domElement.style.cursor = this.hover > 0 ? 'pointer' : 'default';

    this.seats.forEach((seat, i) => {
      if (!seat.body) return;
      if (seat.pid < 0) {
        if (seat.bubble) seat.bubble.style.display = 'none';
        return;
      }
      const talking = this.time < seat.bubbleUntil;
      seat.body.position.y = Math.abs(Math.sin(this.time * (talking ? 9 : 2) + i)) * (talking ? 0.06 : 0.02);
      if (!talking) seat.lookAt = this.camera.position.clone().lerp(new THREE.Vector3(0, 1.4, 0), 0.4);
      const want = Math.atan2(seat.lookAt.x - seat.pos.x, seat.lookAt.z - seat.pos.z);
      let d = want - seat.body.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      seat.body.rotation.y += d * Math.min(1, dt * 4);
      for (const m of seat.mats) m.emissive.setHex(this.hover === i ? 0x2a2a2a : 0x000000);
      const ready = v.players[seat.pid]?.ready;
      if (seat.bubble) {
        seat.bubble.classList.toggle('show', talking);
        const away = offline.includes(seat.pid);
        seat.bubble.classList.toggle('ready', !talking && (away || (!!ready && v.phase !== 'end')));
        if (!talking && away) seat.bubble.textContent = '연결 끊김';
        else if (!talking && ready) seat.bubble.textContent = '준비 완료';
        this.place(seat.bubble, seat.pos.clone().setY(2.25));
      }
    });
    for (const [id, label] of this.lotLabels) {
      const m = this.lotModels.get(id);
      if (m) this.place(label, m.position.clone().setY(0.86), true);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
