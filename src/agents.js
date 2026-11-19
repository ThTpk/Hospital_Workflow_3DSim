/**
 * agents.js — ตัวผู้ป่วยใน 3D
 *
 * ตำแหน่งทุกตัวคำนวณจากสถานะใน sim.js + พิกัดใน layout.js เท่านั้น
 * ไฟล์นี้ไม่ตัดสินใจอะไรเกี่ยวกับคิวเลย มันแค่ "วาดสิ่งที่โมเดลบอก"
 */

import * as THREE from '../vendor/three.module.js';
import { ST } from './sim.js';
import { walkPath, pointAt, servicePos, queuePos, resultPos, queueSeated, ROOMS, FLOOR_Y } from './layout.js';

const MAX = 700;

// ท่าทาง — ผสมกันแบบไล่ระดับ ไม่ใช่สลับทันที ไม่งั้นคนจะกระตุกตอนเปลี่ยนสถานะ
const POSE = { STAND: 0, SIT: 1, LIE: 2 };

// แคปซูลสูง 1.26 ม. ฐานอยู่ที่พื้น ค่าด้านล่างคือรูปร่างของแต่ละท่า
const BODY_SCALE = [1.0, 0.52, 1.0];   // ยืน / นั่ง / นอน
const BODY_LIFT = [0.0, 0.44, 0.42];   // ยกฐานขึ้นเท่าไร (นั่ง = ความสูงเก้าอี้)
const HEAD_Y = [1.30, 1.20, 0.62];     // ความสูงของหัว
const HEAD_FWD = [0, 0, 0.58];         // นอนแล้วหัวเลื่อนไปทางปลายเตียง // เพดานจำนวนตัวที่วาดพร้อมกัน (พีคจริงที่วัดได้ ~270 รวมผู้ป่วยใน)

// สีตามสถานะ — คนละความหมาย ไม่ใช่แค่ความสวย
// ค่าสีอยู่ที่นี่ที่เดียว คำอธิบายสีในหน้าเว็บอ่านจากตรงนี้
// ถ้าพิมพ์ซ้ำไว้สองที่ วันหนึ่งแก้สีแล้วคำอธิบายจะโกหกโดยไม่มีใครรู้
export const PATIENT_HEX = {
  walk: 0x4a7fb5,      // กำลังเดิน
  queue: 0xe0a53f,     // ต่อคิว
  queueHot: 0xd4452f,  // ต่อคิวมานาน
  service: 0x3f9e67,   // กำลังรับบริการ
  result: 0x8e7cc3,    // รอผลตรวจ
  bed: 0x6f9fd0,       // นอนรักษา
};

/** ลำดับและคำอธิบายที่ใช้แสดงในหน้าเว็บ */
export const PATIENT_LEGEND = [
  { label: 'เดินระหว่างแผนก', hex: PATIENT_HEX.walk },
  { label: 'ต่อคิว', hex: PATIENT_HEX.queue, to: PATIENT_HEX.queueHot, note: 'ยิ่งแดงยิ่งรอนาน' },
  { label: 'กำลังรับบริการ', hex: PATIENT_HEX.service },
  { label: 'รอผลตรวจ', hex: PATIENT_HEX.result },
  { label: 'นอนรักษา', hex: PATIENT_HEX.bed },
];

const C = {
  walk: new THREE.Color(PATIENT_HEX.walk),
  queue: new THREE.Color(PATIENT_HEX.queue),
  queueHot: new THREE.Color(PATIENT_HEX.queueHot),
  service: new THREE.Color(PATIENT_HEX.service),
  result: new THREE.Color(PATIENT_HEX.result),
  bed: new THREE.Color(PATIENT_HEX.bed),
};

export class Agents {
  constructor(stage) {
    this.stage = stage;

    // ตัวคนแบบง่าย: แคปซูลหนึ่งชิ้น — อ่านออกตั้งแต่ระยะไกล และถูกมากตอน instanced
    const geo = new THREE.CapsuleGeometry(0.26, 0.74, 4, 8);
    geo.translate(0, 0.63, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.02 });

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = stage.tier.shadows;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    stage.scene.add(this.mesh);

