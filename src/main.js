/**
 * main.js — ประกอบทุกส่วนเข้าด้วยกันและเดินลูป
 *
 * ลำดับความเป็นเจ้าของข้อมูล:
 *   sim.js (โมเดลคิว) -> คือความจริง
 *   layout.js         -> พิกัดในอาคาร
 *   building/agents   -> วาดสิ่งที่สองไฟล์บนบอก
 *   hud.js            -> แสดงตัวเลขจากที่เดียวกัน
 * ไม่มีใครย้อนไปแก้โมเดล ตัวเลขกับภาพจึงตรงกันเสมอ
 */

import * as THREE from '../vendor/three.module.js';
import { HospitalSim, SCENARIOS, STATION_DEFS } from './sim.js';
import { ROOMS, roomCamera, BUILDING } from './layout.js';
import { Stage, applyTheme } from './stage.js';
import { Building } from './building.js';
import { Agents } from './agents.js';
import { Staff } from './staff.js';
import { Hud } from './hud.js';

const canvas = document.getElementById('view');

// ───────────────────────── สถานะหน้าเว็บ ─────────────────────────
const app = {
  scenario: 'normal',
  speed: 5,          // นาทีในแบบจำลอง ต่อ 1 วินาทีจริง
  playing: true,
  cutaway: 'roofOff',
  floor: null,       // null = ทุกชั้น
  selected: null,
  followId: null,
  tour: false,
  dragging: false,
};

let sim = new HospitalSim({ cfg: structuredClone(SCENARIOS.normal.cfg) });
applyTheme(); // ต้องเรียกก่อนสร้างฉาก เพราะวัสดุอ่านสีตอนถูกสร้าง
const stage = new Stage(canvas);
const building = new Building(stage);
const agents = new Agents(stage);
const staff = new Staff(stage);

// ───────────────────────── มุมกล้องสำเร็จรูป ─────────────────────────
const CAMS = {
  overview: [[42, 54, 64], [0, 7, -3]],
  top:      [[0.1, 112, 10], [-2, 4, -4]],
  eye:      [[-27, 4.0, 19], [-18, 2.2, 2]],
};

function applyCamera(name) {
  const c = CAMS[name];
  if (c) stage.flyTo(c[0], c[1]);
}

function focusRoom(key) {
  const [pos, target] = roomCamera(key);
  // ห้องชั้น 2 ถูกยกลอยตอนดู 'ทั้งอาคาร' กล้องต้องเล็งตามที่มันอยู่จริงบนจอ
  const lift = ROOMS[key].floor === 1 ? building.liftAmount() : 0;
  stage.flyTo([pos[0], pos[1] + lift, pos[2]], [target[0], target[1] + lift, target[2]], 1.1);
}

