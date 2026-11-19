/**
 * building.js — สร้างอาคารจาก layout.js
 *
 * ทุกชิ้นอ่านพิกัดจาก layout.js ไม่มีการพิมพ์ตัวเลขตำแหน่งซ้ำที่นี่
 * ย้ายห้องใน layout.js แล้วอาคารขยับตามเอง
 */

import * as THREE from '../vendor/three.module.js';
import { BUILDING, ROOMS, NODES, EDGES, FLOOR_Y, servicePos, queuePos, queueGrid, queueSeated, queueFacing } from './layout.js';
import { STATION_DEFS } from './sim.js';
import { furnish } from './props.js';
import { PALETTE, isDark } from './stage.js';

/** ลายกระเบื้องพื้น 1x1 เมตร — สร้างด้วย canvas ไม่ต้องแนบไฟล์รูป */
function tileTexture(repeatX, repeatY) {
  const dark = isDark();
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = dark ? '#2f3640' : '#f3f6f9';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = dark ? 'rgba(220,235,255,0.06)' : 'rgba(40,58,76,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, 0); ctx.lineTo(1, 128);
  ctx.moveTo(0, 1); ctx.lineTo(128, 1);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

/** ป้ายชื่อแผนก — วาดด้วย canvas เพื่อให้ได้ฟอนต์ไทยของเครื่อง ไม่ต้องแนบไฟล์ฟอนต์ */
function makeLabel(text, sub = '', accent = false) {
  const pad = 18;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const fMain = 600;
  ctx.font = `${fMain} 46px "Noto Sans Thai", "Leelawadee UI", "Tahoma", sans-serif`;
  const w1 = ctx.measureText(text).width;
  ctx.font = `400 30px "Noto Sans Thai", "Leelawadee UI", "Tahoma", sans-serif`;
  const w2 = sub ? ctx.measureText(sub).width : 0;
  c.width = Math.ceil(Math.max(w1, w2) + pad * 2);
  c.height = sub ? 104 : 68;

  const ctx2 = c.getContext('2d');
  ctx2.clearRect(0, 0, c.width, c.height);
  // แผ่นป้ายโปร่งเล็กน้อย ให้ตัวหนังสืออ่านได้ทั้งบนพื้นสว่างและบนผนัง
  ctx2.fillStyle = accent ? 'rgba(232,86,63,0.94)' : 'rgba(255,255,255,0.90)';
  const r = 12;
  ctx2.beginPath();
  ctx2.moveTo(r, 0);
  ctx2.arcTo(c.width, 0, c.width, c.height, r);
  ctx2.arcTo(c.width, c.height, 0, c.height, r);
  ctx2.arcTo(0, c.height, 0, 0, r);
  ctx2.arcTo(0, 0, c.width, 0, r);
  ctx2.fill();
  ctx2.strokeStyle = accent ? 'rgba(160,40,25,0.9)' : 'rgba(43,52,64,0.22)';
  ctx2.lineWidth = 2;
  ctx2.stroke();

  ctx2.textBaseline = 'middle';
  ctx2.fillStyle = accent ? '#fff' : '#2b3440';
  ctx2.font = `${fMain} 46px "Noto Sans Thai", "Leelawadee UI", "Tahoma", sans-serif`;
  ctx2.fillText(text, pad, sub ? 34 : c.height / 2);
  if (sub) {
    ctx2.fillStyle = accent ? 'rgba(255,255,255,0.88)' : 'rgba(43,52,64,0.62)';
    ctx2.font = `400 30px "Noto Sans Thai", "Leelawadee UI", "Tahoma", sans-serif`;
    ctx2.fillText(sub, pad, 76);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  // sizeAttenuation: false = ป้ายมีขนาดคงที่บนจอ ไม่โตตามการซูม
  // ถ้าปล่อยให้โตตามระยะ พอกล้องบินเข้าไปในห้อง ป้ายจะบังทั้งห้องและล้นออกนอกจอ
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, sizeAttenuation: false,
  }));
  const H = accent ? 0.030 : 0.034;   // สัดส่วนของความสูงจอ
  spr.scale.set((H * c.width) / c.height, H, 1);
  spr.renderOrder = 20;
  return spr;
}