    // หัว — เดิมผู้ป่วยเป็นแคปซูลล้วนขณะที่เจ้าหน้าที่มีหัว ดูแล้วไม่เข้าชุดกัน
    // ทรงกลมอยู่ที่จุดกำเนิด แล้วค่อยกำหนดความสูงตามท่าทาง (ยืน/นั่ง/นอน)
    const headGeo = new THREE.SphereGeometry(0.155, 10, 8);
    this.head = new THREE.InstancedMesh(
      headGeo,
      new THREE.MeshStandardMaterial({ color: 0xc9a888, roughness: 0.78 }),
      MAX,
    );
    this.head.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.head.castShadow = false;
    this.head.count = 0;
    this.head.frustumCulled = false;
    stage.scene.add(this.head);

    // วงแหวนใต้เท้าคนที่กำลังถูกติดตาม
    const ringGeo = new THREE.RingGeometry(0.5, 0.74, 24);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xe8563f, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.ring.renderOrder = 15;
    this.ring.visible = false;
    stage.scene.add(this.ring);

    // เส้นทางที่ผู้ป่วยคนที่ติดตามเดินผ่านมา
    this.route = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xe8563f, transparent: true, opacity: 0.8, depthTest: false }),
    );
    this.route.renderOrder = 14;
    this.route.visible = false;
    this.route.frustumCulled = false;
    stage.scene.add(this.route);
    this._routeSig = '';

    this.smooth = new Map();  // id -> ตำแหน่งที่วาดอยู่ (เพื่อให้ขยับลื่น ไม่กระตุก)
    this.index = [];          // instanceId -> patient (ใช้ตอนคลิกเลือก)
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._qi = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
  }

  /** ตำแหน่งเป้าหมายของผู้ป่วยหนึ่งคน ตามสถานะในโมเดล */
  targetOf(p, sim) {
    if (p.state === ST.WALK) {
      const pts = walkPath(p.from, p.to);
      const u = p.walkDur > 0 ? Math.min(p.walkT / p.walkDur, 1) : 1;
      const [x, y, z, rot] = pointAt(pts, u);
      return [x, y, z, rot, POSE.STAND];
    }
    if (p.state === ST.QUEUE) {
      const idx = Math.max(p.queueIdx, 0);
      const [x, y, z] = queuePos(p.at, idx);
      const r = ROOMS[p.at];
      // แถวหน้ายืนรอเรียก แถวหลังมีเก้าอี้ให้นั่ง คนล้นโถงยืนเบียด
      const pose = queueSeated(p.at, idx) ? POSE.SIT : POSE.STAND;
      return [x, y, z, Math.atan2(-r.qDir[0], -r.qDir[1]), pose];
    }
    if (p.state === ST.SERVICE) {
      const s = sim.stations[p.at];
      const [x, y, z] = servicePos(p.at, Math.max(p.slot, 0), s.servers);
      const r = ROOMS[p.at];
      // ในหอผู้ป่วยและห้องผ่าตัด คนไข้นอน ไม่ยืน
      const pose = (p.at === 'ipd' || p.at === 'or' || p.at === 'er' || p.at === 'xray')
        ? POSE.LIE   // หอผู้ป่วย ห้องผ่าตัด ER และเอกซเรย์ คนไข้นอน
        : POSE.STAND;
      return [x, y, z, Math.atan2(-r.qDir[0], -r.qDir[1]), pose];
    }
    if (p.state === ST.RESULT) {
      const idx = sim.stations[p.at].waitingResult.indexOf(p);
      const [x, y, z] = resultPos(p.at, Math.max(idx, 0));
      const r = ROOMS[p.at];
      return [x, y, z, Math.atan2(-r.qDir[0], -r.qDir[1]), POSE.SIT];
    }
    return [0, -99, 0, 0, POSE.STAND];
  }

  colorOf(p, sim) {
    if (p.state === ST.WALK) return C.walk;
    if (p.state === ST.SERVICE) return (p.at === 'ipd' || p.at === 'or') ? C.bed : C.service;
    if (p.state === ST.RESULT) return C.result;
    if (p.state === ST.QUEUE) {
      // ยิ่งรอนาน สียิ่งร้อน — 0 นาที = เหลือง, 45 นาทีขึ้นไป = แดง
      const waited = sim.t - p.tEnterQueue;
      const f = Math.min(waited / 45, 1);
      return this._c.copy(C.queue).lerp(C.queueHot, f);
    }
    return C.walk;
  }

  /** อัปเดตทุกตัวให้ตรงกับสถานะปัจจุบันของโมเดล */
  sync(sim, dt, followId, visibleFloor, lift = 0) {
    const mesh = this.mesh;
    this.index.length = 0;
    let n = 0;
    const alive = new Set();

    for (const p of sim.patients) {
      if (n >= MAX) break;
      const [tx, tyRaw, tz, rot, pose] = this.targetOf(p, sim);
      if (tyRaw < -50) continue;

      // ซ่อนคนที่อยู่ชั้นที่ไม่ได้เลือก
      if (visibleFloor !== null && visibleFloor !== undefined) {
        const floor = tyRaw > 2 ? 1 : 0;
        if (floor !== visibleFloor) continue;
      }
      // ตอนดู 'ทั้งอาคาร' ชั้น 2 ถูกยกลอยขึ้น คนไข้ต้องยกตามด้วย
      // คูณตามสัดส่วนความสูง เพื่อให้คนที่กำลังเดินขึ้นบันไดลอยขึ้นอย่างต่อเนื่อง ไม่กระโดด
      const ty = tyRaw + lift * Math.min(Math.max(tyRaw / 4.6, 0), 1);

      alive.add(p.id);
      let s = this.smooth.get(p.id);
      if (!s) {
        s = { x: tx, y: ty, z: tz, rot, sit: pose === POSE.SIT ? 1 : 0, lie: pose === POSE.LIE ? 1 : 0 };
        this.smooth.set(p.id, s);
      }
      // หน่วงตำแหน่ง: ตอนคิวขยับ คนจะเดินเข้าที่ ไม่ใช่กระโดดวาร์ป
      const k = 1 - Math.exp(-dt * 7.5);
      // ถ้าเพิ่งเปลี่ยนเส้นทางแล้วระยะไกลมาก ให้วาร์ปเลย ดีกว่าเห็นคนลอยข้ามอาคาร
      const far = Math.hypot(tx - s.x, tz - s.z) > 26 || Math.abs(ty - s.y) > 1;
      if (far) {
        s.x = tx; s.y = ty; s.z = tz; s.rot = rot;
      } else {
        s.x += (tx - s.x) * k;
        s.y += (ty - s.y) * k;
        s.z += (tz - s.z) * k;
        let dr = ((rot - s.rot + Math.PI) % (Math.PI * 2)) - Math.PI;
        s.rot += dr * k;
      }
      // ไล่ระดับระหว่างท่าทาง ไม่สลับทันที
      const kp = 1 - Math.exp(-dt * 6);
      s.sit += ((pose === POSE.SIT ? 1 : 0) - s.sit) * kp;
      s.lie += ((pose === POSE.LIE ? 1 : 0) - s.lie) * kp;
      const stand = Math.max(0, 1 - s.sit - s.lie);

      const scaleY = stand * BODY_SCALE[0] + s.sit * BODY_SCALE[1] + s.lie * BODY_SCALE[2];
      const poseLift = stand * BODY_LIFT[0] + s.sit * BODY_LIFT[1] + s.lie * BODY_LIFT[2];
      const headY = stand * HEAD_Y[0] + s.sit * HEAD_Y[1] + s.lie * HEAD_Y[2];
      const headFwd = s.lie * HEAD_FWD[2];

      // นอน = เอียง 90 องศารอบแกน X
      this._e.set(-s.lie * Math.PI * 0.5, s.rot, 0);
      this._q.setFromEuler(this._e);
      this._v.set(s.x, s.y + poseLift, s.z);
      this._s.set(1, scaleY, 1);
      this._m.compose(this._v, this._q, this._s);
      mesh.setMatrixAt(n, this._m);
      mesh.setColorAt(n, this.colorOf(p, sim));

      // หัวไม่ถูกย่อตามลำตัว ไม่งั้นคนนั่งจะหัวแบน
      this._v.set(
        s.x + Math.sin(s.rot) * headFwd,
        s.y + headY,
        s.z + Math.cos(s.rot) * headFwd,
      );
      this._s.set(1, 1, 1);
      this._m.compose(this._v, this._qi, this._s);
      this.head.setMatrixAt(n, this._m);

      this.index[n] = p;
      n++;
    }

    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.head.count = n;
    this.head.instanceMatrix.needsUpdate = true;

    // เก็บกวาดคนที่ออกจากระบบไปแล้ว ไม่ให้ Map โตไม่หยุด
    if (this.smooth.size > alive.size + 200) {
      for (const id of this.smooth.keys()) if (!alive.has(id)) this.smooth.delete(id);
    }

    // วงแหวนคนที่กำลังติดตาม
    if (followId != null) {
      const s = this.smooth.get(followId);
      if (s) {
        this.ring.position.set(s.x, s.y + 0.03, s.z);
        this.ring.visible = true;
      } else {
        this.ring.visible = false;
      }
    } else {
      this.ring.visible = false;
    }
  }

  /**
   * วาดเส้นทางที่ผู้ป่วยคนนี้เดินมาแล้ว รวมถึงช่วงที่กำลังเดินอยู่
   * สร้างใหม่เฉพาะตอนเส้นทางเปลี่ยน ไม่ใช่ทุกเฟรม
   */
  syncRoute(p, lift) {
    if (!p) {
      this.route.visible = false;
      this._routeSig = '';
      return;
    }
    const gate = p.lane === 'er' ? 'gate_er' : 'gate_opd';
    const stops = [gate, ...p.path.map((st) => st.key)];
    if (p.to && p.to !== 'exit' && stops[stops.length - 1] !== p.to) stops.push(p.to);

    const sig = `${p.id}|${stops.join('>')}|${lift}`;
    if (sig === this._routeSig) return;
    this._routeSig = sig;

    const pts = [];
    for (let i = 1; i < stops.length; i++) {
      for (const [x, y, z] of walkPath(stops[i - 1], stops[i])) {
        const yy = y + lift * Math.min(Math.max(y / FLOOR_Y[1], 0), 1) + 0.12;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(x - last.x, z - last.z, yy - last.y) > 0.3) {
          pts.push(new THREE.Vector3(x, yy, z));
        }
      }
    }
    if (pts.length < 2) {
      this.route.visible = false;
      return;
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.15);
    this.route.geometry.dispose();
    this.route.geometry = new THREE.TubeGeometry(curve, Math.min(pts.length * 6, 160), 0.16, 6, false);
    this.route.visible = true;
  }

  /** คลิกเลือกผู้ป่วย -> คืน object ผู้ป่วย หรือ null */
  pick(raycaster) {
    const hits = raycaster.intersectObject(this.mesh, false);
    if (!hits.length) return null;
    const id = hits[0].instanceId;
    return id != null ? this.index[id] ?? null : null;
  }

  /** ตำแหน่งที่วาดอยู่ของผู้ป่วยคนหนึ่ง (ใช้ให้กล้องตามตัว) */
  posOf(id) {
    const s = this.smooth.get(id);
    return s ? [s.x, s.y, s.z] : null;
  }
}
