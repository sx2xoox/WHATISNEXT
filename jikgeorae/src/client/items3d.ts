// 물건 20종의 3D 모형. 모델 파일 없이 기본 도형을 조립한다.
// 모두 바닥(y=0)에 서고, 높이는 대략 1 안팎이며 앞면이 +z를 본다.
import * as THREE from 'three';
import { ITEM_TYPES } from '../core/items';

const gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const mats = new Map<number, THREE.MeshToonMaterial>();
const toon = (color: number) => {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradient });
    mats.set(color, m);
  }
  return m;
};
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });

type Part = (g: THREE.Group) => void;

function box(g: THREE.Group, w: number, h: number, d: number, color: number | THREE.Material, x = 0, y = 0, z = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? toon(color) : color);
  m.position.set(x, y, z);
  m.rotation.set(0, ry, rz);
  g.add(m);
  return m;
}

function cyl(g: THREE.Group, r: number, h: number, color: number | THREE.Material, x = 0, y = 0, z = 0, rx = 0, rz = 0, r2 = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, h, 20), typeof color === 'number' ? toon(color) : color);
  m.position.set(x, y, z);
  m.rotation.set(rx, 0, rz);
  g.add(m);
  return m;
}

function ball(g: THREE.Group, r: number, color: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), toon(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  g.add(m);
  return m;
}

const FRONT = Math.PI / 2; // 원기둥을 앞(+z)으로 눕힐 때

const DARK = 0x1c1a22;
const SILVER = 0xbfc4cc;
const GOLD = 0xe8b730;
const WOOD = 0x8a5a33;