// ───────────────────────── ตัวจัดการจากปุ่มต่าง ๆ ─────────────────────────
const handlers = {
  selectDept(k) {
    app.selected = k;
    app.followId = null;
    hud.setSelected(k);
    hud.showPatient(null, sim);
    if (k) {
      // แยกชั้นของแผนกนั้นออกมาเสมอ
      // ตอนดู 'ทั้งอาคาร' ชั้น 2 ลอยอยู่เหนือชั้น 1 พอดี กล้องที่มองลงมาหาห้องชั้น 1
      // จะโดนพื้นหอผู้ป่วยบังมิด — มองทะลุอีกชั้นไม่ได้อยู่แล้ว จึงต้องซ่อนให้
      const f = ROOMS[k].floor;
      handlers.setFloor(f, true);
      hud.setFloorBtn(String(f));
      focusRoom(k);
    } else {
      handlers.setFloor(null, true);
      hud.setFloorBtn('all');
      applyCamera('overview');
    }
    stage.touch();
  },

  setScenario(name) {
    app.scenario = name;
    const sc = SCENARIOS[name];
    rebuild(structuredClone(sc.cfg), sim.t, false);
    hud.setScenarioName(sc.label);
    // สไลเดอร์กำลังคนต้องตามค่าของสถานการณ์ใหม่
    for (const [k, el] of Object.entries(hud.slEls)) {
      if (!STATION_DEFS[k]) continue;
      const v = sim.stations[k].servers;
      el.r.value = String(v);
      el.out.textContent = el.fmt(v);
    }
    // ไม่ตั้งฐานใหม่ เพื่อให้เทียบ 'วันปกติ กับ แพทย์ลา 2 คน' ได้ตรง ๆ
    hud.scheduleCompare();
    stage.touch();
  },

  setCutaway(mode) {
    app.cutaway = mode;
    building.setCutaway(mode);
    stage.touch();
  },

  setFloor(f, quiet) {
    app.floor = f;
    building.setFloor(f);
    if (f !== null) building.setCutaway(app.cutaway === 'solid' ? 'roofOff' : app.cutaway);
    if (!quiet) {
      hud.setFloorBtn(f === null ? 'all' : String(f));
      stage.touch();
    }
  },

  setCamera(name) {
    applyCamera(name);
    stage.touch();
  },

  setSpeed(v) {
    app.speed = v;
    stage.touch();
  },

  togglePlay() {
    app.playing = !app.playing;
    hud.setPlaying(app.playing);
    stage.touch();
  },

  setServers(key, n) {
    // ปรับสด ไม่ต้องรีสตาร์ท — จะเห็นคิวตอบสนองทันที
    sim.setServers(key, n);
    hud.scheduleCompare();   // คำนวณผลทั้งวันใหม่เพื่อเทียบกับฐาน
    stage.touch();
  },

  setCfg(key, v) {
    sim.cfg[key] = v;
    hud.scheduleCompare();
    stage.touch();
  },

  seek(minute) {
    app.dragging = true;
    rebuild(sim.cfg, minute);
    clearTimeout(app._dragT);
    app._dragT = setTimeout(() => { app.dragging = false; }, 350);
    stage.touch();
  },

  follow(id) {
    app.followId = id;
    if (id == null) hud.showPatient(null, sim);
    stage.touch();
  },
};

const hud = new Hud(sim, handlers);

/**
 * สร้างแบบจำลองใหม่แล้วเดินไปถึงเวลาที่ต้องการ
 * ทำได้เพราะตัวสุ่มมี seed คงที่ — เดินกลับไปเวลาเดิมจะได้วันเดิมเป๊ะ ๆ
 */
function rebuild(cfg, toMinute, keepServers = true) {
  // keepServers=true  -> เลื่อนเวลา/รีเฟรช: คงกำลังคนที่ผู้ใช้ตั้งไว้
  // keepServers=false -> สลับสถานการณ์: ใช้กำลังคนของสถานการณ์นั้น
  //   ถ้าคงไว้เสมอ กด "แพทย์ลา 2 คน" จะไม่มีอะไรเกิดขึ้นเลย
  const base = structuredClone(cfg);
  const servers = keepServers ? { ...sim.cfg.servers, ...(base.servers || {}) } : { ...(base.servers || {}) };
  sim = new HospitalSim({ cfg: { ...base, servers } });
  hud.sim = sim;
  const target = Math.max(sim.startMin, Math.min(toMinute, sim.endMin - 0.5));
  let guard = 0;
  while (sim.t < target && sim.step(0.25) && guard++ < 60000) { /* เดินเร็ว ๆ ไปถึงเวลานั้น */ }
  agents.smooth.clear();
  app.followId = null;
}

// ───────────────────────── คลิกเลือกผู้ป่วย ─────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;

canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 5) return; // ลากกล้อง ไม่ใช่คลิกเลือก

  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  // ลำดับความสำคัญ: คลิกโดนตัวคนไข้ -> ติดตามคนนั้น
  //                   ไม่โดนคน แต่โดนพื้นห้อง -> เลือกแผนกนั้น
  //                   ไม่โดนอะไรเลย -> ยกเลิกทั้งหมด
  const p = agents.pick(ray);
  if (p) {
    app.followId = p.id;
    app.selected = null;
    hud.setSelected(null);
    return;
  }
  const roomKey = building.pickRoom(ray);
  if (roomKey) {
    handlers.selectDept(app.selected === roomKey ? null : roomKey);
    return;
  }
  app.followId = null;
  hud.showPatient(null, sim);
});

