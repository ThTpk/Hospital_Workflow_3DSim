/**
 * sim.js — โมเดลคิวของโรงพยาบาล (discrete-event, fixed timestep)
 *
 * ไฟล์นี้ "ไม่มี three.js" โดยเจตนา: มันคือแหล่งความจริงเดียว (single source of truth)
 * ทั้งตำแหน่งที่คนไข้ควรอยู่ และตัวเลขทุกตัวบน panel อ่านจากที่นี่ที่เดียว
 * ภาพกับตัวเลขจึงขัดแย้งกันไม่ได้
 *
 * หน่วยเวลาภายใน = นาที (sim-minute) นับจากเที่ยงคืน 00:00
 */

import { walkPath, pathLength } from './layout.js';

// ───────────────────────── สุ่มแบบกำหนด seed ได้ (deterministic) ─────────────────────────
// mulberry32: เบา เร็ว และ seed เดิมให้ผลเดิมทุกครั้ง -> กดรีเซ็ตแล้วได้ "วันเดิม" ซ้ำได้
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** แจกแจงแบบ lognormal — เวลาบริการจริงเบ้ขวา (คนส่วนใหญ่เร็ว บางคนนานมาก) */
function lognormal(rand, mean, cv = 0.45) {
  const sigma2 = Math.log(1 + cv * cv);
  const sigma = Math.sqrt(sigma2);
  const mu = Math.log(Math.max(mean, 1e-6)) - sigma2 / 2;
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.exp(mu + sigma * z);
}

// ───────────────────────── จุดบริการ ─────────────────────────
// ตัวเลขตั้งต้นอ้างอิงโรงพยาบาลทั่วไปขนาดกลางของไทย (~480 ผู้ป่วยนอก/วัน, ~120 เตียง)
// ทุกค่าปรับได้จาก UI — ถือเป็นสมมติฐานที่ตั้งไว้ ไม่ใช่ค่าที่วัดจากโรงพยาบาลจริงแห่งใด
//
// การกำหนดกำลังรับ (capacity sizing) — คิดจากภาระงานจริง ไม่ใช่เดา:
//   ผู้ป่วยนอก 480 คน/วัน, พีค 86 คน/ชม. ช่วง 08:00
//   ผู้ป่วย 1 คนพบแพทย์เฉลี่ย ~1.45 ครั้ง (เพราะ 45% ถูกส่งตรวจแล้วกลับมาฟังผล)
//   -> ภาระแพทย์ = 480 x 1.45 x 6 นาที = 4,176 นาที/วัน
//   -> หารด้วยเวลาทำการ 540 นาที (07:00-16:00) = ต้องมีแพทย์ 7.7 คน
//   ตั้ง 8 คน -> utilization ~67%, รอเฉลี่ย ~20 นาที ซึ่งตรงกับ OPD รัฐของไทย
//   และอยู่ใต้ 'หน้าผาความอิ่มตัว' พอดี: ลดเหลือ 6 คน เวลารอพุ่งเป็นเท่าตัวทันที
// แต่ละจุดต้องรับพีค 86 คน/ชม. ได้: servers x (60/service) >= 86
export const STATION_DEFS = {
  reg:     { key: 'reg',     label: 'เวชระเบียน',    short: 'REG', servers: 4,  service: 2.5,  floor: 0, kind: 'opd' },
  triage:  { key: 'triage',  label: 'คัดกรอง',       short: 'TRI', servers: 5,  service: 3.0,  floor: 0, kind: 'opd' },
  opd:     { key: 'opd',     label: 'OPD ตรวจโรค',   short: 'OPD', servers: 8,  service: 6.0,  floor: 0, kind: 'opd' },
  lab:     { key: 'lab',     label: 'ห้องปฏิบัติการ', short: 'LAB', servers: 4,  service: 6.0,  floor: 0, kind: 'diag', resultDelay: 22 },
  xray:    { key: 'xray',    label: 'X-ray',         short: 'XR',  servers: 3,  service: 7.0,  floor: 0, kind: 'diag', resultDelay: 12 },
  pharm:   { key: 'pharm',   label: 'ห้องยา',         short: 'PHM', servers: 6,  service: 4.0,  floor: 0, kind: 'opd' },
  cashier: { key: 'cashier', label: 'การเงิน',        short: 'CSH', servers: 4,  service: 2.0,  floor: 0, kind: 'opd' },
  er:      { key: 'er',      label: 'ER ฉุกเฉิน',    short: 'ER',  servers: 6,  service: 38.0, floor: 0, kind: 'er', priority: true },
  ipd:     { key: 'ipd',     label: 'IPD หอผู้ป่วย',  short: 'IPD', servers: 120, service: 4320, floor: 1, kind: 'ward' },
  or:      { key: 'or',      label: 'ห้องผ่าตัด',     short: 'OR',  servers: 3,  service: 95.0, floor: 1, kind: 'ward' },
};