const BUILDERS: Record<string, Part> = {
  // ---------- 레트로 게임 ----------
  gameboy: (g) => {
    box(g, 0.62, 0.98, 0.16, 0xd9d4cc, 0, 0.49);
    box(g, 0.48, 0.36, 0.02, 0x4a5a3a, 0, 0.7, 0.085);
    box(g, 0.2, 0.06, 0.03, DARK, -0.15, 0.3, 0.085);
    box(g, 0.06, 0.2, 0.03, DARK, -0.15, 0.3, 0.085);
    cyl(g, 0.05, 0.03, 0xc8324a, 0.13, 0.27, 0.085, FRONT);
    cyl(g, 0.05, 0.03, 0xc8324a, 0.22, 0.34, 0.085, FRONT);
  },
  cartridge: (g) => {
    [0xe8524a, 0x4f8ef7, 0xf2c14e].forEach((c, i) => {
      box(g, 0.62, 0.14, 0.72, 0x55505e, 0, 0.07 + i * 0.15, 0, i * 0.12 - 0.12);
      box(g, 0.5, 0.02, 0.5, c, 0, 0.15 + i * 0.15, 0.04, i * 0.12 - 0.12);
    });
  },
  padset: (g) => {
    box(g, 0.95, 0.12, 0.42, 0xb9b4ad, 0, 0.06);
    box(g, 0.2, 0.03, 0.06, DARK, -0.27, 0.135, 0.03);
    box(g, 0.06, 0.03, 0.2, DARK, -0.27, 0.135, 0.03);
    cyl(g, 0.05, 0.04, 0xc8324a, 0.2, 0.13, 0.04);
    cyl(g, 0.05, 0.04, 0xc8324a, 0.33, 0.13, 0.04);
    cyl(g, 0.02, 0.6, DARK, 0, 0.06, -0.5, FRONT);
  },
  limitedconsole: (g) => {
    box(g, 1.0, 0.32, 0.72, GOLD, 0, 0.16);
    box(g, 0.5, 0.04, 0.2, DARK, -0.1, 0.33, 0);
    box(g, 0.08, 0.08, 0.08, 0xe8524a, 0.35, 0.34, 0.2);
    box(g, 0.34, 0.08, 0.2, 0xf4e3a0, 0.15, 0.36, 0.35);
  },

  // ---------- 피규어 ----------
  robot: (g) => {
    cyl(g, 0.34, 0.08, DARK, 0, 0.04);
    box(g, 0.12, 0.34, 0.14, 0x3a6fd8, -0.1, 0.25);
    box(g, 0.12, 0.34, 0.14, 0x3a6fd8, 0.1, 0.25);
    box(g, 0.42, 0.36, 0.24, 0xf1f1f4, 0, 0.6);
    box(g, 0.24, 0.12, 0.05, 0x3a6fd8, 0, 0.64, 0.13);
    box(g, 0.1, 0.34, 0.12, 0x3a6fd8, -0.28, 0.58);
    box(g, 0.1, 0.34, 0.12, 0x3a6fd8, 0.28, 0.58);
    box(g, 0.22, 0.2, 0.2, 0xf1f1f4, 0, 0.9);
    box(g, 0.16, 0.04, 0.02, 0xf2c14e, 0, 0.92, 0.11);
  },
  anime: (g) => {
    cyl(g, 0.3, 0.06, DARK, 0, 0.03);
    cyl(g, 0.06, 0.4, 0x2c2a38, 0, 0.26, 0, 0, 0, 0.22);
    cyl(g, 0.12, 0.26, 0xf3a6c4, 0, 0.58, 0, 0, 0, 0.16);
    ball(g, 0.16, 0xf6d7c0, 0, 0.84);
    ball(g, 0.18, 0x3a2a4a, 0, 0.88, -0.03, 1, 1, 1);
    ball(g, 0.03, DARK, -0.06, 0.85, 0.15);
    ball(g, 0.03, DARK, 0.06, 0.85, 0.15);
  },
  limitedfig: (g) => {
    box(g, 0.5, 0.24, 0.5, 0x7a3f2c, 0, 0.12);
    box(g, 0.54, 0.04, 0.54, GOLD, 0, 0.25);
    ball(g, 0.18, GOLD, 0, 0.45, 0, 1, 1.2, 1);
    ball(g, 0.12, GOLD, 0, 0.72, 0.06);
    box(g, 0.34, 0.03, 0.18, GOLD, -0.22, 0.6, -0.05, 0, 0.6);
    box(g, 0.34, 0.03, 0.18, GOLD, 0.22, 0.6, -0.05, 0, -0.6);
    ball(g, 0.025, 0xc8324a, -0.04, 0.75, 0.16);
    ball(g, 0.025, 0xc8324a, 0.04, 0.75, 0.16);
  },
  plamodel: (g) => {
    box(g, 0.95, 0.32, 0.7, 0xf1eee8, 0, 0.16);
    box(g, 0.96, 0.06, 0.71, 0x3a6fd8, 0, 0.26);
    box(g, 0.3, 0.2, 0.02, 0xc8324a, 0.15, 0.17, 0.36);
    box(g, 0.12, 0.08, 0.02, 0xf2c14e, 0.15, 0.2, 0.372);
  },

  // ---------- 빈티지 오디오 ----------
  cassette: (g) => {
    box(g, 0.72, 0.46, 0.16, 0x2a3350, 0, 0.23);
    box(g, 0.5, 0.18, 0.02, 0x9fb3c8, 0, 0.26, 0.085);
    cyl(g, 0.05, 0.03, DARK, -0.12, 0.26, 0.09, FRONT);
    cyl(g, 0.05, 0.03, DARK, 0.12, 0.26, 0.09, FRONT);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 8, 24, Math.PI), toon(DARK));
    band.position.set(0, 0.5, 0);
    g.add(band);
    cyl(g, 0.09, 0.07, 0xc8324a, -0.34, 0.5, 0, 0, FRONT);
    cyl(g, 0.09, 0.07, 0xc8324a, 0.34, 0.5, 0, 0, FRONT);
  },
  turntable: (g) => {
    box(g, 1.0, 0.14, 0.8, WOOD, 0, 0.07);
    cyl(g, 0.34, 0.03, DARK, -0.08, 0.16);
    cyl(g, 0.08, 0.035, 0xc8324a, -0.08, 0.165);
    cyl(g, 0.05, 0.08, SILVER, 0.36, 0.18, -0.26);
    box(g, 0.04, 0.03, 0.46, SILVER, 0.3, 0.2, -0.04, 0.3);
  },
  lpset: (g) => {
    [0xe8524a, 0xf2c14e, 0x4f8ef7, 0x6fcf8a].forEach((c, i) => {
      box(g, 0.78, 0.05, 0.78, c, 0, 0.03 + i * 0.055, 0, i * 0.15 - 0.2);
    });
    cyl(g, 0.36, 0.02, DARK, 0.18, 0.25, 0.1);
    cyl(g, 0.08, 0.025, 0xf2a33a, 0.18, 0.255, 0.1);
  },
  tubeamp: (g) => {
    box(g, 1.0, 0.28, 0.5, 0x3a2e2a, 0, 0.14);
    box(g, 1.01, 0.04, 0.51, SILVER, 0, 0.29);
    [-0.3, 0, 0.3].forEach((x) => {
      cyl(g, 0.07, 0.34, glow(0xffa94d), x, 0.48, -0.05);
      cyl(g, 0.08, 0.04, DARK, x, 0.33, -0.05);
    });
    [-0.3, 0, 0.3].forEach((x) => cyl(g, 0.04, 0.05, SILVER, x, 0.12, 0.27, FRONT));
  },

  // ---------- 필름 카메라 ----------
  filmcam: (g) => {
    box(g, 0.86, 0.3, 0.3, DARK, 0, 0.15);
    box(g, 0.86, 0.16, 0.3, SILVER, 0, 0.38);
    box(g, 0.24, 0.14, 0.24, DARK, 0, 0.52);
    cyl(g, 0.17, 0.28, DARK, 0, 0.26, 0.26, FRONT);
    cyl(g, 0.12, 0.02, 0x3a6fd8, 0, 0.26, 0.41, FRONT);
    cyl(g, 0.05, 0.06, SILVER, 0.3, 0.49, 0);
  },
  lens: (g) => {
    cyl(g, 0.3, 0.6, DARK, 0, 0.3);
    cyl(g, 0.31, 0.06, GOLD, 0, 0.42);
    cyl(g, 0.31, 0.1, 0x3a3640, 0, 0.18);
    cyl(g, 0.24, 0.02, 0x3a6fd8, 0, 0.605);
  },
  instant: (g) => {
    box(g, 0.8, 0.62, 0.42, 0xf4f1ec, 0, 0.31);
    [0xe8524a, 0xf2a33a, 0xf2c14e, 0x6fcf8a, 0x4f8ef7].forEach((c, i) => box(g, 0.05, 0.62, 0.02, c, -0.12 + i * 0.05, 0.31, 0.215));
    cyl(g, 0.15, 0.1, DARK, 0.18, 0.3, 0.25, FRONT);
    cyl(g, 0.1, 0.02, 0x3a6fd8, 0.18, 0.3, 0.31, FRONT);
    box(g, 0.16, 0.1, 0.02, DARK, -0.25, 0.5, 0.215);
  },
  tripod: (g) => {
    // 다리 셋이 꼭대기 한 점에서 벌어진다
    const top = new THREE.Vector3(0, 0.92, 0);
    [0.3, 0.3 + (Math.PI * 2) / 3, 0.3 + (Math.PI * 4) / 3].forEach((a) => {
      const foot = new THREE.Vector3(Math.sin(a) * 0.36, 0, Math.cos(a) * 0.36);
      const dir = top.clone().sub(foot);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, dir.length(), 8), toon(WOOD));
      leg.position.copy(foot).addScaledVector(dir, 0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      g.add(leg);
    });
    box(g, 0.22, 0.12, 0.22, DARK, 0, 0.96);
    box(g, 0.3, 0.06, 0.12, DARK, 0, 1.05);
  },

  // ---------- 스트릿 패션 ----------
  sneakers: (g) => {
    box(g, 0.36, 0.1, 0.95, 0xf4f1ec, 0, 0.05);
    box(g, 0.34, 0.34, 0.62, 0xe8524a, 0, 0.27, -0.14);
    box(g, 0.34, 0.16, 0.34, 0xf4f1ec, 0, 0.18, 0.28);
    box(g, 0.3, 0.12, 0.2, 0xe8524a, 0, 0.5, -0.32);
    box(g, 0.02, 0.18, 0.4, 0xf4f1ec, 0.175, 0.28, -0.1);
  },
  jacket: (g) => {
    box(g, 0.56, 0.7, 0.2, 0x3f68a8, 0, 0.45);
    box(g, 0.02, 0.66, 0.21, 0xd9c08a, 0, 0.45);
    box(g, 0.14, 0.62, 0.16, 0x3f68a8, -0.36, 0.44, 0, 0, -0.15);
    box(g, 0.14, 0.62, 0.16, 0x3f68a8, 0.36, 0.44, 0, 0, 0.15);
    box(g, 0.36, 0.08, 0.22, 0xe8e2d6, 0, 0.83);
    box(g, 0.12, 0.1, 0.02, 0x2f5288, -0.14, 0.6, 0.105);
    box(g, 0.12, 0.1, 0.02, 0x2f5288, 0.14, 0.6, 0.105);
  },
  cap: (g) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(DARK));
    g.add(dome);
    const brim = cyl(g, 0.3, 0.03, DARK, 0, 0.02, 0.3);
    brim.scale.set(1, 1, 0.75);
    box(g, 0.14, 0.12, 0.02, 0xf2c14e, 0, 0.18, 0.31, 0, 0.3);
    box(g, 0.08, 0.08, 0.025, 0xe8524a, 0.03, 0.2, 0.315);
  },
  watch: (g) => {
    box(g, 0.2, 0.36, 0.06, 0x6b4426, 0, 0.18);
    box(g, 0.2, 0.36, 0.06, 0x6b4426, 0, 0.86);
    cyl(g, 0.26, 0.1, GOLD, 0, 0.52, 0, FRONT);
    cyl(g, 0.21, 0.02, 0xf8f4ea, 0, 0.52, 0.055, FRONT);
    box(g, 0.02, 0.14, 0.01, DARK, 0, 0.58, 0.07);
    box(g, 0.1, 0.02, 0.01, DARK, 0.04, 0.52, 0.07);
    cyl(g, 0.04, 0.06, GOLD, 0.28, 0.52, 0, 0, FRONT);
  },
};