// ───────────────────────── แป้นพิมพ์ ─────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); handlers.togglePlay(); }
  else if (k === 'r') { handlers.setScenario(app.scenario); }
  else if (k === '1') { handlers.setCutaway('solid'); hud.setCutBtn('solid'); }
  else if (k === '2') { handlers.setCutaway('roofOff'); hud.setCutBtn('roofOff'); }
  else if (k === '3') { handlers.setCutaway('section'); hud.setCutBtn('section'); }
  else if (k === '4') { handlers.setCutaway('xray'); hud.setCutBtn('xray'); }
  else if (k === 'escape') { handlers.selectDept(null); handlers.follow(null); }
  stage.touch();
});

// ───────────────────────── ทัวร์อัตโนมัติ ─────────────────────────
// บทเดียวกับที่คนกดเองได้ทุกปุ่ม — ไม่มีอะไรที่ทัวร์ทำได้แต่ผู้ใช้ทำไม่ได้
const TOUR = [
  { hold: 5.5, act: () => { handlers.setCutaway('roofOff'); hud.setCutBtn('roofOff'); sel(null); } },
  { hold: 4.5, act: () => sel('reg') },
  { hold: 4.0, act: () => sel('triage') },
  { hold: 7.0, act: () => sel('opd') },
  { hold: 4.0, act: () => sel('lab') },
  { hold: 4.0, act: () => sel('pharm') },
  { hold: 4.5, act: () => sel('er') },
  { hold: 5.0, act: () => sel('ipd') },
  { hold: 4.5, act: () => sel('or') },
  { hold: 5.5, act: () => { sel(null); handlers.setCutaway('section'); hud.setCutBtn('section'); } },
  { hold: 5.0, act: () => { handlers.setCutaway('xray'); hud.setCutBtn('xray'); applyCamera('top'); } },
];

function sel(k) {
  handlers.selectDept(k);
}

let tourI = -1;
let tourT = 0;
const IDLE_BEFORE_TOUR = 25; // วินาทีที่ไม่มีใครแตะ แล้วเริ่มพาชมเอง

// ───────────────────────── ลูปหลัก ─────────────────────────
let last = performance.now();
let acc = 0;
let fpsT = 0;
let fpsN = 0;

