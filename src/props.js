/**
 * props.js — เฟอร์นิเจอร์และเครื่องมือภายในห้อง
 *
 * วิธีทำให้ได้ของเยอะโดยไม่ทำให้เฟรมตก:
 * ทุกชิ้นประกอบจาก primitive เพียง 3 แบบ (กล่อง / ทรงกระบอก / ทรงกลม)
 * แล้วรวมเป็น InstancedMesh อย่างละตัว -> ของทั้งโรงพยาบาลใช้แค่ 3 draw call
 * ถ้าสร้างแยกเป็น Mesh ละชิ้นจะได้หลายร้อย draw call ซึ่งเป็นตัวฆ่าเฟรมตัวจริง
 */

import * as THREE from '../vendor/three.module.js';
import { ROOMS, FLOOR_Y } from './layout.js';

// ───────────────────────── จานสีของอุปกรณ์ ─────────────────────────
const C = {
  deskTop:   0xd9c9ae,  // ไม้ลามิเนต
  deskLeg:   0x9aa3ad,
  metal:     0xb6bec8,
  white:     0xeef2f6,
  screenOn:  0x5fd0e8,  // จอคอมพิวเตอร์ที่เปิดอยู่
  screenVit: 0x6ee89a,  // จอมอนิเตอร์สัญญาณชีพ
  dark:      0x3a434f,
  bedSheet:  0xdfe8f2,
  bedFrame:  0xa8b2bd,
  curtain:   0x9fc0cf,
  shelf:     0xc3b393,
  machine:   0xd4dae1,
  orTable:   0x7f98ab,
  orLight:   0xfdf6e3,
  cart:      0xd46a5c,  // รถฉุกเฉิน (crash cart) สีแดงตามจริง
  plant:     0x6f9e62,
};

/**
 * ตัวสะสมรูปทรง — เก็บ matrix กับสีไว้ก่อน แล้วค่อยสร้าง InstancedMesh ทีเดียวตอนจบ
 */
export class PropBuilder {
  constructor() {
    this.box = [];
    this.cyl = [];
    this.sph = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  _push(arr, x, y, z, sx, sy, sz, color, rotY = 0, rotX = 0) {
    this._e.set(rotX, rotY, 0);
    this._q.setFromEuler(this._e);
    this._p.set(x, y, z);
    this._s.set(sx, sy, sz);
    const m = new THREE.Matrix4().compose(this._p, this._q, this._s);
    arr.push({ m, color });
  }

  /** กล่อง — จุดอ้างอิงอยู่กึ่งกลางฐาน (วางบนพื้นได้ง่าย) */
  b(x, y, z, sx, sy, sz, color, rotY = 0) {
    this._push(this.box, x, y + sy / 2, z, sx, sy, sz, color, rotY);
    return this;
  }

  /** ทรงกระบอกตั้ง — จุดอ้างอิงอยู่กึ่งกลางฐาน */
  c(x, y, z, r, h, color) {
    this._push(this.cyl, x, y + h / 2, z, r * 2, h, r * 2, color);
    return this;
  }

  /** ทรงกระบอกนอน (ตามแกน X หมุนรอบ Y ได้) */
  cx(x, y, z, r, len, color, rotY = 0) {
    this._push(this.cyl, x, y, z, r * 2, len, r * 2, color, rotY, Math.PI / 2);
    return this;
  }

  /** ทรงกลม */
  s(x, y, z, r, color) {
    this._push(this.sph, x, y, z, r * 2, r * 2, r * 2, color);
    return this;
  }

  /** สร้าง InstancedMesh ทั้งสามตัวแล้วใส่เข้า group */
  build(group, castShadow) {
    const mk = (geo, list, name) => {
      if (!list.length) return null;
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.06 });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const col = new THREE.Color();
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i].m);
        mesh.setColorAt(i, col.setHex(list[i].color));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = castShadow;
      mesh.name = name;
      group.add(mesh);
      return mesh;
    };
    mk(new THREE.BoxGeometry(1, 1, 1), this.box, 'props-box');
    mk(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), this.cyl, 'props-cyl');
    mk(new THREE.SphereGeometry(0.5, 10, 7), this.sph, 'props-sph');
    return { boxes: this.box.length, cyls: this.cyl.length, sphs: this.sph.length };
  }
}