export const STATION_KEYS = Object.keys(STATION_DEFS);

// ───────────────────────── รูปแบบการมาของผู้ป่วย ─────────────────────────
// โปรไฟล์ไทย: คนมารอตั้งแต่ก่อนเปิด พีคแรง 07:00-09:00 แล้วลดลงชัดเจนหลังเที่ยง
// index = ชั่วโมง (0..23), ค่า = ผู้ป่วยนอกต่อชั่วโมง
const OPD_ARRIVALS = [
  0, 0, 0, 0, 0, 6,
  42, 72, 86, 70, 50, 34,
  18, 30, 27, 19, 11, 4,
  0, 0, 0, 0, 0, 0,
];
// ER มาตลอด 24 ชม. ค่อนข้างสม่ำเสมอ สูงขึ้นช่วงหัวค่ำ
const ER_ARRIVALS = [
  2, 1.5, 1.2, 1, 1, 1.4,
  2, 2.6, 3, 3.2, 3.2, 3,
  3, 3, 3.2, 3.4, 3.8, 4.4,
  4.6, 4.2, 3.6, 3.2, 2.8, 2.4,
];

function rateAt(profile, minuteOfDay) {
  const h = Math.floor(minuteOfDay / 60) % 24;
  const nh = (h + 1) % 24;
  const f = (minuteOfDay % 60) / 60;
  // interpolate เพื่อให้อัตราไม่กระโดดเป็นขั้นบันไดทุกต้นชั่วโมง
  return profile[h] * (1 - f) + profile[nh] * f;
}

// ───────────────────────── สถานะผู้ป่วย ─────────────────────────
export const ST = {
  WALK: 'walk',       // กำลังเดินระหว่างจุด
  QUEUE: 'queue',     // ต่อคิวอยู่
  SERVICE: 'service', // กำลังรับบริการ
  RESULT: 'result',   // รอผลแล็บ/เอกซเรย์
  LEFT: 'left',       // ออกจากระบบแล้ว
};

// ความเร็วเดินในโรงพยาบาล (เมตร/นาที) — คนป่วยเดินช้ากว่าคนปกติ (~1.25 m/s = 75 m/min)
const WALK_SPEED = 72;

// ความละเอียดของ histogram เวลารอ
export const WAIT_BUCKET_MIN = 2;      // นาทีต่อช่อง
export const WAIT_BUCKETS = 61;        // ช่อง 0..59 = 0-120 นาที, ช่อง 60 = เกิน 120

/**
 * เวลาเดินจาก A ไป B — คิดจากระยะทางจริงบนผังอาคาร ไม่ใช่ค่าคงที่
 * ทำให้นาฬิกาในโมเดลกับตำแหน่งที่วาดใน 3D ตรงกันเสมอ: คนเดิน 85 ม. ใช้เวลานานกว่าคนเดิน 12 ม. จริง
 */
function walkTime(rand, fromKey, toKey) {
  const metres = pathLength(walkPath(fromKey, toKey));
  const pace = 0.78 + rand() * 0.52; // ความต่างระหว่างบุคคล: ผู้สูงอายุ/ใช้ไม้เท้าช้ากว่า
  return Math.max(metres / (WALK_SPEED * pace), 0.1);
}

