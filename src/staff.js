/**
 * staff.js — เจ้าหน้าที่ในแต่ละแผนก
 *
 * จำนวนเจ้าหน้าที่ "อ่านจากโมเดล" ไม่ใช่ตัวเลขตายตัวในฉาก
 * เลื่อนสไลเดอร์เพิ่มแพทย์ OPD จาก 8 เป็น 12 แล้วต้องเห็นคนเพิ่มในห้องจริง
 * ถ้าวาดตายตัวไว้ ภาพกับตัวเลขบน panel จะขัดกันทันทีที่ผู้ใช้ปรับอะไร
 */

import * as THREE from '../vendor/three.module.js';
import { ROOMS, FLOOR_Y } from './layout.js';
import { frameOf } from './props.js';

const MAX = 90;

// สีชุดตามวิชาชีพ
export const ROLE = {
  clerk:  0x7f9fc4, // เจ้าหน้าที่เวชระเบียน/การเงิน
  nurse:  0x5fa89f, // พยาบาล
  doctor: 0xf0f4f8, // แพทย์ (เสื้อกาวน์ขาว)
  pharm:  0xe4ecf3, // เภสัชกร
  tech:   0xa8b6c6, // นักเทคนิคการแพทย์ / รังสีเทคนิค
};

const SKIN = 0xc9a888;

/** คำอธิบายสีชุดสำหรับแสดงในหน้าเว็บ */
export const STAFF_LEGEND = [
  { label: 'แพทย์', hex: ROLE.doctor },
  { label: 'พยาบาล', hex: ROLE.nurse },
  { label: 'เวชระเบียน / การเงิน', hex: ROLE.clerk },
  { label: 'เภสัชกร', hex: ROLE.pharm },
  { label: 'นักเทคนิค', hex: ROLE.tech },
];

const ROLE_OF = {
  reg: 'clerk', cashier: 'clerk',
  triage: 'nurse', er: 'nurse', ipd: 'nurse',
  opd: 'doctor', or: 'doctor',
  pharm: 'pharm',
  lab: 'tech', xray: 'tech',
};

/**
 * ตำแหน่งยืนของเจ้าหน้าที่ในแต่ละแผนก
 * คืนอาร์เรย์ [x, y, z, หันหน้าไปทางไหน]
 */
function stationsFor(key, servers) {
  const r = ROOMS[key];
  if (!r) return [];
  const f = frameOf(r);
  const out = [];
  const n = Math.max(1, servers);

  const spread = (count, depth, span, faceOff = 0) => {
    const s = span ?? f.len - 1.2;
    for (let i = 0; i < count; i++) {
      const along = count === 1 ? 0 : -s / 2 + (s * i) / (count - 1);
      const [x, y, z] = f.at(along, depth);
      out.push([x, y, z, f.face + faceOff]);
    }
  };

  switch (key) {
    case 'reg':
    case 'cashier':
    case 'pharm':
    case 'triage':
      // ยืนหลังเคาน์เตอร์ หันหน้าเข้าหาคิว
      spread(n, 2.0);
      break;

    case 'lab':
      spread(Math.min(n, 4), 2.0);
      // ที่เหลือไปอยู่โซนเครื่องวิเคราะห์ด้านใน
      if (n > 4) spread(n - 4, 5.2, f.len - 3);
      break;

    case 'opd':
      // แพทย์นั่งอยู่ในคูหาของตัวเอง
      spread(n, 3.0, f.len - 1.0);
      break;

    case 'xray':
      spread(n, 2.1, f.len - 1.0);
      break;

    case 'er': {
      // พยาบาลประจำเตียงครึ่งหนึ่ง อีกครึ่งอยู่เคาน์เตอร์
      const atBed = Math.ceil(n / 2);
      spread(atBed, 3.1, f.len - 1.6);
      const atDesk = n - atBed;
      if (atDesk > 0) {
        for (let i = 0; i < atDesk; i++) {
          const along = -2.4 + i * 1.8;
          const [x, y, z] = f.at(along, 6.5);
          out.push([x, y, z, f.face + Math.PI]);
        }
      }
      break;
    }

    case 'or':
      // ทีมผ่าตัด: ศัลยแพทย์สองข้างเตียง + วิสัญญีแพทย์ที่หัวเตียง
      for (let i = 0; i < Math.min(n, r.rooms ?? 3); i++) {
        const cells = r.rooms ?? 3;
        const span = f.len - 1.6;
        const along = -span / 2 + (span * (i + 0.5)) / cells;
        for (const [da, dd, rot] of [[-0.75, 3.4, Math.PI / 2], [0.75, 3.4, -Math.PI / 2], [-1.0, 4.6, 0]]) {
          const [x, y, z] = f.at(along + da, dd);
          out.push([x, y, z, f.face + rot]);
        }
      }
      break;

    case 'ipd':
      // หอผู้ป่วย 120 เตียงไม่ได้มีพยาบาล 120 คน — ประจำเคาน์เตอร์ 4 คน
      for (let i = 0; i < 4; i++) {
        const [x, y, z] = f.at(-3.6 + i * 2.4, 2.9);
        out.push([x, y, z, f.face + Math.PI]);
      }
      break;

    default:
      spread(n, 2.0);
  }
  return out;
}

export class Staff {
  constructor(stage) {
    this.stage = stage;

    const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.72, 4, 8);
    bodyGeo.translate(0, 0.61, 0);
    this.body = new THREE.InstancedMesh(
      bodyGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.68, metalness: 0.02 }),
      MAX,
    );

    const headGeo = new THREE.SphereGeometry(0.15, 10, 8);
    headGeo.translate(0, 1.25, 0);
    this.head = new THREE.InstancedMesh(
      headGeo,
      new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 }),
      MAX,
    );

    for (const m of [this.body, this.head]) {
      m.castShadow = stage.tier.shadows;
      m.count = 0;
      m.frustumCulled = false;
      stage.scene.add(m);
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this._sig = '';
  }

  /**
   * สร้างใหม่เฉพาะตอนจำนวนเจ้าหน้าที่หรือชั้นที่แสดงเปลี่ยน
   * ไม่ต้องคำนวณใหม่ทุกเฟรม เพราะเจ้าหน้าที่ยืนอยู่กับที่
   */
  sync(sim, visibleFloor, lift) {
    const sig = Object.keys(ROLE_OF)
      .map((k) => sim.stations[k]?.servers ?? 0)
      .join(',') + `|${visibleFloor}|${lift}`;
    if (sig === this._sig) return;
    this._sig = sig;

    let n = 0;
    for (const [key, role] of Object.entries(ROLE_OF)) {
      const r = ROOMS[key];
      if (!r) continue;
      if (visibleFloor !== null && visibleFloor !== undefined && r.floor !== visibleFloor) continue;
      const lifted = r.floor === 1 ? lift : 0;
      const color = this._c.setHex(ROLE[role]);
      for (const [x, y, z, rot] of stationsFor(key, sim.stations[key].servers)) {
        if (n >= MAX) break;
        this._e.set(0, rot, 0);
        this._q.setFromEuler(this._e);
        this._p.set(x, y + lifted, z);
        this._m.compose(this._p, this._q, this._s);
        this.body.setMatrixAt(n, this._m);
        this.body.setColorAt(n, color);
        this.head.setMatrixAt(n, this._m);
        n++;
      }
    }
    this.body.count = n;
    this.head.count = n;
    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}