// ───────────────────────── ระบบพิกัดภายในห้อง ─────────────────────────
/**
 * คืนฟังก์ชันแปลงพิกัด "ในห้อง" เป็นพิกัดโลก
 *   along = ระยะตามแนวเคาน์เตอร์ (0 = กึ่งกลาง, บวก/ลบ = ซ้ายขวา)
 *   depth = ความลึกเข้าไปในห้อง (บวก = ลึกเข้าไป ห่างจากคิว)
 */
function frameOf(r) {
  const [[x1, z1], [x2, z2]] = r.counter;
  const mx = (x1 + x2) / 2;
  const mz = (z1 + z2) / 2;
  const len = Math.hypot(x2 - x1, z2 - z1) || 1;
  const tx = (x2 - x1) / len;
  const tz = (z2 - z1) / len;
  const fx = -r.qDir[0];
  const fz = -r.qDir[1];
  const y = FLOOR_Y[r.floor];

  // ที่ว่างหลังแนวจุดบริการ (โซนตรวจ/อุปกรณ์) — ห้องแต่ละห้องไม่เท่ากัน
  const [cx, cz] = r.pos;
  const [w, d] = r.size;
  const back = Math.abs(r.qDir[0]) > 0.5
    ? (r.qDir[0] > 0 ? mx - (cx - w / 2) : cx + w / 2 - mx)
    : (r.qDir[1] > 0 ? mz - (cz - d / 2) : cz + d / 2 - mz);
  const maxDepth = Math.max(back - 0.7, 1.0);

  return {
    len,
    y,
    back: maxDepth,
    // หันหน้าเข้าหาคิว (ใช้กับโต๊ะ จอ ฯลฯ)
    face: Math.atan2(r.qDir[0], r.qDir[1]),
    // หนีบความลึกไว้เสมอ กันของทะลุผนังด้านหลังเมื่อห้องตื้นกว่าที่เผื่อไว้
    at: (along, depth) => {
      const dd = Math.min(depth, maxDepth);
      const ha = Math.max((len - 0.6) / 2, 0.2);
      const aa = Math.max(-ha, Math.min(ha, along));
      return [mx + tx * aa + fx * dd, y, mz + tz * aa + fz * dd];
    },
  };
}

// ───────────────────────── ชิ้นส่วนที่ใช้ซ้ำ ─────────────────────────

/** โต๊ะทำงานพร้อมคอมพิวเตอร์: จอ คีย์บอร์ด เคส */
function workstation(B, x, y, z, rotY, withTower = true) {
  // โต๊ะ
  B.b(x, y, z, 1.5, 0.06, 0.72, C.deskTop, rotY);
  B.b(x, y, z + 0, 0.06, 0.72, 0.06, C.deskLeg, rotY);
  const dx = Math.cos(rotY) * 0.66;
  const dz = -Math.sin(rotY) * 0.66;
  B.b(x + dx, y, z + dz, 0.07, 0.72, 0.66, C.deskLeg, rotY);
  B.b(x - dx, y, z - dz, 0.07, 0.72, 0.66, C.deskLeg, rotY);
  B.b(x, y + 0.72, z, 1.5, 0.05, 0.72, C.deskTop, rotY);

  // จอคอม — เอียงหน้าจอเข้าหาคนใช้เล็กน้อย
  const bx = Math.sin(rotY) * 0.16;
  const bz = Math.cos(rotY) * 0.16;
  B.b(x - bx, y + 0.77, z - bz, 0.1, 0.16, 0.1, C.dark, rotY);
  B.b(x - bx, y + 0.93, z - bz, 0.52, 0.33, 0.04, C.dark, rotY);
  B.b(x - bx + Math.sin(rotY) * 0.03, y + 0.95, z - bz + Math.cos(rotY) * 0.03,
      0.47, 0.27, 0.015, C.screenOn, rotY);

  // คีย์บอร์ด
  B.b(x + bx * 0.9, y + 0.77, z + bz * 0.9, 0.42, 0.02, 0.15, C.white, rotY);

  if (withTower) B.b(x + Math.cos(rotY) * 0.6, y, z - Math.sin(rotY) * 0.6, 0.18, 0.42, 0.42, C.dark, rotY);
}