let _uid = 1;

// ───────────────────────── ตัวจำลอง ─────────────────────────
export class HospitalSim {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 20261119;
    this.startMin = opts.startMin ?? 6 * 60;  // เริ่มจำลอง 06:00
    this.endMin = opts.endMin ?? 18 * 60;     // ถึง 18:00
    this.cfg = {
      opdScale: 1.0,   // ตัวคูณจำนวนผู้ป่วยนอก
      erScale: 1.0,    // ตัวคูณจำนวนผู้ป่วย ER
      pLab: 0.34,      // สัดส่วน OPD ที่ถูกส่งตรวจแล็บ
      pXray: 0.16,     // สัดส่วน OPD ที่ถูกส่งเอกซเรย์
      pAdmit: 0.055,   // สัดส่วน OPD ที่ถูกรับไว้เป็นผู้ป่วยใน
      pErAdmit: 0.28,  // สัดส่วน ER ที่ถูกรับไว้
      pErOR: 0.11,     // สัดส่วน ER ที่เข้าห้องผ่าตัด
      // เหตุการณ์พุ่งแบบมีช่วงเวลา เช่น อุบัติเหตุหมู่ (ไม่ใช่ตัวคูณทั้งวัน)
      // { lane:'er', from:นาที, to:นาที, perHour:คนต่อชั่วโมงที่เพิ่มขึ้น }
      surge: null,
      ...(opts.cfg || {}),
    };
    this.cfg.servers = { ...(opts.cfg && opts.cfg.servers) };
    this.reset();
  }

  reset() {
    this.rand = rng(this.seed);
    this.t = this.startMin;
    this.patients = [];
    this.stations = {};
    for (const k of STATION_KEYS) {
      const d = STATION_DEFS[k];
      this.stations[k] = {
        def: d,
        servers: this.cfg.servers[k] ?? d.servers,
        queue: [],       // ผู้ป่วยที่รออยู่
        inService: [],   // ผู้ป่วยที่กำลังรับบริการ
        waitingResult: [], // ออกจากเครื่องแล้ว แต่รอผล
        servedCount: 0,
        busyMinutes: 0,  // สะสมเวลาที่ server ถูกใช้ -> คำนวณ utilization
        waitSum: 0,
        waitCount: 0,
        maxQueue: 0,
        maxWait: 0,
        // การกระจายเวลารอ ช่องละ 2 นาที 0..120 และช่องสุดท้ายคือ 120 นาทีขึ้นไป
        // ค่าเฉลี่ยอย่างเดียวบังความจริงได้: เฉลี่ย 20 นาทีอาจแปลว่าทุกคนรอ 20 นาที
        // หรือครึ่งหนึ่งไม่รอเลยและอีกครึ่งรอ 40 นาที ซึ่งคนละเรื่องกันสิ้นเชิง
        waitHist: new Int32Array(WAIT_BUCKETS),
      };
    }
    this.history = [];  // snapshot ทุก 5 นาที สำหรับกราฟ
    this.histAccum = 0;
    this.arrivalDebt = { opd: 0, er: 0 };
    this.totals = { arrived: 0, left: 0, admitted: 0, losSum: 0, losCount: 0 };
    this._pushHistory();
  }

  get clock() {
    const m = Math.floor(this.t) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  setServers(key, n) {
    const s = this.stations[key];
    if (!s) return;
    this.cfg.servers[key] = n;
    s.servers = n;
  }

  // ───────── การเดินของเวลา ─────────
  /** เดินหน้า dt นาที (dt เล็ก เช่น 0.2) */
  step(dt) {
    if (this.t >= this.endMin) return false;
    this.t += dt;
    this._arrive(dt);
    this._finishService();
    this._walk(dt);
    this._dispatch();
    this._accrue(dt);
    this.histAccum += dt;
    if (this.histAccum >= 5) {
      this.histAccum = 0;
      this._pushHistory();
    }
    return true;
  }

  _arrive(dt) {
    // กระบวนการพัวซงแบบไม่คงที่ (non-homogeneous Poisson) ด้วยวิธีสะสมเศษ
    const lanes = [
      ['opd', rateAt(OPD_ARRIVALS, this.t) * this.cfg.opdScale],
      ['er', rateAt(ER_ARRIVALS, this.t) * this.cfg.erScale],
    ];
    // เหตุการณ์พุ่ง: เพิ่มอัตราเฉพาะช่วงเวลาที่กำหนด แล้วหายไป
    const sg = this.cfg.surge;
    if (sg && this.t >= sg.from && this.t < sg.to) {
      const lane = lanes.find((l) => l[0] === sg.lane);
      if (lane) lane[1] += sg.perHour;
    }
    for (const [lane, perHour] of lanes) {
      this.arrivalDebt[lane] += (perHour / 60) * dt;
      while (this.arrivalDebt[lane] >= 1) {
        this.arrivalDebt[lane] -= 1;
        this._spawn(lane);
      }
    }
  }

  _spawn(lane) {
    const isER = lane === 'er';
    // ระดับคัดแยก ER 1=วิกฤต ... 5=ไม่ฉุกเฉิน (อิงแนวคิด ESI)
    const r = this.rand();
    const esi = isER ? (r < 0.04 ? 1 : r < 0.18 ? 2 : r < 0.52 ? 3 : r < 0.84 ? 4 : 5) : 0;
    const p = {
      id: _uid++,
      lane,
      esi,
      tArrive: this.t,
      state: ST.WALK,
      at: null,         // จุดบริการปัจจุบัน
      from: isER ? 'gate_er' : 'gate_opd',
      to: isER ? 'er' : 'reg',
      walkT: 0,
      walkDur: walkTime(this.rand, isER ? 'gate_er' : 'gate_opd', isER ? 'er' : 'reg'),
      tEnterQueue: 0,
      tServiceEnd: 0,
      slot: -1,         // ช่องที่ยืน/นอน ใช้วางตำแหน่งใน 3D
      queueIdx: -1,
      needLab: false,
      needXray: false,
      didLab: false,
      didXray: false,
      revisit: false,   // กลับมาพบแพทย์รอบสอง
      admitted: false,
      path: [],         // ประวัติ: [{key, tIn, tOut, wait}]
      waitTotal: 0,
    };
    if (isER) {
      p.needLab = this.rand() < 0.62;
      p.needXray = this.rand() < 0.45;
    } else {
      p.needLab = this.rand() < this.cfg.pLab;
      p.needXray = this.rand() < this.cfg.pXray;
    }
    this.patients.push(p);
    this.totals.arrived++;
  }

  _walk(dt) {
    for (const p of this.patients) {
      if (p.state !== ST.WALK) continue;
      p.walkT += dt;
      if (p.walkT < p.walkDur) continue;
      if (p.to === 'exit') {
        this._depart(p);
        continue;
      }
      p.state = ST.QUEUE;
      p.at = p.to;
      p.tEnterQueue = this.t;
      const s = this.stations[p.at];
      s.queue.push(p);
      // ER จัดคิวตามความรุนแรงก่อน แล้วจึงตามเวลามาถึง
      if (s.def.priority) s.queue.sort((a, b) => a.esi - b.esi || a.tEnterQueue - b.tEnterQueue);
      s.queue.forEach((q, i) => { q.queueIdx = i; });
      if (s.queue.length > s.maxQueue) s.maxQueue = s.queue.length;
    }
  }

  _dispatch() {
    for (const k of STATION_KEYS) {
      const s = this.stations[k];
      while (s.inService.length < s.servers && s.queue.length > 0) {
        const p = s.queue.shift();
        s.queue.forEach((q, i) => { q.queueIdx = i; });
        const wait = this.t - p.tEnterQueue;
        p.waitTotal += wait;
        s.waitSum += wait;
        s.waitCount++;
        if (wait > s.maxWait) s.maxWait = wait;
        s.waitHist[Math.min(Math.floor(wait / WAIT_BUCKET_MIN), WAIT_BUCKETS - 1)]++;
        p.state = ST.SERVICE;
        p.queueIdx = -1;
        // ER: ยิ่งวิกฤตยิ่งใช้เวลารักษานาน
        const sev = s.def.priority ? ([1, 2.0, 1.5, 1.0, 0.7, 0.5][p.esi] ?? 1) : 1;
        p.tServiceEnd = this.t + lognormal(this.rand, s.def.service * sev, k === 'ipd' ? 0.6 : 0.45);
        p.slot = this._takeSlot(s);
        p.path.push({ key: k, tIn: this.t, wait });
        s.inService.push(p);
      }
    }
  }

  _takeSlot(s) {
    const used = new Set(s.inService.map((q) => q.slot));
    for (let i = 0; i < s.servers + 4; i++) if (!used.has(i)) return i;
    return 0;
  }

  _finishService() {
    for (const k of STATION_KEYS) {
      const s = this.stations[k];
      // 1) คนที่รับบริการเสร็จ
      for (let i = s.inService.length - 1; i >= 0; i--) {
        const p = s.inService[i];
        if (this.t < p.tServiceEnd) continue;
        s.inService.splice(i, 1);
        s.servedCount++;
        const rec = p.path[p.path.length - 1];
        if (rec) rec.tOut = this.t;
        // แล็บ/เอกซเรย์: ออกจากเครื่องแล้วยังต้องรอผล (ไม่กินเจ้าหน้าที่แล้ว)
        if (s.def.resultDelay) {
          p.state = ST.RESULT;
          p.at = k;
          p.slot = -1;
          p.tServiceEnd = this.t + lognormal(this.rand, s.def.resultDelay, 0.35);
          s.waitingResult.push(p);
        } else {
          this._route(p, k);
        }
      }
      // 2) คนที่ผลออกแล้ว
      for (let i = s.waitingResult.length - 1; i >= 0; i--) {
        const p = s.waitingResult[i];
        if (this.t < p.tServiceEnd) continue;
        s.waitingResult.splice(i, 1);
        this._route(p, k);
      }
    }
  }

  /** เส้นทางผู้ป่วย — หัวใจของ workflow */
  _route(p, done) {
    if (done === 'lab') p.didLab = true;
    if (done === 'xray') p.didXray = true;

    let next = 'exit';
    if (p.lane === 'opd') {
      if (done === 'reg') next = 'triage';
      else if (done === 'triage') next = 'opd';
      else if (done === 'opd') {
        if (p.needLab && !p.didLab) next = 'lab';
        else if (p.needXray && !p.didXray) next = 'xray';
        else if (!p.revisit && (p.didLab || p.didXray)) { p.revisit = true; next = 'opd'; }
        else if (this.rand() < this.cfg.pAdmit) { next = 'ipd'; this._admit(p); }
        else next = 'pharm';
      } else if (done === 'lab' || done === 'xray') {
        if (p.needXray && !p.didXray) next = 'xray';
        else {
          // กลับไปฟังผลกับแพทย์ — ติดธงตรงนี้ ไม่ใช่ตอนถึง opd
          // ถ้าติดธงตอนถึง opd คนที่ไปทั้ง lab และ xray จะถูกส่งเข้าพบแพทย์ซ้ำสองรอบ
          p.revisit = true;
          next = 'opd';
        }
      } else if (done === 'pharm') next = 'cashier';
      else if (done === 'cashier') next = 'exit';
      else if (done === 'ipd') next = 'exit';
    } else {
      if (done === 'er') {
        if (p.needLab && !p.didLab) next = 'lab';
        else if (p.needXray && !p.didXray) next = 'xray';
        else {
          const r = this.rand();
          if (r < this.cfg.pErOR) { next = 'or'; this._admit(p); }
          else if (r < this.cfg.pErOR + this.cfg.pErAdmit) { next = 'ipd'; this._admit(p); }
          else next = 'pharm';
        }
      } else if (done === 'lab' || done === 'xray') {
        if (p.needXray && !p.didXray) next = 'xray';
        else next = 'er';
      } else if (done === 'or') next = 'ipd';
      else if (done === 'ipd') next = 'exit';
      else if (done === 'pharm') next = 'cashier';
      else if (done === 'cashier') next = 'exit';
    }

    p.state = ST.WALK;
    p.from = done;
    p.to = next;
    p.at = null;
    p.slot = -1;
    p.walkT = 0;
    p.walkDur = walkTime(this.rand, done, next);
  }

  /** รับไว้เป็นผู้ป่วยใน — นับครั้งเดียวต่อคน (ER -> OR -> IPD ต้องไม่นับสองรอบ) */
  _admit(p) {
    if (!p.admitted) {
      p.admitted = true;
      this.totals.admitted++;
    }
  }

  _depart(p) {
    p.state = ST.LEFT;
    this.totals.left++;
    this.totals.losSum += this.t - p.tArrive;
    this.totals.losCount++;
    const i = this.patients.indexOf(p);
    if (i >= 0) this.patients.splice(i, 1);
  }

  _accrue(dt) {
    for (const k of STATION_KEYS) {
      const s = this.stations[k];
      s.busyMinutes += s.inService.length * dt;
    }
  }

  _pushHistory() {
    const row = { t: this.t, q: {}, u: {}, inHouse: this.patients.length };
    for (const k of STATION_KEYS) {
      row.q[k] = this.stations[k].queue.length;
      row.u[k] = this.util(k);
    }
    this.history.push(row);
    if (this.history.length > 400) this.history.shift();
  }

  // ───────── ตัวเลขสำหรับ panel ─────────
  /** อัตราการใช้งานกำลังคน 0..1 */
  util(k) {
    const s = this.stations[k];
    const elapsed = Math.max(this.t - this.startMin, 1e-6);
    return Math.min(s.busyMinutes / (elapsed * Math.max(s.servers, 1)), 1);
  }

  /** เวลารอเฉลี่ยของคนที่ได้รับบริการแล้ว (นาที) */
  avgWait(k) {
    const s = this.stations[k];
    return s.waitCount ? s.waitSum / s.waitCount : 0;
  }

  /** คิวที่กำลังรออยู่ตอนนี้ */
  queueLen(k) {
    return this.stations[k].queue.length;
  }

  /** เวลารอของคนที่หัวคิวตอนนี้ (นาที) */
  headWait(k) {
    const q = this.stations[k].queue;
    return q.length ? this.t - q[0].tEnterQueue : 0;
  }

  avgLOS() {
    return this.totals.losCount ? this.totals.losSum / this.totals.losCount : 0;
  }

  /**
   * เปอร์เซ็นไทล์ของเวลารอ เช่น pct('opd', 0.9) = 90% ของคนรอไม่เกินกี่นาที
   * ค่ามัธยฐาน (p50) กับ p90 คือตัวที่ใช้ตัดสินใจจริง ไม่ใช่ค่าเฉลี่ย
   */
  waitPercentile(k, p) {
    const h = this.stations[k].waitHist;
    const total = this.stations[k].waitCount;
    if (!total) return 0;
    const want = total * p;
    let cum = 0;
    for (let i = 0; i < h.length; i++) {
      cum += h[i];
      if (cum >= want) return (i + 0.5) * WAIT_BUCKET_MIN;
    }
    return WAIT_BUCKETS * WAIT_BUCKET_MIN;
  }

  /** สำเนา histogram เพื่อเอาไปวาดกราฟ */
  waitHistogram(k) {
    return Array.from(this.stations[k].waitHist);
  }

  /** จุดที่เป็นคอขวดที่สุดตอนนี้ — ใช้ชี้ callout ใน 3D */
  bottleneck() {
    // ต้องมีคิวจริงหรือคนรอจริงก่อน ถึงจะเรียกว่าคอขวด
    // ไม่ใส่เกณฑ์นี้ ตอนคิวสลายหมดแล้วสูตรจะไปตัดสินด้วย utilization เพียว ๆ
    // แล้วชี้ไปที่แผนกที่ว่างอยู่ ซึ่งเป็นสัญญาณหลอก
    let best = null;
    let score = 0;
    for (const k of STATION_KEYS) {
      if (k === 'ipd') continue; // หอผู้ป่วยวัดด้วยเตียงเต็ม ไม่ใช่คิว
      const s = this.stations[k];
      const q = s.queue.length;
      const hw = this.headWait(k);
      if (q < 3 && hw < 5) continue;
      const sc = q + hw * 0.25 + this.util(k) * 6;
      if (sc > score) {
        score = sc;
        best = k;
      }
    }
    return best; // null = ยังไม่มีคอขวด
  }

  snapshot() {
    const per = {};
    for (const k of STATION_KEYS) {
      const s = this.stations[k];
      per[k] = {
        label: s.def.label,
        short: s.def.short,
        servers: s.servers,
        queue: s.queue.length,
        busy: s.inService.length,
        result: s.waitingResult.length,
        util: this.util(k),
        avgWait: this.avgWait(k),
        headWait: this.headWait(k),
        maxWait: s.maxWait,
        maxQueue: s.maxQueue,
        served: s.servedCount,
        p50: this.waitPercentile(k, 0.5),
        p90: this.waitPercentile(k, 0.9),
      };
    }
    return {
      t: this.t,
      clock: this.clock,
      per,
      inHouse: this.patients.length,
      arrived: this.totals.arrived,
      left: this.totals.left,
      admitted: this.totals.admitted,
      avgLOS: this.avgLOS(),
      bottleneck: this.bottleneck(),
    };
  }
}