/** จอแสดงคิวหน้าแผนก — วาดด้วย canvas แล้วอัปเดตเฉพาะตอนตัวเลขเปลี่ยน */
function makeBoard() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 104;
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(2.6, 1.06, 1);
  return { sprite, canvas: c, tex, last: '' };
}

function drawBoard(b, calling, waiting) {
  const key = `${calling}|${waiting}`;
  if (key === b.last) return;
  b.last = key;
  const ctx = b.canvas.getContext('2d');
  const W = b.canvas.width;
  const H = b.canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(18,24,32,0.93)';
  const r = 14;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(W, 0, W, H, r);
  ctx.arcTo(W, H, 0, H, r);
  ctx.arcTo(0, H, 0, 0, r);
  ctx.arcTo(0, 0, W, 0, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,180,200,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(190,205,220,0.75)';
  ctx.font = '500 20px "Noto Sans Thai","Leelawadee UI",Tahoma,sans-serif';
  ctx.fillText('กำลังเรียก', 16, 26);

  ctx.fillStyle = '#5fd0e8';
  ctx.font = '700 52px ui-monospace,Consolas,monospace';
  ctx.fillText(String(calling).padStart(3, '0'), 14, 70);

  ctx.fillStyle = 'rgba(190,205,220,0.75)';
  ctx.font = '500 21px "Noto Sans Thai","Leelawadee UI",Tahoma,sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('รอ', W - 16, 28);
  ctx.fillStyle = waiting > 20 ? '#ff7a63' : '#dde6ef';
  ctx.font = '700 40px ui-monospace,Consolas,monospace';
  ctx.fillText(String(waiting), W - 16, 68);
  ctx.textAlign = 'left';

  b.tex.needsUpdate = true;
}

// สีเส้นนำทางบนพื้นทางเดิน [ระยะเยื้องจากกึ่งกลาง, สี]
const GUIDES = [[-1.25, 0x5b8fc9], [0, 0x6fb07a], [1.25, 0xd3a24e]];

export class Building {
  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group();
    stage.scene.add(this.root);

    this.wallMats = [];        // ผนังทุกชิ้น (ใช้ปรับความโปร่งตอนทำ X-ray)
    this.roomMats = {};        // วัสดุพื้นห้อง (ใช้ไฮไลต์แผนก)
    this.floorGroups = [];     // แยกตามชั้น เพื่อซ่อนทีละชั้น
    this.roofGroup = new THREE.Group();
    this.labels = {};
    this.roomPicks = [];   // พื้นห้อง ใช้เป็นเป้าให้คลิกเลือกแผนกใน 3D
    this.boards = {};      // จอแสดงคิวหน้าแผนก
    this.shadows = stage.tier.shadows;

    for (let f = 0; f < BUILDING.floors; f++) {
      const g = new THREE.Group();
      this.floorGroups.push(g);
      this.root.add(g);
    }
    this.root.add(this.roofGroup);

    this._slabs();
    this._corridors();
    this._rooms();
    this._furniture();
    this._exterior();
    this._roof();
    this._outside();
  }

  // ───────── พื้นแต่ละชั้น ─────────
  _slabs() {
    const w = BUILDING.xMax - BUILDING.xMin;
    const d = BUILDING.zMax - BUILDING.zMin;
    const cx = (BUILDING.xMin + BUILDING.xMax) / 2;
    const cz = (BUILDING.zMin + BUILDING.zMax) / 2;

    for (let f = 0; f < BUILDING.floors; f++) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.4, d),
        new THREE.MeshStandardMaterial({
          color: PALETTE.slab, roughness: 0.92, metalness: 0,
          map: tileTexture(w, d),   // กระเบื้องขนาด 1x1 เมตร
        }),
      );
      slab.position.set(cx, FLOOR_Y[f] - 0.2, cz);
      slab.receiveShadow = this.shadows;
      slab.castShadow = false;
      this.floorGroups[f].add(slab);

      // ขอบพื้น ให้อาคารมีเส้นคมเวลาเปิดหลังคา
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.5, 0.18, d + 0.5),
        new THREE.MeshStandardMaterial({ color: PALETTE.slabEdge, roughness: 0.85 }),
      );
      edge.position.set(cx, FLOOR_Y[f] - 0.42, cz);
      this.floorGroups[f].add(edge);
    }
  }

  // ───────── ทางเดิน: แถบสีอ่อนบนพื้น ให้เห็นว่าคนไข้เดินตามเส้นนี้ ─────────
  _corridors() {
    // สีเส้นนำทาง: น้ำเงิน = โซนตรวจ, เขียว = โซนตรวจวินิจฉัย, เหลือง = โซนรับยา/การเงิน
    const guideAcc = this.floorGroups.map(() => GUIDES.map(() => []));
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe8edf4, roughness: 0.7, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    for (const [a, b] of EDGES) {
      const A = NODES[a];
      const B = NODES[b];
      if (A[2] !== B[2]) continue; // บันไดวาดแยก
      const dx = B[0] - A[0];
      const dz = B[1] - A[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const sg = new THREE.PlaneGeometry(len, BUILDING.corridorW);
      sg.rotateX(-Math.PI / 2);
      sg.rotateY(Math.atan2(-dz, dx)); // จัดด้านยาวให้ตรงกับทิศของเส้นทางเดิน
      const strip = new THREE.Mesh(sg, mat);
      strip.position.set((A[0] + B[0]) / 2, FLOOR_Y[A[2]] + 0.012, (A[1] + B[1]) / 2);
      strip.receiveShadow = false;
      this.floorGroups[A[2]].add(strip);

      // เส้นนำทางสีบนพื้น — เก็บรูปแบบไว้ก่อน ค่อยรวมเป็น InstancedMesh ตอนจบ
      // ถ้าสร้างเป็น Mesh ทีละเส้น จะได้ draw call เพิ่มขึ้นเกือบ 40 ตัวโดยไม่จำเป็น
      {
        const nx = -dz / len;
        const nz = dx / len;
        const yaw = Math.atan2(-dz, dx);
        for (let gi = 0; gi < GUIDES.length; gi++) {
          const offset = GUIDES[gi][0];
          guideAcc[A[2]][gi].push({
            x: (A[0] + B[0]) / 2 + nx * offset,
            y: FLOOR_Y[A[2]] + 0.02,
            z: (A[1] + B[1]) / 2 + nz * offset,
            len,
            yaw,
          });
        }
      }
    }
    // รวมเส้นนำทางทั้งหมดเป็น InstancedMesh อย่างละสี
    const lineGeo = new THREE.PlaneGeometry(1, 0.17);
    lineGeo.rotateX(-Math.PI / 2);
    for (let f = 0; f < guideAcc.length; f++) {
      for (let gi = 0; gi < GUIDES.length; gi++) {
        const list = guideAcc[f][gi];
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(
          lineGeo,
          new THREE.MeshBasicMaterial({ color: GUIDES[gi][1], transparent: true, opacity: 0.5 }),
          list.length,
        );
        const m4 = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        const eul = new THREE.Euler();
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          pos.set(it.x, it.y, it.z);
          eul.set(0, it.yaw, 0);
          quat.setFromEuler(eul);
          scl.set(it.len, 1, 1);
          im.setMatrixAt(i, m4.compose(pos, quat, scl));
        }
        im.instanceMatrix.needsUpdate = true;
        this.floorGroups[f].add(im);
      }
    }

    // บันได เชื่อมสองชั้น
    const st = new THREE.Group();
    this.stairGroup = st;
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const s = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, BUILDING.floorH / steps, 0.72),
        new THREE.MeshStandardMaterial({ color: 0xd3dae3, roughness: 0.9 }),
      );
      s.position.set(0, (i + 0.5) * (BUILDING.floorH / steps), 6 - 2.2 - i * 0.72);
      s.castShadow = this.shadows;
      st.add(s);
    }
    this.floorGroups[0].add(st);
  }

  // ───────── ห้องแต่ละแผนก ─────────
  _rooms() {
    for (const [key, r] of Object.entries(ROOMS)) {
      const g = new THREE.Group();
      const [cx, cz] = r.pos;
      const [w, d] = r.size;
      const y = FLOOR_Y[r.floor];

      // พื้นห้องสีประจำแผนก — ใช้ไฮไลต์ตอนเลือกแผนก
      const fmat = new THREE.MeshStandardMaterial({
        color: r.color, roughness: 0.88, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      this.roomMats[key] = fmat;
      const floorPatch = new THREE.Mesh(new THREE.PlaneGeometry(w, d), fmat);
      floorPatch.rotation.x = -Math.PI / 2;
      floorPatch.position.set(cx, y + 0.02, cz);
      floorPatch.userData.roomKey = key;
      this.roomPicks.push(floorPatch);
      g.add(floorPatch);

      // ผนังห้อง 4 ด้าน สูงไม่ถึงเพดาน ให้มองข้ามเข้าไปเห็นข้างในได้
      const h = 2.6;
      // ผนังทึบไว้ก่อน เปิดโปร่งเฉพาะตอนโหมด X-ray
      // ผนังโปร่ง 44 ชิ้นซ้อนกันทำให้กราฟิกออนบอร์ดตายเพราะ overdraw
      const wallMat = new THREE.MeshStandardMaterial({
        color: PALETTE.wall, roughness: 0.86, metalness: 0,
        transparent: false, opacity: 1,
      });
      this.wallMats.push(wallMat);
      const t = BUILDING.wallT;
      // ผนังด้านที่หันเข้าทางเดินต้องมีประตู ไม่ใช่กำแพงทึบรอบด้าน
      // qDir ชี้ไปทางทางเดินอยู่แล้ว จึงใช้บอกได้ว่าด้านไหนคือด้านหน้าห้อง
      const frontAxis = Math.abs(r.qDir[0]) > 0.5 ? 'x' : 'z';
      const frontSign = frontAxis === 'x' ? Math.sign(r.qDir[0]) : Math.sign(r.qDir[1]);
      const DOOR_W = 2.4;
      const DOOR_H = 2.1;

      const addWall = (px, py, pz, sw, sh, sd) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), wallMat);
        m.position.set(px, py, pz);
        m.castShadow = this.shadows;
        m.receiveShadow = this.shadows;
        g.add(m);
      };

      const sides = [
        { x: cx, z: cz - d / 2, sw: w, sd: t, axis: 'z', sign: -1 },
        { x: cx, z: cz + d / 2, sw: w, sd: t, axis: 'z', sign: 1 },
        { x: cx - w / 2, z: cz, sw: t, sd: d, axis: 'x', sign: -1 },
        { x: cx + w / 2, z: cz, sw: t, sd: d, axis: 'x', sign: 1 },
      ];
      for (const side of sides) {
        if (!(side.axis === frontAxis && side.sign === frontSign)) {
          addWall(side.x, y + h / 2, side.z, side.sw, h, side.sd);
          continue;
        }
        // ด้านหน้า: ผนังสองท่อนขนาบช่องประตู แล้วมีคานเหนือประตู
        const span = side.axis === 'z' ? side.sw : side.sd;
        const seg = Math.max((span - DOOR_W) / 2, 0.2);
        const off = DOOR_W / 2 + seg / 2;
        if (side.axis === 'z') {
          addWall(side.x - off, y + h / 2, side.z, seg, h, side.sd);
          addWall(side.x + off, y + h / 2, side.z, seg, h, side.sd);
          addWall(side.x, y + DOOR_H + (h - DOOR_H) / 2, side.z, DOOR_W, h - DOOR_H, side.sd);
        } else {
          addWall(side.x, y + h / 2, side.z - off, side.sw, h, seg);
          addWall(side.x, y + h / 2, side.z + off, side.sw, h, seg);
          addWall(side.x, y + DOOR_H + (h - DOOR_H) / 2, side.z, side.sw, h - DOOR_H, DOOR_W);
        }
      }

      // เคาน์เตอร์/จุดบริการ
      const [[x1, z1], [x2, z2]] = r.counter;
      const clen = Math.hypot(x2 - x1, z2 - z1);
      if (clen > 0.5 && key !== 'ipd') {
        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(clen + 0.6, 1.05, 0.7),
          new THREE.MeshStandardMaterial({ color: 0xb9c3cf, roughness: 0.6, metalness: 0.05 }),
        );
        counter.position.set((x1 + x2) / 2, y + 0.52, (z1 + z2) / 2);
        counter.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        counter.castShadow = this.shadows;
        g.add(counter);
      }

      // ห้องตรวจย่อย (OPD 8 ห้อง, X-ray 3 ห้อง, OR 3 ห้อง)
      if (r.rooms) {
        const n = r.rooms;
        const dirX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
        for (let i = 1; i < n; i++) {
          const f = i / n;
          const dw = dirX ? t : d * 0.62;
          const dd = dirX ? d * 0.62 : t;
          const px = dirX ? x1 + (x2 - x1) * f : cx;
          const pz = dirX ? cz - r.qDir[1] * d * 0.19 : z1 + (z2 - z1) * f;
          // ครึ่งล่างทึบ
          const div = new THREE.Mesh(
            new THREE.BoxGeometry(dw, 1.55, dd),
            new THREE.MeshStandardMaterial({ color: 0xe6ebf1, roughness: 0.9 }),
          );
          this.wallMats.push(div.material);
          div.position.set(px, y + 0.775, pz);
          div.castShadow = this.shadows;
          g.add(div);
          // ครึ่งบนเป็นกระจกฝ้า ทำให้อ่านเป็นห้องตรวจจริง ไม่ใช่แผงกั้นทึบ
          const glass = new THREE.Mesh(
            new THREE.BoxGeometry(dw * 0.94, 0.8, dd * 0.94),
            new THREE.MeshStandardMaterial({
              color: 0xbcd8e4, roughness: 0.22, metalness: 0.08,
              transparent: true, opacity: 0.34, depthWrite: false,
            }),
          );
          glass.position.set(px, y + 1.95, pz);
          g.add(glass);
        }
      }

      // เตียงผู้ป่วยใน — instanced เพราะมี 120 เตียง
      if (r.beds) {
        const bedGeo = new THREE.BoxGeometry(0.95, 0.55, 2.0);
        const bedMat = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.75 });
        const beds = new THREE.InstancedMesh(bedGeo, bedMat, r.beds);
        beds.castShadow = this.shadows;
        const m4 = new THREE.Matrix4();
        for (let i = 0; i < r.beds; i++) {
          const [bx, by, bz] = servicePos(key, i, r.beds);
          m4.makeTranslation(bx, by + 0.3, bz);
          beds.setMatrixAt(i, m4);
        }
        beds.instanceMatrix.needsUpdate = true;
        this.bedMesh = beds;
        g.add(beds);
      }

      // เก้าอี้นั่งรอ — วางที่ "ตำแหน่งคิว" ตรง ๆ โดยใช้สูตรเดียวกับที่วางคน
      // ถ้าคำนวณแยกกัน จะได้ผู้ป่วยนั่งลอยอยู่ข้างเก้าอี้
      if (!r.beds && r.kind !== 'ward' && key !== 'or') {
        const grid = queueGrid(key);
        const seats = [];
        for (let i = 0; i < grid.cap; i++) {
          if (queueSeated(key, i)) seats.push(queuePos(key, i));
        }
        if (seats.length) {
          const face = queueFacing(key);
          const seatMat = new THREE.MeshStandardMaterial({ color: 0xc4ced9, roughness: 0.82 });
          const backMat = new THREE.MeshStandardMaterial({ color: 0xaab6c3, roughness: 0.82 });
          const seatMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.08, 0.48), seatMat, seats.length);
          const backMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.42, 0.07), backMat, seats.length);
          const legMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.42, 0.06), seatMat, seats.length);
          const m4 = new THREE.Matrix4();
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, face, 0));
          const one = new THREE.Vector3(1, 1, 1);
          const v = new THREE.Vector3();
          for (let i = 0; i < seats.length; i++) {
            const [sx, , sz] = seats[i];
            v.set(sx, y + 0.44, sz);
            seatMesh.setMatrixAt(i, m4.compose(v, q, one));
            // พนักพิงอยู่ด้านหลังคนนั่ง (ตรงข้ามทิศที่หันหน้าไป)
            v.set(sx - Math.sin(face) * 0.22, y + 0.69, sz - Math.cos(face) * 0.22);
            backMesh.setMatrixAt(i, m4.compose(v, q, one));
            v.set(sx, y + 0.21, sz);
            legMesh.setMatrixAt(i, m4.compose(v, q, one));
          }
          for (const m of [seatMesh, backMesh, legMesh]) {
            m.instanceMatrix.needsUpdate = true;
            m.castShadow = false;
            g.add(m);
          }
        }
      }

      // จอแสดงคิวเหนือจุดบริการ — ใช้หน่วยจริงในโลก จะได้รู้สึกเป็นของในห้อง
      if (clen > 0.5 && key !== 'ipd' && key !== 'or') {
        const board = makeBoard();
        board.sprite.position.set((x1 + x2) / 2, y + 3.0, (z1 + z2) / 2);
        this.boards[key] = board;
        g.add(board.sprite);
      }

      // ป้ายชื่อแผนก ลอยเหนือห้อง
      const label = makeLabel(STATION_DEFS[key]?.label ?? key, '', false);
      label.position.set(cx, y + 4.0, cz);
      this.labels[key] = label;
      g.add(label);

      this.floorGroups[r.floor].add(g);
    }
  }

  // ───────── เฟอร์นิเจอร์และเครื่องมือในห้อง ─────────
  _furniture() {
    // จำนวนโต๊ะ/เตียง/คูหา อิงขนาดห้องตามแบบ ไม่ใช่จำนวนเจ้าหน้าที่ที่เข้าเวรวันนั้น
    // (หมอลา 2 คน ห้องตรวจก็ยังมี 8 ห้องเท่าเดิม) ส่วนตัวคนอยู่ใน staff.js
    const servers = {};
    for (const [k, d] of Object.entries(STATION_DEFS)) servers[k] = d.servers;
    this.propStats = furnish(this.floorGroups, servers, this.shadows);
  }

  // ───────── เปลือกอาคาร ─────────
  _exterior() {
    this.lift = 13; // ระยะยกชั้น 2 ตอนดู 'ทั้งอาคาร'
    const h = BUILDING.floorH * BUILDING.floors;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcfd7e1, roughness: 0.82, metalness: 0.02,
      transparent: true, opacity: 0.10, side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.shellMat = mat;
    const w = BUILDING.xMax - BUILDING.xMin;
    const d = BUILDING.zMax - BUILDING.zMin;
    const cx = (BUILDING.xMin + BUILDING.xMax) / 2;
    const cz = (BUILDING.zMin + BUILDING.zMax) / 2;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    shell.position.set(cx, h / 2, cz);
    this.shell = shell;
    this.root.add(shell);
  }

  _roof() {
    const w = BUILDING.xMax - BUILDING.xMin;
    const d = BUILDING.zMax - BUILDING.zMin;
    const cx = (BUILDING.xMin + BUILDING.xMax) / 2;
    const cz = (BUILDING.zMin + BUILDING.zMax) / 2;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 1.2, 0.5, d + 1.2),
      new THREE.MeshStandardMaterial({ color: 0xbcc5d0, roughness: 0.9 }),
    );
    roof.position.set(cx, BUILDING.floorH * BUILDING.floors + 0.25, cz);
    roof.castShadow = this.shadows;
    this.roofGroup.add(roof);
  }

  // ───────── ของนอกอาคาร: ลานรถพยาบาล + ทางเข้าหน้า ─────────
  _outside() {
    const g = new THREE.Group();

    // ลานจอดรถพยาบาลฝั่งตะวันออก
    const bay = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 12),
      new THREE.MeshStandardMaterial({ color: 0xd8d2cd, roughness: 0.95 }),
    );
    bay.rotation.x = -Math.PI / 2;
    bay.position.set(40, 0.01, -10);
    g.add(bay);

    // รถพยาบาลแบบง่าย — ตัวถัง + ห้องคนขับ + แถบสี
    const amb = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 2.3, 5.6),
      new THREE.MeshStandardMaterial({ color: 0xf7f9fb, roughness: 0.45, metalness: 0.08 }),
    );
    body.position.y = 1.5;
    amb.add(body);
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(2.25, 1.5, 2.0),
      new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.4, metalness: 0.08 }),
    );
    cab.position.set(0, 1.1, 3.6);
    amb.add(cab);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2.36, 0.42, 5.2),
      new THREE.MeshStandardMaterial({ color: PALETTE.accent, roughness: 0.5 }),
    );
    stripe.position.y = 1.35;
    amb.add(stripe);
    for (const [wx, wz] of [[1.15, 1.9], [-1.15, 1.9], [1.15, -1.7], [-1.15, -1.7]]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.52, 0.3, 14),
        new THREE.MeshStandardMaterial({ color: 0x2f353d, roughness: 0.9 }),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.52, wz);
      amb.add(wheel);
    }
    amb.position.set(41, 0, -10);
    amb.rotation.y = Math.PI / 2;
    amb.traverse((o) => { if (o.isMesh) o.castShadow = this.shadows; });
    g.add(amb);

    // กันสาดทางเข้าหน้า
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0xc6cfda, roughness: 0.85 }),
    );
    canopy.position.set(-31, 3.4, 24);
    canopy.castShadow = this.shadows;
    g.add(canopy);
    for (const px of [-36, -26]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 3.4, 10),
        new THREE.MeshStandardMaterial({ color: 0xb6c0cc, roughness: 0.8 }),
      );
      col.position.set(px, 1.7, 27);
      g.add(col);
    }
    const entry = makeLabel('ทางเข้าผู้ป่วยนอก', '', false);
    entry.position.set(-31, 5.6, 24);
    g.add(entry);

    const erLabel = makeLabel('ทางเข้ารถพยาบาล', '', true);
    erLabel.position.set(40, 4.4, -10);
    g.add(erLabel);

    // ───── ลานจอดรถหน้าอาคาร ─────
    const lot = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 22),
      new THREE.MeshStandardMaterial({ color: isDark() ? 0x2a3038 : 0xcfd3d8, roughness: 0.97 }),
    );
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(-6, 0.008, 34);
    g.add(lot);
    // เส้นช่องจอด
    const bayGeo = new THREE.PlaneGeometry(0.12, 5);
    bayGeo.rotateX(-Math.PI / 2);
    const bayMat = new THREE.MeshBasicMaterial({ color: 0xf0f0f0, transparent: true, opacity: 0.45 });
    const bays = new THREE.InstancedMesh(bayGeo, bayMat, 36);
    const bm = new THREE.Matrix4();
    let bn = 0;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i <= 17; i++) {
        bm.makeTranslation(-28 + i * 2.6, 0.015, 29 + row * 10);
        bays.setMatrixAt(bn++, bm);
      }
    }
    bays.count = bn;
    bays.instanceMatrix.needsUpdate = true;
    g.add(bays);

    // ───── ต้นไม้รอบอาคาร ─────
    const trunkGeo = new THREE.CylinderGeometry(0.17, 0.23, 2.4, 7);
    trunkGeo.translate(0, 1.2, 0);
    const crownGeo = new THREE.SphereGeometry(1.5, 8, 6);
    crownGeo.translate(0, 3.3, 0);
    const spots = [];
    for (let i = 0; i < 9; i++) spots.push([-34 + i * 7, 22]);
    for (let i = 0; i < 5; i++) spots.push([-40, -16 + i * 9]);
    for (let i = 0; i < 4; i++) spots.push([-30 + i * 9, 46]);
    const trunks = new THREE.InstancedMesh(
      trunkGeo, new THREE.MeshStandardMaterial({ color: 0x7a6552, roughness: 0.95 }), spots.length);
    const crowns = new THREE.InstancedMesh(
      crownGeo, new THREE.MeshStandardMaterial({ color: isDark() ? 0x3f6b46 : 0x6f9e62, roughness: 0.92 }), spots.length);
    const tm = new THREE.Matrix4();
    const tv = new THREE.Vector3();
    const tq = new THREE.Quaternion();
    const ts = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const sc = 0.78 + ((i * 37) % 11) / 18;   // ขนาดต่างกันเล็กน้อย ไม่ให้ดูเป็นของปั๊ม
      tv.set(spots[i][0], 0, spots[i][1]);
      ts.set(sc, sc, sc);
      tm.compose(tv, tq, ts);
      trunks.setMatrixAt(i, tm);
      crowns.setMatrixAt(i, tm);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    crowns.castShadow = this.shadows;
    g.add(trunks);
    g.add(crowns);

    this.outside = g;
    this.root.add(g);
  }

  /**
   * หาแผนกจากจุดที่คลิกในฉาก 3D
   * ต้องไล่เช็ก parent ขึ้นไปด้วย เพราะตอนซ่อนชั้น three ซ่อนที่ตัว group
   * ส่วนพื้นห้องแต่ละชิ้นยังมี visible = true อยู่ ถ้าไม่เช็กจะคลิกทะลุไปโดนห้องชั้นที่ถูกซ่อน
   */
  pickRoom(raycaster) {
    const hits = raycaster.intersectObjects(this.roomPicks, false);
    for (const hit of hits) {
      let o = hit.object;
      let shown = true;
      while (o) {
        if (!o.visible) { shown = false; break; }
        o = o.parent;
      }
      if (shown) return hit.object.userData.roomKey;
    }
    return null;
  }

  /** อัปเดตจอแสดงคิวทุกแผนกจาก snapshot เดียวกับที่ panel ใช้ */
  updateBoards(snap) {
    for (const [key, b] of Object.entries(this.boards)) {
      const p = snap.per[key];
      if (p) drawBoard(b, p.served, p.queue);
    }
  }

  // ───────── โหมดการมอง ─────────
  /**
   * mode: 'solid' | 'roofOff' | 'section' | 'xray'
   */
  setCutaway(mode) {
    this.cutaway = mode;
    const roofOn = mode === 'solid';
    this.roofGroup.visible = roofOn;
    this.shell.visible = mode === 'solid' && !this.exploded;
    this.shellMat.opacity = mode === 'solid' ? 0.42 : mode === 'xray' ? 0.07 : 0.14;

    const xray = mode === 'xray';
    for (const m of this.wallMats) {
      m.transparent = xray;
      m.opacity = xray ? 0.2 : 1;
      m.depthWrite = !xray;
      m.needsUpdate = true;
    }

    // ตัดขวาง: หั่นครึ่งอาคารด้วย clipping plane ให้เห็นทั้งสองชั้นพร้อมกัน
    const planes = mode === 'section'
      ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), 4)]
      : [];
    this.stage.renderer.clippingPlanes = planes;
    this.stage.renderer.localClippingEnabled = planes.length > 0;
  }

  /**
   * floor: 0, 1 หรือ null = ทุกชั้น
   *
   * ตอนดูทุกชั้นพร้อมกัน ต้อง "ยก" ชั้น 2 ลอยขึ้น ไม่งั้นพื้นชั้น 2 จะบังชั้น 1 มิด
   * มองจากด้านบนแล้วจะเห็นแต่หอผู้ป่วย ส่วน OPD ที่เป็นพระเอกหายไปทั้งหมด
   */
  setFloor(floor) {
    this.activeFloor = floor;
    const exploded = floor === null;
    this.exploded = exploded;
    for (let f = 0; f < this.floorGroups.length; f++) {
      this.floorGroups[f].visible = exploded || floor === f;
      this.floorGroups[f].position.y = exploded && f === 1 ? this.lift : 0;
    }
    // บันไดเชื่อมสองชั้น พอยกชั้นออกจากกันแล้วมันจะลอยค้าง จึงซ่อน
    if (this.stairGroup) this.stairGroup.visible = !exploded;
    // เปลือกอาคารครอบได้เฉพาะตอนชั้นยังซ้อนกันตามจริง
    this.shell.visible = !exploded && this.cutaway !== 'section';
    if (!exploded) this.roofGroup.visible = false;
  }

  /** ระยะที่ต้องยกตัวผู้ป่วยบนชั้น 2 ให้ตรงกับอาคาร */
  liftAmount() {
    return this.exploded ? this.lift : 0;
  }

  /** ไฮไลต์แผนกที่เลือก + ทำสีเน้นให้คอขวด */
  highlight(selected, bottleneck) {
    for (const [key, mat] of Object.entries(this.roomMats)) {
      const r = ROOMS[key];
      const isSel = key === selected;
      const isBot = key === bottleneck;
      mat.color.setHex(isBot ? PALETTE.accent : r.color);
      // เน้นด้วยการเรืองแสงแทนความโปร่ง: ได้ผลชัดกว่าและไม่เสีย fill rate
      if (!mat.emissive) continue;
      mat.emissive.setHex(isBot ? PALETTE.accent : r.color);
      mat.emissiveIntensity = isSel ? 0.55 : isBot ? 0.4 : selected ? 0.0 : 0.12;
    }
    for (const [key, spr] of Object.entries(this.labels)) {
      spr.material.opacity = selected && key !== selected ? 0.3 : 1;
    }
  }
}