export function makeItemModel(typeId: string): THREE.Group {
  const g = new THREE.Group();
  (BUILDERS[typeId] ?? BUILDERS.cartridge)(g);
  return g;
}

// 카드에 쓸 썸네일: 같은 3D 모형을 작은 화면에 한 번씩 찍어 둔다
export const ITEM_ICONS: Record<string, string> = {};

export function renderItemIcons(size = 128): void {
  const canvas = document.createElement('canvas');
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return; // WebGL이 없으면 썸네일 없이 이름만 보인다
  }
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffeedd, 0x403050, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(2, 4, 5);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const bounds = new THREE.Box3();
  const center = new THREE.Vector3();
  const sizeV = new THREE.Vector3();
  for (const t of ITEM_TYPES) {
    const model = makeItemModel(t.id);
    model.rotation.y = -0.5;
    scene.add(model);
    bounds.setFromObject(model);
    bounds.getCenter(center);
    bounds.getSize(sizeV);
    const dist = Math.max(sizeV.x, sizeV.y, sizeV.z) * 2.3;
    camera.position.set(center.x, center.y + dist * 0.35, center.z + dist);
    camera.lookAt(center);
    renderer.render(scene, camera);
    ITEM_ICONS[t.id] = canvas.toDataURL('image/png');
    scene.remove(model);
  }
  renderer.dispose();
}
