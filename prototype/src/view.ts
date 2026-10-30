import * as THREE from 'three';
import { ARENA_H, ARENA_W } from './config';
import type { Game, Player, Track } from './game';

// 유령은 모델을 따로 만들지 않고 플레이어와 같은 몸통에 이 셰이더만 씌운다
const GHOST_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const GHOST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(1.0 - max(dot(vN, vV), 0.0), 2.0);
  float scan = 0.82 + 0.18 * sin(gl_FragCoord.y * 0.55 + uTime * 9.0);
  float a = (0.22 + 0.78 * rim) * uOpacity * scan;
  gl_FragColor = vec4(uColor * (0.55 + 0.9 * rim), a);
}`;

// 오래된 유령일수록 흐리게 (인덱스 = 몇 라운드 전 유령인지)
const GHOST_ALPHA = [0, 1, 0.62, 0.34];
const TRAIL = 5;

interface BeanRig {
  root: THREE.Group;
  body: THREE.Group;
}

interface GhostRig {
  root: THREE.Group;
  mat: THREE.ShaderMaterial;
  trail: THREE.Mesh[];
  trailMats: THREE.MeshBasicMaterial[];
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private gradient: THREE.DataTexture;
  private capsule = new THREE.CapsuleGeometry(0.42, 0.5, 8, 18);
  private sphere = new THREE.SphereGeometry(1, 16, 12);
  private coinGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.12, 24).rotateX(Math.PI / 2);
  private coinMat: THREE.MeshToonMaterial;
  private ringGeo = new THREE.RingGeometry(0.7, 0.86, 40).rotateX(-Math.PI / 2);
  private beans: BeanRig[] = [];
  private ghosts = new Map<Track, GhostRig>();
  private coins: THREE.Mesh[] = [];
  private fxPool: THREE.Mesh[] = [];
  private tmp = { x: 0, z: 0 };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.gradient = new THREE.DataTexture(new Uint8Array([90, 165, 255]), 3, 1, THREE.RedFormat);
    this.gradient.minFilter = this.gradient.magFilter = THREE.NearestFilter;
    this.gradient.needsUpdate = true;
    this.coinMat = new THREE.MeshToonMaterial({ color: 0xffd34d, emissive: 0x5a3a00, gradientMap: this.gradient });

    this.scene.background = new THREE.Color(0x14131d);
    this.buildArena();
    this.scene.add(new THREE.AmbientLight(0xb8c4ff, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.position.set(6, 16, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 10;
    sc.bottom = -10;
    this.scene.add(sun);

    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  private toon(color: number): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({ color, gradientMap: this.gradient });
  }

  private buildArena(): void {
    const tile = 32;
    const canvas = document.createElement('canvas');
    canvas.width = ARENA_W * tile;
    canvas.height = ARENA_H * tile;
    const ctx = canvas.getContext('2d')!;
    for (let x = 0; x < ARENA_W; x++) {
      for (let z = 0; z < ARENA_H; z++) {
        ctx.fillStyle = (x + z) % 2 ? '#2b2942' : '#33304d';
        ctx.fillRect(x * tile, z * tile, tile, tile);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_W, ARENA_H).rotateX(-Math.PI / 2),
      new THREE.MeshToonMaterial({ map: tex, gradientMap: this.gradient }),
    );
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), this.toon(0x1b1a28));
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const wallMat = this.toon(0x57528a);
    const t = 0.4;
    const h = 0.5;
    const walls: [number, number, number, number][] = [
      [0, -ARENA_H / 2 - t / 2, ARENA_W + t * 2, t],
      [0, ARENA_H / 2 + t / 2, ARENA_W + t * 2, t],
      [-ARENA_W / 2 - t / 2, 0, t, ARENA_H],
      [ARENA_W / 2 + t / 2, 0, t, ARENA_H],
    ];
    for (const [x, z, w, d] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, h / 2, z);
      m.castShadow = m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  private fit(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dW = (ARENA_W + 3) / 2 / Math.tan(hFov / 2);
    const dH = ((ARENA_H + 3) * 0.85) / 2 / Math.tan(vFov / 2);
    const d = Math.max(dW, dH) + 3;
    const target = new THREE.Vector3(0, 0, -0.6);
    const dir = new THREE.Vector3(0, 0.84, 0.54).normalize();
    this.camera.position.copy(target).addScaledVector(dir, d);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  // 모델링 없이 기본 도형만으로 만든 젤리빈형 캐릭터
  private makeBean(color: number): BeanRig {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const torso = new THREE.Mesh(this.capsule, this.toon(color));
    torso.position.y = 0.76;
    torso.castShadow = true;
    body.add(torso);

    const white = this.toon(0xffffff);
    const black = new THREE.MeshBasicMaterial({ color: 0x15131c });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(this.sphere, white);
      eye.scale.setScalar(0.12);
      eye.position.set(s * 0.16, 1.06, 0.34);
      const pupil = new THREE.Mesh(this.sphere, black);
      pupil.scale.setScalar(0.065);
      pupil.position.set(s * 0.16, 1.07, 0.45);
      body.add(eye, pupil);
    }
    const footMat = this.toon(new THREE.Color(color).multiplyScalar(0.6).getHex());
    for (const s of [-1, 1]) {
      const foot = new THREE.Mesh(this.sphere, footMat);
      foot.scale.set(0.14, 0.09, 0.2);
      foot.position.set(s * 0.2, 0.08, 0.05);
      foot.castShadow = true;
      body.add(foot);
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.68, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    ring.position.y = 0.02;
    root.add(ring);
    this.scene.add(root);
    return { root, body };
  }

  private makeGhost(color: number): GhostRig {
    const root = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      vertexShader: GHOST_VERT,
      fragmentShader: GHOST_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const body = new THREE.Mesh(this.capsule, mat);
    body.position.y = 0.76;
    root.add(body);
    this.scene.add(root);
    const trail: THREE.Mesh[] = [];
    const trailMats: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < TRAIL; i++) {
      const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Mesh(this.sphere, m);
      this.scene.add(s);
      trail.push(s);
      trailMats.push(m);
    }
    return { root, mat, trail, trailMats };
  }

  private dropGhost(rig: GhostRig): void {
    this.scene.remove(rig.root);
    rig.mat.dispose();
    for (const s of rig.trail) this.scene.remove(s);
    for (const m of rig.trailMats) m.dispose();
  }

  setPlayers(players: Player[]): void {
    for (const b of this.beans) this.scene.remove(b.root);
    this.beans = players.map((p) => this.makeBean(p.slot.color));
  }

  render(game: Game): void {
    const time = game.time;
    const inMatch = game.phase !== 'title';

    game.players.forEach((p, i) => {
      const rig = this.beans[i];
      if (!rig) return;
      rig.root.visible = inMatch;
      if (!inMatch) return;
      rig.root.position.set(p.x, 0, p.z);
      rig.root.rotation.y = Math.atan2(p.faceX, p.faceZ);
      if (!p.alive) {
        const s = Math.max(0, 1 - p.deadT * 3);
        rig.body.scale.set(1 + (1 - s) * 0.7, Math.max(s, 0.001), 1 + (1 - s) * 0.7);
        rig.root.visible = s > 0;
        return;
      }
      const speed = Math.hypot(p.vx, p.vz);
      if (p.dashT > 0) rig.body.scale.set(0.82, 0.86, 1.45);
      else rig.body.scale.set(1, 1, 1);
      rig.body.position.y = Math.abs(Math.sin(time * 14)) * 0.09 * Math.min(1, speed / 4);
      rig.body.rotation.x = Math.min(1, speed / 6) * 0.18;
      if (p.grace > 0 && game.phase === 'play') rig.root.visible = Math.floor(time * 12) % 2 === 0;
    });

    // 유령
    const live = new Set(game.tracks);
    for (const [tr, rig] of this.ghosts) {
      if (!live.has(tr)) {
        this.dropGhost(rig);
        this.ghosts.delete(tr);
      }
    }
    const t = game.ghostTime();
    const g = this.tmp;
    for (const tr of game.tracks) {
      let rig = this.ghosts.get(tr);
      if (!rig) {
        rig = this.makeGhost(game.players[tr.owner].slot.color);
        this.ghosts.set(tr, rig);
      }
      const age = game.round - tr.round;
      const show = t >= 0 && age >= 1 && game.ghostAt(tr, t, g);
      rig.root.visible = show;
      for (const s of rig.trail) s.visible = false;
      if (!show) continue;
      const alpha = GHOST_ALPHA[Math.min(age, GHOST_ALPHA.length - 1)];
      rig.root.position.set(g.x, 0, g.z);
      rig.mat.uniforms.uOpacity.value = alpha * (game.phase === 'countdown' ? 0.55 + 0.25 * Math.sin(time * 6) : 1);
      rig.mat.uniforms.uTime.value = time;
      const hx = g.x;
      const hz = g.z;
      for (let k = 0; k < TRAIL; k++) {
        if (!game.ghostAt(tr, t - (k + 1) * 0.07, g)) break;
        const s = rig.trail[k];
        s.visible = true;
        s.position.set(g.x, 0.55, g.z);
        s.scale.setScalar(0.3 - k * 0.04);
        rig.trailMats[k].opacity = alpha * (0.45 - k * 0.08);
      }
      if (t > 0.05 && game.ghostAt(tr, t - 0.05, g)) {
        const dx = hx - g.x;
        const dz = hz - g.z;
        if (Math.hypot(dx, dz) > 0.01) rig.root.rotation.y = Math.atan2(dx, dz);
      }
    }

    // 코인
    while (this.coins.length < game.coins.length) {
      const m = new THREE.Mesh(this.coinGeo, this.coinMat);
      m.castShadow = true;
      this.scene.add(m);
      this.coins.push(m);
    }
    this.coins.forEach((m, i) => {
      const c = game.coins[i];
      m.visible = inMatch && !!c && !c.taken && game.phase !== 'draft';
      if (!m.visible || !c) return;
      const pop = Math.min(1, (time - c.bornAt) * 4);
      const pulse = game.phase === 'countdown' ? 1 + 0.18 * Math.sin(time * 10) : 1;
      m.scale.setScalar(pop * pulse);
      m.position.set(c.x, 0.62 + Math.sin(time * 3 + i) * 0.08, c.z);
      m.rotation.y = time * 2.5 + i;
    });

    // 효과
    while (this.fxPool.length < game.fx.length) {
      const m = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      );
      this.scene.add(m);
      this.fxPool.push(m);
    }
    this.fxPool.forEach((m, i) => {
      const f = game.fx[i];
      m.visible = !!f;
      if (!f) return;
      const k = f.age / 0.7;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(f.color);
      mat.opacity = 1 - k;
      const size = f.kind === 'push' ? 0.6 + k * 2.2 : f.kind === 'death' ? 0.5 + k * 3 : 0.4 + k * 1.2;
      m.scale.setScalar(size);
      m.position.set(f.x, f.kind === 'pickup' ? 0.6 : 0.05, f.z);
    });

    this.renderer.render(this.scene, this.camera);
  }
}