/** เก้าอี้ทำงาน */
function officeChair(B, x, y, z, rotY) {
  B.c(x, y, z, 0.05, 0.42, C.metal);
  B.b(x, y + 0.42, z, 0.46, 0.07, 0.44, C.dark, rotY);
  B.b(x + Math.sin(rotY) * 0.2, y + 0.49, z + Math.cos(rotY) * 0.2, 0.44, 0.44, 0.06, C.dark, rotY);
  for (const a of [0, 1.25, 2.5, 3.77, 5.02]) {
    B.b(x + Math.cos(a) * 0.17, y + 0.02, z + Math.sin(a) * 0.17, 0.22, 0.04, 0.05, C.metal, -a);
  }
}

/** เตียงตรวจ / เตียงผู้ป่วย */
function bed(B, x, y, z, rotY, withRails = false) {
  B.b(x, y, z, 0.92, 0.46, 2.0, C.bedFrame, rotY);
  B.b(x, y + 0.46, z, 0.96, 0.14, 2.02, C.bedSheet, rotY);
  // หมอน
  B.b(x - Math.sin(rotY) * 0.72, y + 0.6, z - Math.cos(rotY) * 0.72, 0.5, 0.1, 0.3, C.white, rotY);
  if (withRails) {
    const rx = Math.cos(rotY) * 0.5;
    const rz = -Math.sin(rotY) * 0.5;
    B.b(x + rx, y + 0.6, z + rz, 0.05, 0.3, 1.1, C.metal, rotY);
    B.b(x - rx, y + 0.6, z - rz, 0.05, 0.3, 1.1, C.metal, rotY);
  }
}

/** เสาน้ำเกลือ */
function ivPole(B, x, y, z) {
  B.c(x, y, z, 0.03, 1.75, C.metal);
  B.c(x, y, z, 0.16, 0.03, C.metal);
  B.b(x + 0.1, y + 1.5, z, 0.12, 0.26, 0.09, 0xeaf3ff);
}

/** จอมอนิเตอร์สัญญาณชีพบนเสา */
function vitalMonitor(B, x, y, z, rotY) {
  B.c(x, y, z, 0.035, 1.35, C.metal);
  B.b(x, y + 1.35, z, 0.36, 0.3, 0.12, C.dark, rotY);
  B.b(x + Math.sin(rotY) * 0.065, y + 1.4, z + Math.cos(rotY) * 0.065, 0.3, 0.22, 0.02, C.screenVit, rotY);
}

/** ชั้นวางของ (ยา / แฟ้ม) */
function shelving(B, x, y, z, w, rotY, color = C.shelf) {
  B.b(x, y, z, w, 2.05, 0.42, color, rotY);
  for (let i = 1; i <= 4; i++) {
    B.b(x + Math.sin(rotY) * 0.22, y + i * 0.4, z + Math.cos(rotY) * 0.22, w - 0.1, 0.03, 0.04, 0xf4f0e6, rotY);
  }
}

/** เครื่องมือตั้งพื้นแบบมีจอ (เครื่องวิเคราะห์แล็บ / เครื่องดมยา) */
function machine(B, x, y, z, w, h, d, rotY, screen = true) {
  B.b(x, y, z, w, h, d, C.machine, rotY);
  if (screen) {
    B.b(x + Math.sin(rotY) * (d / 2 + 0.01), y + h * 0.72, z + Math.cos(rotY) * (d / 2 + 0.01),
        w * 0.44, h * 0.2, 0.02, C.screenOn, rotY);
  }
  // ล้อ
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.c(x + sx * w * 0.38 * Math.cos(rotY), y, z + sz * d * 0.34, 0.05, 0.08, C.dark);
  }
}

// ───────────────────────── จัดของแต่ละห้อง ─────────────────────────

function furnishCounter(B, r, servers, opts = {}) {
  const f = frameOf(r);
  const n = Math.max(servers, 1);
  const span = f.len - 1.2;
  for (let i = 0; i < n; i++) {
    const along = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
    const [x, y, z] = f.at(along, 1.15);
    workstation(B, x, y, z, f.face, i % 2 === 0);
    const [cx, , cz] = f.at(along, 1.95);
    officeChair(B, cx, y, cz, f.face);
  }
  // ชั้นเก็บของด้านหลัง
  if (opts.shelves) {
    const rows = Math.max(2, Math.round(f.len / 4));
    for (let i = 0; i < rows; i++) {
      const along = -f.len / 2 + 1.4 + (i * (f.len - 2.8)) / Math.max(rows - 1, 1);
      const [x, y, z] = f.at(along, f.back - 0.4);
      shelving(B, x, y, z, 3.0, f.face + Math.PI, opts.shelfColor ?? C.shelf);
    }
  }
}

