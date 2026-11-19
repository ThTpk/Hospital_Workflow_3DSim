/**
 * layout.js — ผังอาคารและกราฟทางเดิน
 *
 * ไฟล์นี้ก็ไม่มี three.js เช่นกัน: มันคือ "พิกัดจริง" ที่ทั้งการสร้างโมเดล 3D
 * และการเดินของคนไข้อ่านร่วมกัน ถ้าย้ายห้องที่นี่ ทั้งอาคารและเส้นทางเดินขยับตามเอง
 *
 * ระบบพิกัด: x = ตะวันออก-ตะวันตก, z = เหนือ-ใต้, y = สูงขึ้น (หน่วยเมตร)
 *   z เป็นบวก = ด้านหน้าอาคาร (ทางเข้าหลัก)
 *   z เป็นลบ  = ด้านหลัง (โซนคลินิก)
 */

export const BUILDING = {
  xMin: -34, xMax: 34,
  zMin: -20, zMax: 20,
  floorH: 4.6,       // ความสูงต่อชั้น
  floors: 2,
  wallT: 0.25,       // ความหนาผนัง
  corridorW: 4.0,    // ความกว้างทางเดิน
};

export const FLOOR_Y = [0, BUILDING.floorH];

/**
 * ห้องแต่ละแผนก
 *  pos    : จุดกลางห้อง [x, z]
 *  size   : [กว้าง, ลึก]
 *  counter: เส้นเคาน์เตอร์/จุดบริการ [[x1,z1],[x2,z2]] — เจ้าหน้าที่กระจายตามเส้นนี้
 *  qDir   : ทิศที่คิวยืดออกไปจากเคาน์เตอร์ [dx, dz] (normalize แล้ว)
 *  access : id ของโหนดทางเดินที่ห้องนี้เปิดออกไป
 */
export const ROOMS = {
  reg: {
    floor: 0, pos: [-24, 10], size: [15, 13],
    counter: [[-30, 13], [-18, 13]], qDir: [0, -1], access: 's1',
    color: 0x7fa8d4,
  },
  triage: {
    floor: 0, pos: [-8, 10], size: [12, 13],
    counter: [[-13, 13], [-3, 13]], qDir: [0, -1], access: 's3',
    color: 0x86c3b4,
  },
  pharm: {
    floor: 0, pos: [9, 10], size: [15, 13],
    counter: [[3, 13], [15, 13]], qDir: [0, -1], access: 's5',
    color: 0xc9a86a,
  },
  cashier: {
    floor: 0, pos: [25, 11], size: [13, 11],
    counter: [[20, 13.5], [30, 13.5]], qDir: [0, -1], access: 's6',
    color: 0xb59bc4,
  },
  opd: {
    floor: 0, pos: [-20, -11], size: [23, 15],
    counter: [[-30, -14.5], [-10, -14.5]], qDir: [0, 1], access: 's2', cubicle: true,
    color: 0x6f97c7, rooms: 8,
  },
  lab: {
    floor: 0, pos: [-1, -11], size: [13, 15],
    counter: [[-6, -14], [4, -14]], qDir: [0, 1], access: 's3',
    color: 0x8fb57a,
  },
  xray: {
    floor: 0, pos: [14, -11], size: [13, 15],
    counter: [[9, -14.5], [19, -14.5]], qDir: [0, 1], access: 's5', cubicle: true,
    color: 0x9aa7b8, rooms: 3,
  },
  er: {
    // ER มีทางเข้ารถพยาบาลของตัวเองทางตะวันออก ผู้ป่วยไม่ผ่านโถงหน้า
    floor: 0, pos: [28, -10.5], size: [11, 16],
    counter: [[24, -16], [24, -5]], qDir: [1, 0], access: 'er_door',
    color: 0xd4756b, accent: true,
  },
  ipd: {
    floor: 1, pos: [-16, -6], size: [34, 22],
    counter: [[-31, 0], [0, 0]], qDir: [0, 1], access: 'f1_w',
    color: 0x8aaed0, beds: 120,
  },
  or: {
    floor: 1, pos: [20, -8], size: [22, 20],
    counter: [[11, -4], [29, -4]], qDir: [0, 1], access: 'f1_e', cubicle: true,
    color: 0x7fc4c0, rooms: 3, kind: 'ward',
  },
};

