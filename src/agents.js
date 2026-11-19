/**
 * agents.js — ตัวผู้ป่วยใน 3D
 *
 * ตำแหน่งทุกตัวคำนวณจากสถานะใน sim.js + พิกัดใน layout.js เท่านั้น
 * ไฟล์นี้ไม่ตัดสินใจอะไรเกี่ยวกับคิวเลย มันแค่ "วาดสิ่งที่โมเดลบอก"
 */

import * as THREE from '../vendor/three.module.js';
import { ST } from './sim.js';
import { walkPath, pointAt, servicePos, queuePos, resultPos, ROOMS } from './layout.js';

const MAX = 700; // เพดานจำนวนตัวที่วาดพร้อมกัน (พีคจริงที่วัดได้ ~270 รวมผู้ป่วยใน)

// สีตามสถานะ — คนละความหมาย ไม่ใช่แค่ความสวย
const C = {
  walk:    new THREE.Color(0x4a7fb5), // กำลังเดิน
  queue:   new THREE.Color(0xe0a53f), // ต่อคิว (ยิ่งรอนาน ยิ่งแดง)
  queueHot: new THREE.Color(0xd4452f),
  service: new THREE.Color(0x3f9e67), // กำลังรับบริการ
  result:  new THREE.Color(0x8e7cc3), // รอผลตรวจ
  bed:     new THREE.Color(0x6f9fd0), // นอนรักษาในหอผู้ป่วย
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

    this.smooth = new Map();  // id -> ตำแหน่งที่วาดอยู่ (เพื่อให้ขยับลื่น ไม่กระตุก)
    this.index = [];          // instanceId -> patient (ใช้ตอนคลิกเลือก)
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
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
      return [x, y, z, rot, false];
    }
    if (p.state === ST.QUEUE) {
      const [x, y, z] = queuePos(p.at, Math.max(p.queueIdx, 0));
      const r = ROOMS[p.at];
      return [x, y, z, Math.atan2(-r.qDir[0], -r.qDir[1]), false];
    }
    if (p.state === ST.SERVICE) {
      const s = sim.stations[p.at];
      const [x, y, z] = servicePos(p.at, Math.max(p.slot, 0), s.servers);
      const r = ROOMS[p.at];
      // ในหอผู้ป่วยและห้องผ่าตัด คนไข้นอน ไม่ยืน
      const lying = p.at === 'ipd' || p.at === 'or';
      return [x, y, z, Math.atan2(-r.qDir[0], -r.qDir[1]), lying];
    }
    if (p.state === ST.RESULT) {
      const idx = sim.stations[p.at].waitingResult.indexOf(p);
      const [x, y, z] = resultPos(p.at, Math.max(idx, 0));
      const r = ROOMS[p.at];
      return [x, y, z, Math.atan2(-r.qDir[0], -r.qDir[1]), false];
    }
    return [0, -99, 0, 0, false];
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
      const [tx, tyRaw, tz, rot, lying] = this.targetOf(p, sim);
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
        s = { x: tx, y: ty, z: tz, rot, lying: lying ? 1 : 0 };
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
      s.lying += ((lying ? 1 : 0) - s.lying) * (1 - Math.exp(-dt * 6));

      // ท่าทาง: ยืน -> นอน คือเอียง 90 องศา แล้วลดความสูงลง
      this._q.setFromEuler(new THREE.Euler(-s.lying * Math.PI * 0.5, s.rot, 0));
      this._v.set(s.x, s.y + s.lying * 0.42, s.z);
      this._s.set(1, 1, 1);
      this._m.compose(this._v, this._q, this._s);
      mesh.setMatrixAt(n, this._m);
      mesh.setColorAt(n, this.colorOf(p, sim));
      this.index[n] = p;
      n++;
    }

    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

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
