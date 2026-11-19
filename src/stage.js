/**
 * stage.js — เวที: renderer, แสง, กล้อง และการควบคุมกล้องด้วยมือ
 *
 * ตั้งใจไม่ใช้ postprocessing (bloom/GTAO) และไม่ใช้ addon ของ three เลย
 * เหตุผล: หน้านี้ต้องลื่นบนการ์ดจอออนบอร์ดของโน้ตบุ๊ก และ repo ต้องไม่มี build step
 */

import * as THREE from '../vendor/three.module.js';

// ชุดคุณภาพ — เลือกอัตโนมัติจากความสามารถเครื่อง
export const TIERS = {
  high:   { pixelRatio: 1.6, shadow: 2048, shadows: true,  hudEvery: 1 },
  mid:    { pixelRatio: 1.25, shadow: 1024, shadows: true, hudEvery: 2 },
  low:    { pixelRatio: 1.0, shadow: 512,  shadows: false, hudEvery: 3 },
};

export function pickTier() {
  const cores = navigator.hardwareConcurrency || 4;
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return 'low';
  if (cores <= 4) return 'low';
  return 'mid';
}

/**
 * ถามการ์ดจอจริงว่าเป็นรุ่นไหน แล้วค่อยตัดสินใจ
 * จำนวนคอร์ CPU บอกอะไรเกี่ยวกับ GPU ไม่ได้เลย: โน้ตบุ๊ก 16 คอร์ที่ใช้กราฟิกออนบอร์ดของ Intel
 * จะได้ 'high' ทั้งที่วิ่งได้ 10 fps ซึ่งเคยเกิดขึ้นจริงตอนทดสอบ
 */
export function tierFromGPU(renderer, fallback) {
  let name = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  } catch (e) { /* บางเบราว์เซอร์ปิดข้อมูลนี้เพื่อความเป็นส่วนตัว */ }
  if (!name) return fallback;
  if (/SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(name)) return 'low';
  // กราฟิกออนบอร์ดรุ่นเก่า: fill rate ต่ำจริง
  if (/HD Graphics [0-9]{3,4}|UHD Graphics 6|Intel\(R\) HD/i.test(name)) return 'low';
  // ออนบอร์ดรุ่นใหม่ (Iris Xe, Radeon Graphics): ไหวระดับกลาง
  // ถ้าไม่ไหวจริง adapt() ด้านล่างจะลดให้เองจากค่า fps ที่วัดได้ ดีกว่าเดาตั้งแต่แรก
  if (/Intel|Iris|Vega \d|Radeon Graphics/i.test(name)) return 'mid';
  if (/Apple M\d/i.test(name)) return 'high';
  if (/RTX|GTX|Radeon RX|Arc A/i.test(name)) return 'high';
  return fallback;
}

// จานสีมีสองชุด ให้ฉาก 3D ตรงกับธีมของหน้าเว็บ
// ไม่งั้น HUD จะมืดแต่ตัวอาคารสว่าง ซึ่งดูเหมือนหน้าเสีย
const LIGHT = { bg: 0xeef1f5, ground: 0xdfe4eb, slab: 0xf2f5f8, slabEdge: 0xc8cfd8, wall: 0xd6dde6, accent: 0xe8563f, ink: 0x2b3440 };
const DARK  = { bg: 0x1a1f27, ground: 0x222932, slab: 0x2d3540, slabEdge: 0x3d4855, wall: 0x3a4450, accent: 0xff6b52, ink: 0xe7ecf3 };

export const PALETTE = { ...LIGHT };