/** โหนดทางเดิน: [x, z, ชั้น] */
export const NODES = {
  // ทางเดินหลักชั้น 1 แนวตะวันออก-ตะวันตก ที่ z = 0
  s0: [-31, 0, 0],
  s1: [-24, 0, 0],
  s2: [-20, 0, 0],
  s3: [-8, 0, 0],
  s4: [0, 0, 0],
  s5: [9, 0, 0],
  s6: [25, 0, 0],
  s7: [30, 0, 0],
  // ทางเข้า
  gate_opd: [-31, 17, 0],   // ประตูหน้า ผู้ป่วยนอกเดินเข้า
  gate_er: [39, -10, 0],    // ลานรถพยาบาล (นอกอาคาร)
  er_door: [30, -10, 0],    // ทางเดินภายใน ER
  // บันได/ลิฟต์ เชื่อมสองชั้น
  stair0: [0, 6, 0],
  stair1: [0, 6, 1],
  // ทางเดินชั้น 2
  f1_w: [-14, 6, 1],
  f1_c: [0, 6, 1],
  f1_e: [20, 6, 1],
};

/** เส้นเชื่อมระหว่างโหนด (เดินได้สองทาง) */
export const EDGES = [
  ['gate_opd', 's0'],
  ['s0', 's1'], ['s1', 's2'], ['s2', 's3'], ['s3', 's4'],
  ['s4', 's5'], ['s5', 's6'], ['s6', 's7'],
  ['s7', 'er_door'], ['er_door', 'gate_er'],
  ['s4', 'stair0'],
  ['stair0', 'stair1'],
  ['stair1', 'f1_c'],
  ['f1_c', 'f1_w'], ['f1_c', 'f1_e'],
];

/** จุดที่ถือว่า "ออกจากโรงพยาบาล" */
export const EXIT_NODE = 'gate_opd';

// ───────────────────────── กราฟ + หาเส้นทางสั้นสุด ─────────────────────────
const ADJ = (() => {
  const a = {};
  for (const id of Object.keys(NODES)) a[id] = [];
  for (const [u, v] of EDGES) {
    a[u].push(v);
    a[v].push(u);
  }
  return a;
})();

function dist(a, b) {
  const A = NODES[a];
  const B = NODES[b];
  const dy = (A[2] - B[2]) * BUILDING.floorH;
  return Math.hypot(A[0] - B[0], A[1] - B[1], dy);
}

/** Dijkstra เล็ก ๆ (โหนดไม่ถึง 20 ตัว เลยไม่ต้องใช้ priority queue จริง) */
function shortestPath(from, to) {
  if (from === to) return [from];
  const d = {};
  const prev = {};
  const seen = new Set();
  for (const id of Object.keys(NODES)) d[id] = Infinity;
  d[from] = 0;
  while (true) {
    let u = null;
    let best = Infinity;
    for (const id of Object.keys(NODES)) {
      if (!seen.has(id) && d[id] < best) {
        best = d[id];
        u = id;
      }
    }
    if (u === null) break;
    if (u === to) break;
    seen.add(u);
    for (const v of ADJ[u]) {
      const nd = d[u] + dist(u, v);
      if (nd < d[v]) {
        d[v] = nd;
        prev[v] = u;
      }
    }
  }
  if (d[to] === Infinity) return [from, to];
  const path = [to];
  let cur = to;
  while (cur !== from) {
    cur = prev[cur];
    path.unshift(cur);
  }
  return path;
}

// แคชเส้นทางไว้ล่วงหน้า — ทุกคู่ต้นทาง/ปลายทางมีไม่กี่สิบคู่
const PATH_CACHE = new Map();

/** แปลง key ของจุดบริการ/ประตู ให้เป็นโหนดทางเดิน */
function nodeOf(key) {
  if (NODES[key]) return key;
  const r = ROOMS[key];
  return r ? r.access : 's4';
}