const FURNISH = {
  reg: (B, r, n) => furnishCounter(B, r, n, { shelves: true }),

  cashier: (B, r, n) => {
    furnishCounter(B, r, n, { shelves: true });
    const f = frameOf(r);
    // เครื่องรูดบัตรบนเคาน์เตอร์
    for (let i = 0; i < n; i++) {
      const along = n === 1 ? 0 : -(f.len - 1.2) / 2 + ((f.len - 1.2) * i) / Math.max(n - 1, 1);
      const [x, y, z] = f.at(along + 0.55, 1.0);
      B.b(x, y + 0.77, z, 0.1, 0.05, 0.16, C.dark, f.face);
    }
  },

  pharm: (B, r, n) => {
    furnishCounter(B, r, n, { shelves: true, shelfColor: 0xc9b98f });
    const f = frameOf(r);
    // ชั้นยาแถวลึกอีกสองแถว — ห้องยาคือห้องที่ของเยอะที่สุดในโรงพยาบาล
    for (const depth of [f.back - 1.9, f.back - 0.4]) {
      const rows = 3;
      for (let i = 0; i < rows; i++) {
        const along = -f.len / 2 + 1.6 + (i * (f.len - 3.2)) / (rows - 1);
        const [x, y, z] = f.at(along, depth);
        shelving(B, x, y, z, 3.4, f.face + Math.PI, 0xc9b98f);
      }
    }
  },

  triage: (B, r, n) => {
    const f = frameOf(r);
    const span = f.len - 1.2;
    for (let i = 0; i < n; i++) {
      const along = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
      const [x, y, z] = f.at(along, 1.15);
      workstation(B, x, y, z, f.face, false);
      const [cx, , cz] = f.at(along, 1.95);
      officeChair(B, cx, y, cz, f.face);
      // เครื่องวัดความดันบนโต๊ะ
      B.b(x + Math.cos(f.face) * 0.52, y + 0.77, z - Math.sin(f.face) * 0.52, 0.2, 0.16, 0.18, C.white, f.face);
    }
    // เครื่องชั่งน้ำหนัก + ที่วัดส่วนสูง
    const [sx, sy, sz] = f.at(-f.len / 2 + 0.9, 3.2);
    B.b(sx, sy, sz, 0.5, 0.08, 0.42, C.dark);
    B.c(sx, sy, sz - 0.25, 0.03, 2.0, C.metal);
  },

  opd: (B, r, n) => {
    const f = frameOf(r);
    // 8 คูหาตรวจ: โต๊ะ+คอม, เก้าอี้หมอ, เก้าอี้คนไข้, เตียงตรวจ, ม่าน
    const cells = r.rooms ?? n;
    const span = f.len - 1.0;
    for (let i = 0; i < cells; i++) {
      const along = -span / 2 + (span * (i + 0.5)) / cells;
      const [x, y, z] = f.at(along, 2.2);
      workstation(B, x, y, z, f.face, false);
      const [dx, , dz] = f.at(along, 3.0);
      officeChair(B, dx, y, dz, f.face);
      // เก้าอี้ผู้ป่วยฝั่งตรงข้ามโต๊ะ
      const [px, , pz] = f.at(along - 0.55, 1.35);
      officeChair(B, px, y, pz, f.face + Math.PI);
      // เตียงตรวจชิดผนังด้านใน
      const [bx, , bz] = f.at(along + 0.5, 4.6);
      bed(B, bx, y, bz, f.face + Math.PI / 2);
      // ม่านกั้น
      const [mx2, , mz2] = f.at(along + span / cells / 2, 4.2);
      B.b(mx2, y + 0.4, mz2, 0.06, 1.9, 2.4, C.curtain, f.face);
    }
  },

  lab: (B, r, n) => {
    const f = frameOf(r);
    const span = f.len - 1.0;
    // จุดรับสิ่งส่งตรวจ
    for (let i = 0; i < n; i++) {
      const along = -span / 2 + (span * (i + 0.5)) / n;
      const [x, y, z] = f.at(along, 1.1);
      workstation(B, x, y, z, f.face, false);
      const [cx, , cz] = f.at(along, 1.9);
      officeChair(B, cx, y, cz, f.face);
    }
    // เครื่องวิเคราะห์อัตโนมัติแถวใน
    for (let i = 0; i < 3; i++) {
      const along = -span / 2 + (span * (i + 0.5)) / 3;
      const [x, y, z] = f.at(along, 4.3);
      machine(B, x, y, z, 1.5, 1.3, 0.75, f.face);
    }
    // เครื่องปั่นเหวี่ยง + กล้องจุลทรรศน์บนเคาน์เตอร์ยาว
    const [bx, by, bz] = f.at(0, f.back - 0.5);
    B.b(bx, by, bz, span, 0.85, 0.65, C.white, f.face);
    for (let i = 0; i < 4; i++) {
      const along = -span / 2 + (span * (i + 0.5)) / 4;
      const [x, y, z] = f.at(along, f.back - 0.5);
      if (i % 2 === 0) {
        B.c(x, y + 0.85, z, 0.22, 0.3, C.machine);   // เครื่องปั่นเหวี่ยง
      } else {
        B.b(x, y + 0.85, z, 0.16, 0.2, 0.2, C.dark); // ฐานกล้องจุลทรรศน์
        B.c(x, y + 1.05, z, 0.035, 0.26, C.dark);
      }
    }
  },

  xray: (B, r, n) => {
    const f = frameOf(r);
    const cells = r.rooms ?? n;
    const span = f.len - 1.0;
    for (let i = 0; i < cells; i++) {
      const along = -span / 2 + (span * (i + 0.5)) / cells;
      // เตียงเอกซเรย์
      const [tx, ty, tz] = f.at(along, 4.0);
      B.b(tx, ty, tz, 0.75, 0.72, 2.1, C.orTable, f.face);
      B.b(tx, ty + 0.72, tz, 0.8, 0.1, 2.15, C.white, f.face);
      // เสาและแขนหลอดเอกซเรย์เหนือเตียง
      const [gx, gy, gz] = f.at(along + 0.75, 5.3);
      B.c(gx, gy, gz, 0.07, 2.3, C.metal);
      B.b(gx, gy + 2.0, gz, 0.1, 0.1, 1.5, C.metal, f.face);
      B.b(tx, ty + 1.95, tz + 0.2, 0.34, 0.3, 0.34, C.machine, f.face);
      // ห้องควบคุมพร้อมคอมและกระจกตะกั่ว
      const [cx, cy, cz] = f.at(along, 1.3);
      workstation(B, cx, cy, cz, f.face, true);
      B.b(cx, cy + 1.3, cz, 1.3, 0.9, 0.05, 0x9fb8c6, f.face);
    }
  },

  er: (B, r, n) => {
    const f = frameOf(r);
    const span = f.len - 1.2;
    for (let i = 0; i < n; i++) {
      const along = n === 1 ? 0 : -span / 2 + (span * i) / Math.max(n - 1, 1);
      const [x, y, z] = f.at(along, 1.9);
      bed(B, x, y, z, f.face + Math.PI / 2, true);
      const [mx2, , mz2] = f.at(along - 0.75, 2.9);
      vitalMonitor(B, mx2, y, mz2, f.face);
      const [ix, , iz] = f.at(along + 0.75, 2.9);
      ivPole(B, ix, y, iz);
      // ม่านกั้นระหว่างเตียง
      if (i < n - 1) {
        const [cx2, , cz2] = f.at(along + span / Math.max(n - 1, 1) / 2, 2.4);
        B.b(cx2, y + 0.3, cz2, 2.6, 2.0, 0.06, C.curtain, f.face + Math.PI / 2);
      }
    }
    // เคาน์เตอร์พยาบาล + รถฉุกเฉิน
    const [sx, sy, sz] = f.at(0, f.back - 0.9);
    B.b(sx, sy, sz, span * 0.7, 1.05, 0.7, C.deskTop, f.face);
    for (let i = 0; i < 2; i++) {
      const [wx, , wz] = f.at(-2 + i * 4, f.back - 0.2);
      workstation(B, wx, sy, wz, f.face + Math.PI, false);
    }
    const [kx, ky, kz] = f.at(span / 2 - 0.6, f.back - 1.1);
    B.b(kx, ky, kz, 0.6, 0.95, 0.5, C.cart, f.face);
    B.b(kx, ky + 0.95, kz, 0.5, 0.18, 0.4, C.dark, f.face);
  },

  or: (B, r, n) => {
    const f = frameOf(r);
    const cells = r.rooms ?? n;
    const span = f.len - 1.6;
    for (let i = 0; i < cells; i++) {
      const along = -span / 2 + (span * (i + 0.5)) / cells;
      // เตียงผ่าตัด
      const [tx, ty, tz] = f.at(along, 3.4);
      B.c(tx, ty, tz, 0.26, 0.78, C.metal);
      B.b(tx, ty + 0.78, tz, 0.68, 0.16, 2.0, C.orTable, f.face);
      // โคมไฟผ่าตัด 2 ดวงบนแขนเพดาน
      B.c(tx, ty + 2.55, tz, 0.06, 0.85, C.metal);
      for (const off of [-0.55, 0.55]) {
        B.b(tx, ty + 2.5, tz + off * 0.6, 0.08, 0.08, 0.7, C.metal, f.face);
        B.s(tx + off * 0.5, ty + 2.42, tz + off * 0.35, 0.3, C.orLight);
      }
      // เครื่องดมยาสลบ + จอสัญญาณชีพ + โต๊ะเครื่องมือ
      const [ax, ay, az] = f.at(along - 1.1, 4.9);
      machine(B, ax, ay, az, 0.7, 1.45, 0.6, f.face);
      const [vx, , vz] = f.at(along + 1.1, 4.9);
      vitalMonitor(B, vx, ay, vz, f.face);
      const [ix, , iz] = f.at(along + 1.2, 2.5);
      B.b(ix, ay, iz, 0.5, 0.88, 0.85, C.metal, f.face);
      B.b(ix, ay + 0.88, iz, 0.54, 0.05, 0.9, C.white, f.face);
    }
  },

  ipd: (B, r) => {
    const f = frameOf(r);
    // เคาน์เตอร์พยาบาลหน้าหอผู้ป่วย
    const [sx, sy, sz] = f.at(0, 1.2);
    B.b(sx, sy, sz, 7.5, 1.05, 0.75, C.deskTop, f.face);
    for (let i = 0; i < 3; i++) {
      const [wx, , wz] = f.at(-2.4 + i * 2.4, 2.1);
      workstation(B, wx, sy, wz, f.face + Math.PI, false);
      const [cx, , cz] = f.at(-2.4 + i * 2.4, 2.9);
      officeChair(B, cx, sy, cz, f.face + Math.PI);
    }
    // ตู้ข้างเตียงและเสาน้ำเกลือ — ใส่เฉพาะ 1 ใน 3 ของเตียง ไม่งั้นรกและเปลือง
    const beds = r.beds ?? 0;
    const perRow = 24;
    for (let i = 0; i < beds; i += 3) {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const bx = -31 + col * 1.35;
      const bz = -1 - row * 3.2;
      B.b(bx + 0.78, f.y, bz - 0.5, 0.42, 0.62, 0.42, C.white);
      if (i % 9 === 0) ivPole(B, bx + 0.78, f.y, bz + 0.55);
    }
  },
};

/**
 * จัดของทั้งอาคาร
 * @param {THREE.Group} group  กลุ่มที่จะใส่ของเข้าไป (แยกตามชั้น)
 * @param {object} serversByKey จำนวนจุดบริการของแต่ละแผนก
 */
export function furnish(groupsByFloor, serversByKey, castShadow) {
  const byFloor = new Map();
  for (const [key, r] of Object.entries(ROOMS)) {
    const fn = FURNISH[key];
    if (!fn) continue;
    if (!byFloor.has(r.floor)) byFloor.set(r.floor, new PropBuilder());
    fn(byFloor.get(r.floor), r, serversByKey[key] ?? 1);
  }
  const stats = { boxes: 0, cyls: 0, sphs: 0 };
  for (const [floor, B] of byFloor) {
    const s = B.build(groupsByFloor[floor], castShadow);
    stats.boxes += s.boxes;
    stats.cyls += s.cyls;
    stats.sphs += s.sphs;
  }
  return stats;
}

export { frameOf, C as PROP_COLORS };
