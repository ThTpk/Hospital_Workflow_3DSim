/**
 * building.js — สร้างอาคารจาก layout.js
 *
 * ทุกชิ้นอ่านพิกัดจาก layout.js ไม่มีการพิมพ์ตัวเลขตำแหน่งซ้ำที่นี่
 * ย้ายห้องใน layout.js แล้วอาคารขยับตามเอง
 */

import * as THREE from '../vendor/three.module.js';
import { BUILDING, ROOMS, NODES, EDGES, FLOOR_Y, servicePos } from './layout.js';
import { STATION_DEFS } from './sim.js';
import { PALETTE } from './stage.js';

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
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(c.width / 46, c.height / 46, 1);
  spr.renderOrder = 20;
  return spr;
}

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
        new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 0.92, metalness: 0 }),
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
      const sides = [
        [cx, cz - d / 2, w, t],
        [cx, cz + d / 2, w, t],
        [cx - w / 2, cz, t, d],
        [cx + w / 2, cz, t, d],
      ];
      for (const [sx, sz, sw, sd] of sides) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sw, h, sd), wallMat);
        m.position.set(sx, y + h / 2, sz);
        m.castShadow = this.shadows;
        m.receiveShadow = this.shadows;
        g.add(m);
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
          const div = new THREE.Mesh(
            new THREE.BoxGeometry(dirX ? t : d * 0.62, 2.4, dirX ? d * 0.62 : t),
            new THREE.MeshStandardMaterial({ color: 0xe6ebf1, roughness: 0.9 }),
          );
          this.wallMats.push(div.material);
          const px = dirX ? x1 + (x2 - x1) * f : cx;
          const pz = dirX ? cz - r.qDir[1] * d * 0.19 : z1 + (z2 - z1) * f;
          div.position.set(px, y + 1.2, pz);
          div.castShadow = this.shadows;
          g.add(div);
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

      // เก้าอี้นั่งรอ — วางตามแนวคิว
      if (!r.beds && r.kind !== 'ward' && key !== 'or') {
        const chairGeo = new THREE.BoxGeometry(0.52, 0.46, 0.52);
        const chairMat = new THREE.MeshStandardMaterial({ color: 0xcdd6e0, roughness: 0.8 });
        const rows = 3;
        const perRow = Math.max(4, Math.floor(clen / 0.95));
        const chairs = new THREE.InstancedMesh(chairGeo, chairMat, rows * perRow);
        const m4 = new THREE.Matrix4();
        const tx = clen > 0 ? (x2 - x1) / clen : 1;
        const tz = clen > 0 ? (z2 - z1) / clen : 0;
        const mx = (x1 + x2) / 2;
        const mz = (z1 + z2) / 2;
        let n = 0;
        for (let row = 0; row < rows; row++) {
          for (let c = 0; c < perRow; c++) {
            const back = 4.4 + row * 1.5;
            const side = (c - (perRow - 1) / 2) * 0.95;
            m4.makeTranslation(
              mx + r.qDir[0] * back + tx * side,
              y + 0.24,
              mz + r.qDir[1] * back + tz * side,
            );
            chairs.setMatrixAt(n++, m4);
          }
        }
        chairs.count = n;
        chairs.instanceMatrix.needsUpdate = true;
        chairs.castShadow = false;
        g.add(chairs);
      }

      // ป้ายชื่อแผนก ลอยเหนือห้อง
      const label = makeLabel(STATION_DEFS[key]?.label ?? key, '', false);
      label.position.set(cx, y + 4.0, cz);
      this.labels[key] = label;
      g.add(label);

      this.floorGroups[r.floor].add(g);
    }
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

    this.outside = g;
    this.root.add(g);
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