function loop(now) {
  const dtReal = Math.min((now - last) / 1000, 0.1);
  last = now;

  // ── เดินแบบจำลอง ──
  if (app.playing) {
    let dtSim = app.speed * dtReal;
    // ซอยเป็นก้าวเล็ก ๆ ไม่ให้คนไข้กระโดดข้ามขั้นตอนตอนเร่งความเร็วสูง
    const maxStep = 0.25;
    let guard = 0;
    while (dtSim > 0 && guard++ < 400) {
      const s = Math.min(dtSim, maxStep);
      if (!sim.step(s)) break;
      dtSim -= s;
    }
  }

  // ── ทัวร์อัตโนมัติ ──
  const idle = stage.userHold > IDLE_BEFORE_TOUR;
  if (idle && !app.tour) {
    app.tour = true;
    tourI = -1;
    tourT = 0;
    hud.setTour(true);
  }
  if (!idle && app.tour) {
    app.tour = false;
    hud.setTour(false);
  }
  if (app.tour) {
    tourT -= dtReal;
    if (tourT <= 0) {
      tourI = (tourI + 1) % TOUR.length;
      TOUR[tourI].act();
      tourT = TOUR[tourI].hold;
      // ทัวร์ไม่ควรนับเป็นการแตะของผู้ใช้ ไม่งั้นมันจะปิดตัวเอง
      stage.userHold = IDLE_BEFORE_TOUR + 1;
    }
  }

  // ── กล้องตามผู้ป่วยที่เลือก ──
  if (app.followId != null) {
    const p = sim.patients.find((q) => q.id === app.followId);
    agents.syncRoute(p || null, building.liftAmount());
    if (p) {
      const pos = agents.posOf(app.followId);
      if (pos && !stage.fly) {
        stage.want.target.set(pos[0], pos[1] + 1.2, pos[2]);
        stage.want.dist = Math.min(stage.want.dist, 30);
      }
      hud.showPatient(p, sim);
    } else {
      // คนไข้กลับบ้านไปแล้ว
      app.followId = null;
      hud.showPatient(null, sim);
    }
  } else {
    agents.syncRoute(null, 0);
  }

  // ── วาด ──
  const snap = sim.snapshot();
  building.highlight(app.selected, snap.bottleneck);
  building.updateBoards(snap);
  agents.sync(sim, dtReal, app.followId, app.floor, building.liftAmount());
  staff.sync(sim, app.floor, building.liftAmount());
  stage.update(dtReal);
  stage.render();
  hud.update(snap, { hudEvery: stage.tier.hudEvery, dragging: app.dragging });

  // ── fps ──
  fpsN++;
  fpsT += dtReal;
  if (fpsT >= 1) {
    const fps = Math.round(fpsN / fpsT);
    hud.setFps(fps);
    stage.adapt(fps); // เฟรมตกติดกัน 3 วินาที -> ลดความละเอียดการวาดลงเอง
    fpsN = 0;
    fpsT = 0;
  }

  requestAnimationFrame(loop);
}

// ───────────────────────── เริ่มทำงาน ─────────────────────────
window.addEventListener('resize', () => stage.resize());

building.setCutaway('roofOff');
building.setFloor(null);
hud.setPlaying(true);
hud.setScenarioName(SCENARIOS.normal.label);
applyCamera('overview');
stage.warm();

// เดินไปถึง 07:30 ก่อนแสดง เพื่อให้เฟรมแรกมีคนอยู่ในอาคารแล้ว
// (ถ้าเริ่มที่ 06:00 เป๊ะ อาคารจะว่างเปล่า และ thumbnail จะดูเหมือนหน้าเสีย)
rebuild(sim.cfg, 7 * 60 + 30);

// เปิดให้ตรวจสอบจาก console ได้ — มีประโยชน์ตอนแก้ปัญหาและตอนเอาไปสอน
window.hospital = {
  get sim() { return sim; },
  app, stage, building, agents, staff, hud,
  // เช่น: hospital.debug() ดูว่าตอนนี้วาดคนกี่ตัว และคนแรกอยู่ที่ไหน
  debug() {
    const p0 = sim.patients[0];
    return {
      clock: sim.clock,
      patientsInModel: sim.patients.length,
      instancesDrawn: agents.mesh.count,
      meshVisible: agents.mesh.visible,
      floorFilter: app.floor,
      lift: building.liftAmount(),
      first: p0 ? { id: p0.id, state: p0.state, at: p0.at, to: p0.to, pos: agents.posOf(p0.id) } : null,
      camDist: stage.cam.dist,
      staffDrawn: staff.body.count,
      props: building.propStats,
    };
  },
};

// ซ่อนหน้าโหลดทันทีที่ของพร้อม ไม่ผูกกับ requestAnimationFrame
// ถ้าผูกไว้ แล้วมีคนเปิดหน้านี้ค้างไว้ในแท็บพื้นหลัง เบราว์เซอร์จะระงับ rAF
// คนนั้นจะเห็นหน้าโหลดค้างตลอดไปทั้งที่แบบจำลองพร้อมแล้ว
const load = document.getElementById('load');
if (load) {
  load.classList.add('off');
  setTimeout(() => load.remove(), 500);
}

requestAnimationFrame((t) => {
  last = t;
  loop(t);
});