/**
 * เส้นทางเดินจากจุดหนึ่งไปอีกจุด เป็นลิสต์พิกัด [x, y, z]
 * จุดแรกคือที่ยืนในห้องต้นทาง จุดสุดท้ายคือที่ยืนในห้องปลายทาง
 */
export function walkPath(fromKey, toKey) {
  const ck = `${fromKey}>${toKey}`;
  const hit = PATH_CACHE.get(ck);
  if (hit) return hit;

  const pts = [];
  const push = (x, z, floor) => pts.push([x, FLOOR_Y[floor] ?? 0, z]);

  // ออกจากห้องต้นทาง: เริ่มที่หน้าเคาน์เตอร์
  const rf = ROOMS[fromKey];
  if (rf) {
    const c = rf.counter;
    const mx = (c[0][0] + c[1][0]) / 2;
    const mz = (c[0][1] + c[1][1]) / 2;
    push(mx + rf.qDir[0] * 2, mz + rf.qDir[1] * 2, rf.floor);
  } else if (NODES[fromKey]) {
    const n = NODES[fromKey];
    push(n[0], n[1], n[2]);
  }

  const a = nodeOf(fromKey);
  const b = nodeOf(toKey === 'exit' ? EXIT_NODE : toKey);
  for (const id of shortestPath(a, b)) {
    const n = NODES[id];
    push(n[0], n[1], n[2]);
  }

  // เข้าห้องปลายทาง: ไปจบที่หน้าเคาน์เตอร์
  const rt = toKey === 'exit' ? null : ROOMS[toKey];
  if (rt) {
    const c = rt.counter;
    const mx = (c[0][0] + c[1][0]) / 2;
    const mz = (c[0][1] + c[1][1]) / 2;
    push(mx + rt.qDir[0] * 2.5, mz + rt.qDir[1] * 2.5, rt.floor);
  }

  // ตัดจุดที่ซ้อนกันออก ไม่ให้คนไข้ "หยุดนิ่ง" กลางทาง
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[2] - last[2]) > 0.05 || p[1] !== last[1]) out.push(p);
  }
  const res = out.length >= 2 ? out : [...out, ...out];
  PATH_CACHE.set(ck, res);
  return res;
}

/** ความยาวรวมของเส้นทาง (เมตร) */
export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2], pts[i][1] - pts[i - 1][1]);
  }
  return L;
}

/** หาพิกัดบนเส้นทางที่สัดส่วน u (0..1) */
export function pointAt(pts, u) {
  const total = pathLength(pts);
  if (total <= 0) return [pts[0][0], pts[0][1], pts[0][2], 0];
  let want = Math.max(0, Math.min(1, u)) * total;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b[0] - a[0], b[2] - a[2], b[1] - a[1]);
    if (want <= seg || i === pts.length - 1) {
      const f = seg > 0 ? want / seg : 0;
      return [
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
        Math.atan2(b[0] - a[0], b[2] - a[2]),
      ];
    }
    want -= seg;
  }
  const last = pts[pts.length - 1];
  return [last[0], last[1], last[2], 0];
}

// ───────────────────────── ตำแหน่งยืน/นอน ในแต่ละห้อง ─────────────────────────
/** ตำแหน่งของเจ้าหน้าที่/เตียงช่องที่ i (ผู้ป่วยที่กำลังรับบริการจะไปอยู่ตรงนี้) */
export function servicePos(key, slot, servers) {
  const r = ROOMS[key];
  if (!r) return [0, 0, 0];
  const [[x1, z1], [x2, z2]] = r.counter;
  // IPD เตียงเยอะ จัดเป็นตาราง ไม่ใช่แถวเดียว
  if (key === 'ipd') {
    const perRow = 24;
    const row = Math.floor(slot / perRow);
    const col = slot % perRow;
    return [
      -31 + col * 1.35,
      FLOOR_Y[r.floor],
      -1 - row * 3.2,
    ];
  }
  const n = Math.max(servers, 1);
  const f = n === 1 ? 0.5 : (slot % n) / (n - 1);
  const x = x1 + (x2 - x1) * f;
  const z = z1 + (z2 - z1) * f;
  if (r.cubicle) {
    // ห้องตรวจ/ห้องเอกซเรย์/ห้องผ่าตัด: คนไข้เข้าไปอยู่ในคูหาด้านใน
    // ไม่ใช่ยืนหน้าเคาน์เตอร์เหมือนจุดบริการแบบเคาน์เตอร์
    const depth = r.size[1] * 0.16;
    return [x - r.qDir[0] * depth, FLOOR_Y[r.floor], z - r.qDir[1] * depth];
  }
  // จุดบริการแบบเคาน์เตอร์: คนไข้ยืนฝั่งคิว เจ้าหน้าที่อยู่อีกฝั่ง
  return [x + r.qDir[0] * 1.1, FLOOR_Y[r.floor], z + r.qDir[1] * 1.1];
}