export function isDark() {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced === 'dark') return true;
  if (forced === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** ต้องเรียกก่อนสร้าง Stage/Building เพราะวัสดุอ่านค่าตอนถูกสร้าง */
export function applyTheme() {
  Object.assign(PALETTE, isDark() ? DARK : LIGHT);
  return PALETTE;
}

export class Stage {
  constructor(canvas, tierName = pickTier()) {
    this.tierName = tierName;
    this.tier = TIERS[tierName];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // ใช้ pixelRatio แทน ถูกกว่ามากบนกราฟิกออนบอร์ด
      powerPreference: 'high-performance',
    });
    // ถาม GPU จริงแล้วปรับชั้นคุณภาพก่อนสร้างของอื่น
    const real = tierFromGPU(this.renderer, tierName);
    if (real !== tierName) {
      this.tierName = real;
      this.tier = TIERS[real];
    }
    this.renderer.setClearColor(PALETTE.bg, 1);
    this.renderer.shadowMap.enabled = this.tier.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft ถูกถอดออกใน three 0.186
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.bg);
    this.scene.fog = new THREE.Fog(PALETTE.bg, 170, 360);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 600);

    // ───── แสง: สตูดิโอสว่าง ดวงหลักหนึ่งดวงให้เงาอ่านทิศได้ ─────
    const dark = isDark();
    const hemi = new THREE.HemisphereLight(dark ? 0x9fb0c6 : 0xffffff, dark ? 0x2a323d : 0xb9c4d2, dark ? 0.85 : 1.05);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(dark ? 0xd8e4f5 : 0xfff6e8, dark ? 1.15 : 1.5);
    key.position.set(48, 86, 54);
    if (this.tier.shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(this.tier.shadow, this.tier.shadow);
      const d = 62;
      key.shadow.camera.left = -d;
      key.shadow.camera.right = d;
      key.shadow.camera.top = d;
      key.shadow.camera.bottom = -d;
      key.shadow.camera.near = 20;
      key.shadow.camera.far = 220;
      key.shadow.bias = -0.0012;
      key.shadow.normalBias = 0.035;
    }
    this.scene.add(key);
    this.key = key;

    const fill = new THREE.DirectionalLight(0xdce8ff, 0.42);
    fill.position.set(-52, 40, -30);
    this.scene.add(fill);

    // ───── พื้นดินรอบอาคาร ─────
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.96, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = this.tier.shadows;
    this.scene.add(ground);

    // ───── สถานะกล้อง (พิกัดทรงกลมรอบจุดมอง) ─────
    this.cam = { az: Math.PI * 0.20, pol: Math.PI * 0.33, dist: 86, target: new THREE.Vector3(0, 6, -3) };
    this.want = { ...this.cam, target: this.cam.target.clone() };
    this.fly = null;      // แอนิเมชันกล้องที่กำลังเล่น
    this.userHold = 0;    // เวลาตั้งแต่ผู้ใช้แตะล่าสุด (วินาที)

    this._bindControls(canvas);
    this.resize();
  }

  // ───────── ควบคุมกล้องเอง (ไม่ใช้ OrbitControls addon) ─────────
  _bindControls(el) {
    let drag = null;
    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, az: this.want.az, pol: this.want.pol };
      el.setPointerCapture?.(e.pointerId);
      this.touch();
    };
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      this.want.az = drag.az - dx * 0.0052;
      this.want.pol = Math.max(0.07, Math.min(Math.PI * 0.49, drag.pol - dy * 0.0042));
      this.fly = null;
      this.touch();
    };
    const onUp = (e) => {
      drag = null;
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.want.dist = Math.max(10, Math.min(240, this.want.dist * (1 + Math.sign(e.deltaY) * 0.09)));
      this.fly = null;
      this.touch();
    }, { passive: false });

    // สองนิ้วบนมือถือ = ซูม
    let pinch = 0;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.touch();
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinch) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.want.dist = Math.max(10, Math.min(240, this.want.dist * (pinch / Math.max(d, 1))));
        pinch = d;
        this.fly = null;
        this.touch();
      }
    }, { passive: true });
  }

  /** ผู้ใช้แตะอะไรก็ตาม — ใช้ตัดสินว่าจะหยุดทัวร์อัตโนมัติ */
  touch() {
    this.userHold = 0;
    this.touched = true;
  }

  /** บินกล้องไปตำแหน่งใหม่แบบนุ่ม ๆ */
  flyTo(camPos, targetPos, dur = 1.25) {
    const p = new THREE.Vector3(...camPos);
    const t = new THREE.Vector3(...targetPos);
    const off = p.clone().sub(t);
    const dist = off.length();
    const pol = Math.acos(Math.max(-1, Math.min(1, off.y / dist)));
    const az = Math.atan2(off.x, off.z);
    this.fly = {
      t: 0, dur,
      from: { az: this.cam.az, pol: this.cam.pol, dist: this.cam.dist, target: this.cam.target.clone() },
      to: { az: this._nearestAngle(this.cam.az, az), pol, dist, target: t },
    };
  }

  /** เลือกมุมที่หมุนไปทางใกล้ที่สุด ไม่ให้กล้องหมุนอ้อมโลก */
  _nearestAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return from + d;
  }

  update(dt) {
    this.userHold += dt;

    if (this.fly) {
      this.fly.t += dt;
      const u = Math.min(this.fly.t / this.fly.dur, 1);
      // easing เข้า: cubic-bezier(0.65, 0, 0.35, 1) โดยประมาณ
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const f = this.fly.from;
      const t = this.fly.to;
      this.cam.az = f.az + (t.az - f.az) * e;
      this.cam.pol = f.pol + (t.pol - f.pol) * e;
      this.cam.dist = f.dist + (t.dist - f.dist) * e;
      this.cam.target.lerpVectors(f.target, t.target, e);
      this.want.az = this.cam.az;
      this.want.pol = this.cam.pol;
      this.want.dist = this.cam.dist;
      this.want.target.copy(this.cam.target);
      if (u >= 1) this.fly = null;
    } else {
      // หน่วงให้ลากเมาส์แล้วลื่น
      const k = 1 - Math.exp(-dt * 11);
      this.cam.az += (this.want.az - this.cam.az) * k;
      this.cam.pol += (this.want.pol - this.cam.pol) * k;
      this.cam.dist += (this.want.dist - this.cam.dist) * k;
      this.cam.target.lerp(this.want.target, k);
    }

    const { az, pol, dist, target } = this.cam;
    this.camera.position.set(
      target.x + dist * Math.sin(pol) * Math.sin(az),
      target.y + dist * Math.cos(pol),
      target.z + dist * Math.sin(pol) * Math.cos(az),
    );
    this.camera.lookAt(target);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const el = this.renderer.domElement;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.pixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    // จอแนวตั้ง (มือถือ) ต้องถ่างมุมมองแนวตั้งออก เพื่อให้ "มุมมองแนวนอน" เท่าเดิม
    // ไม่งั้นอาคารจะถูกตัดข้างจนเห็นแค่มุมเดียว
    const BASE_FOV = 42;
    if (this.camera.aspect < 1) {
      const halfH = Math.tan((BASE_FOV * Math.PI) / 360) / this.camera.aspect;
      this.camera.fov = Math.min((2 * Math.atan(halfH) * 180) / Math.PI, 78);
    } else {
      this.camera.fov = BASE_FOV;
    }
    this.camera.updateProjectionMatrix();
  }

  /**
   * ลดความละเอียดการวาดลงเองถ้าเฟรมตก
   *
   * การเดาจากชื่อ GPU ผิดได้ทั้งสองทาง: เดาสูงไปหน้าจะกระตุก เดาต่ำไปก็เสียคุณภาพฟรี ๆ
   * วัดแล้วค่อยปรับแม่นกว่า ลดอย่างเดียวไม่เพิ่มกลับ เพื่อไม่ให้แกว่งไปมา
   */
  adapt(fps) {
    if (!fps || this._adaptLock) return;
    this._lowFrames = fps < 35 ? (this._lowFrames || 0) + 1 : 0;
    if (this._lowFrames < 3) return;
    const cur = this.renderer.getPixelRatio();
    const next = Math.max(cur - 0.25, 0.75);
    if (next < cur) {
      this.renderer.setPixelRatio(next);
      this.tier = { ...this.tier, hudEvery: Math.min(this.tier.hudEvery + 1, 4) };
      this._lowFrames = 0;
    } else {
      this._adaptLock = true; // ลดจนสุดแล้ว เลิกพยายาม
    }
  }

  /**
   * คอมไพล์ shader ทุกตัวก่อนเฟรมแรก
   * ถ้าไม่ทำ หน้าจะค้างแวบหนึ่งตอนวาดครั้งแรก (shader compile stall)
   */
  warm() {
    this.renderer.compile(this.scene, this.camera);
  }
}