/**
 * รันทั้งวันจบในครั้งเดียวแล้วคืนผลสรุป — ใช้สำหรับเทียบสถานการณ์
 *
 * เทียบ "คิว ณ วินาทีนี้" ไม่มีประโยชน์เพราะมันแกว่งตลอดเวลา
 * คำถามจริงคือ "ถ้าเพิ่มแพทย์ 2 คน ทั้งวันจะดีขึ้นแค่ไหน" ซึ่งต้องรันจบวันถึงจะตอบได้
 * ตัวสุ่มมี seed คงที่ ผลจึงเทียบกันได้ตรง ๆ: ต่างกันเพราะกำลังคนต่าง ไม่ใช่เพราะดวง
 */
export function runDay(cfg, seed) {
  const s = new HospitalSim({ seed, cfg: structuredClone(cfg || {}) });
  let guard = 0;
  while (s.step(0.25) && guard++ < 100000) { /* เดินให้จบวัน */ }

  const per = {};
  for (const k of STATION_KEYS) {
    const st = s.stations[k];
    per[k] = {
      label: st.def.label,
      short: st.def.short,
      servers: st.servers,
      served: st.servedCount,
      util: s.util(k),
      avgWait: s.avgWait(k),
      p50: s.waitPercentile(k, 0.5),
      p90: s.waitPercentile(k, 0.9),
      maxWait: st.maxWait,
      maxQueue: st.maxQueue,
      hist: Array.from(st.waitHist),
    };
  }
  return {
    arrived: s.totals.arrived,
    left: s.totals.left,
    admitted: s.totals.admitted,
    avgLOS: s.avgLOS(),
    stillIn: s.patients.length,
    history: s.history.map((r) => ({ t: r.t, q: { ...r.q }, u: { ...r.u }, inHouse: r.inHouse })),
    per,
  };
}

// ───────────────────────── สถานการณ์สำเร็จรูป ─────────────────────────
export const SCENARIOS = {
  normal:  { label: 'วันปกติ',       cfg: {} },
  monday:  { label: 'เช้าวันจันทร์', cfg: { opdScale: 1.45 } },
  mci: {
    label: 'อุบัติเหตุหมู่',
    // รถบัสคว่ำ 09:00 — ผู้บาดเจ็บมาพร้อมกันใน 40 นาที แล้วหยุด
    cfg: {
      surge: { lane: 'er', from: 9 * 60, to: 9 * 60 + 40, perHour: 40 },
      pErAdmit: 0.42,
      pErOR: 0.22,
    },
  },
  shortDr: { label: 'แพทย์ลา 2 คน',  cfg: { servers: { opd: 6 } } },
};