/** ตำแหน่งคนที่ต่อคิวลำดับที่ idx — ยืดออกจากเคาน์เตอร์ แล้วพับเป็นแถวเมื่อยาวเกิน */
export function queuePos(key, idx) {
  const r = ROOMS[key];
  if (!r) return [0, 0, 0];
  const [[x1, z1], [x2, z2]] = r.counter;
  const mx = (x1 + x2) / 2;
  const mz = (z1 + z2) / 2;
  const len = Math.hypot(x2 - x1, z2 - z1) || 1;
  // ทิศตามแนวเคาน์เตอร์ (สำหรับพับแถว)
  const tx = (x2 - x1) / len;
  const tz = (z2 - z1) / len;
  const perRow = Math.max(3, Math.floor(len / 1.2));
  const row = Math.floor(idx / perRow);
  const col = idx % perRow;
  const back = 2.6 + row * 1.3;              // ห่างจากเคาน์เตอร์
  const side = (col - (perRow - 1) / 2) * 1.2; // เยื้องข้าง
  return [
    mx + r.qDir[0] * back + tx * side,
    FLOOR_Y[r.floor],
    mz + r.qDir[1] * back + tz * side,
  ];
}

/** ที่นั่งรอผลแล็บ/เอกซเรย์ — แยกจากคิว เพราะคนกลุ่มนี้ไม่ได้รออะไรที่เคาน์เตอร์ */
export function resultPos(key, idx) {
  const r = ROOMS[key];
  if (!r) return [0, 0, 0];
  const [[x1, z1], [x2, z2]] = r.counter;
  const mx = (x1 + x2) / 2;
  const mz = (z1 + z2) / 2;
  const col = idx % 8;
  const row = Math.floor(idx / 8);
  return [
    mx + r.qDir[0] * (6.5 + row * 1.2) + (col - 3.5) * 1.1,
    FLOOR_Y[r.floor],
    mz + r.qDir[1] * (6.5 + row * 1.2),
  ];
}

/** มุมกล้องสำเร็จรูปของแต่ละแผนก: [ตำแหน่งกล้อง, จุดที่มอง] */
export function roomCamera(key) {
  const r = ROOMS[key];
  if (!r) return [[0, 48, 56], [0, 0, 0]];
  const [cx, cz] = r.pos;
  const y = FLOOR_Y[r.floor];
  // เข้าใกล้พอที่จะเห็น "ตัวคน" ไม่ใช่เห็นแค่ผังห้อง
  // คนสูง 1.3 ม. ที่ระยะ 50 ม. สูงราว 15 px บนจอ 600 px ซึ่งแยกไม่ออกจากเก้าอี้
  // ที่ระยะ 27 ม. จะได้ราว 28 px เห็นสีและท่าทางได้
  const d = Math.max(r.size[0], r.size[1]) * 0.9 + 6;
  // มุมกดต่ำลง (~28°) เพื่อมองเข้าไปในห้อง ไม่ใช่มองลงมาเห็นแต่พื้น
  return [
    [cx + d * 0.5, y + d * 0.52, cz + d * 0.85],
    [cx, y + 1.3, cz],
  ];
}
