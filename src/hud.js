/**
 * hud.js — panel ตัวเลขและกราฟ
 *
 * ทุกค่าที่แสดงมาจาก sim.snapshot() และ sim.history เท่านั้น
 * ไม่มีการคำนวณสถิติซ้ำที่นี่ เพื่อไม่ให้ตัวเลขบนจอขัดกับการเคลื่อนไหวใน 3D
 */

import { STATION_KEYS, STATION_DEFS, SCENARIOS, runDay, WAIT_BUCKET_MIN, WAIT_BUCKETS } from './sim.js';
import { PATIENT_LEGEND } from './agents.js';
import { STAFF_LEGEND } from './staff.js';

const $ = (id) => document.getElementById(id);

/**
 * ดาวน์โหลดเป็นไฟล์ CSV
 * ใส่ BOM นำหน้าเพราะ Excel บน Windows จะอ่านภาษาไทยเป็นตัวยึกยือถ้าไม่มี
 */
function downloadCSV(name, rows) {
  const NEEDS_QUOTE = new RegExp('[",\\r\\n]');
  const esc = (v) => {
    const t = String(v ?? '');
    return NEEDS_QUOTE.test(t) ? '"' + t.split('"').join('""') + '"' : t;
  };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

function mins(v) {
  if (!isFinite(v) || v <= 0) return '—';
  if (v < 60) return `${v.toFixed(0)} น.`;
  return `${Math.floor(v / 60)} ชม. ${String(Math.round(v % 60)).padStart(2, '0')} น.`;
}

/** สไลเดอร์ที่ให้ปรับได้ — เลือกเฉพาะจุดที่การเพิ่มคนมีความหมายจริง */
const TUNABLE = [
  { key: 'opd', min: 3, max: 16, label: 'แพทย์ OPD' },
  { key: 'reg', min: 1, max: 10, label: 'เวชระเบียน' },
  { key: 'triage', min: 1, max: 10, label: 'พยาบาลคัดกรอง' },
  { key: 'pharm', min: 1, max: 12, label: 'เภสัชกร' },
  { key: 'cashier', min: 1, max: 10, label: 'การเงิน' },
  { key: 'lab', min: 1, max: 10, label: 'ช่างเทคนิคแล็บ' },
  { key: 'xray', min: 1, max: 8, label: 'ห้องเอกซเรย์' },
  { key: 'er', min: 2, max: 16, label: 'เตียง ER' },
  { key: 'or', min: 1, max: 8, label: 'ห้องผ่าตัด' },
];

export class Hud {
  constructor(sim, handlers) {
    this.sim = sim;
    this.h = handlers;
    this.selected = null;
    this.chartKey = 'opd';
    this.frame = 0;
    this._buildLegend();
    this._buildDepts();
    this._buildSliders();
    this._buildButtons();
    this._initCharts();
    this._buildCompare();
  }

  // ───────── คำอธิบายสี ─────────
  /**
   * สร้างจากค่าสีจริงใน agents.js และ staff.js
   * ไม่พิมพ์ชื่อสีซ้ำไว้ที่นี่ เพราะวันที่แก้สีแล้วลืมแก้คำอธิบาย
   * หน้าเว็บจะโกหกคนดูโดยไม่มีใครรู้
   */
  _buildLegend() {
    const host = $('legend');
    if (!host) return;
    const hex = (v) => `#${v.toString(16).padStart(6, '0')}`;

    const row = (title, items) => {
      const d = document.createElement('div');
      d.className = 'lgrow';
      d.innerHTML = `<span class="lgk">${title}</span>` + items.map((it) => {
        const bg = it.to
          ? `background:linear-gradient(135deg,${hex(it.hex)},${hex(it.to)})`
          : `background:${hex(it.hex)}`;
        const note = it.note ? ` <span class="lgn">(${it.note})</span>` : '';
        return `<span class="lgi"><i class="lgs" style="${bg}"></i>${it.label}${note}</span>`;
      }).join('');
      return d;
    };

    host.innerHTML = '';
    host.appendChild(row('ผู้ป่วย', PATIENT_LEGEND));
    const staffRow = row('เจ้าหน้าที่', STAFF_LEGEND);
    staffRow.insertAdjacentHTML('beforeend',
      '<span class="lgi"><i class="lgs" style="background:var(--accent)"></i>ห้องเรืองแสง = คอขวด</span>');
    host.appendChild(staffRow);
  }

  // ───────── รายการแผนก ─────────
  _buildDepts() {
    const host = $('dlist');
    host.innerHTML = '';
    this.deptEls = {};
    for (const k of STATION_KEYS) {
      const d = STATION_DEFS[k];
      const b = document.createElement('button');
      b.className = 'dept';
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML =
        `<div class="dr1"><span class="dn">${d.label}</span><span class="dq">0</span></div>` +
        `<div class="bar"><i style="width:0%"></i></div>` +
        `<div class="dr2"><span class="w">รอ —</span><span class="u">0%</span></div>`;
      b.addEventListener('click', () => this.h.selectDept(this.selected === k ? null : k));
      host.appendChild(b);
      this.deptEls[k] = {
        root: b,
        q: b.querySelector('.dq'),
        bar: b.querySelector('.bar i'),
        w: b.querySelector('.w'),
        u: b.querySelector('.u'),
      };
    }
  }

  // ───────── สไลเดอร์กำลังคน ─────────
  _buildSliders() {
    const host = $('slist');
    host.innerHTML = '';
    this.slEls = {};

    // จำนวนผู้ป่วยนอกที่เข้ามา
    const mk = (label, id, min, max, step, val, fmt, on) => {
      const wrap = document.createElement('div');
      wrap.className = 'sl';
      wrap.innerHTML = `<div class="slr"><span>${label}</span><b id="v_${id}">${fmt(val)}</b></div>`;
      const r = document.createElement('input');
      r.type = 'range';
      r.min = min; r.max = max; r.step = step; r.value = val;
      r.setAttribute('aria-label', label);
      wrap.appendChild(r);
      host.appendChild(wrap);
      const out = wrap.querySelector(`#v_${id}`);
      r.addEventListener('input', () => {
        const v = parseFloat(r.value);
        out.textContent = fmt(v);
        on(v);
      });
      return { r, out, fmt };
    };

    this.slEls.opdScale = mk('ผู้ป่วยนอกเข้า', 'opdScale', 0.4, 2.2, 0.05, 1,
      (v) => `${Math.round(480 * v)} คน/วัน`, (v) => this.h.setCfg('opdScale', v));
    this.slEls.erScale = mk('ผู้ป่วย ER เข้า', 'erScale', 0.2, 6, 0.1, 1,
      (v) => `x${v.toFixed(1)}`, (v) => this.h.setCfg('erScale', v));
    this.slEls.pLab = mk('ส่งตรวจแล็บ', 'pLab', 0, 0.8, 0.02, 0.34,
      (v) => `${Math.round(v * 100)}%`, (v) => this.h.setCfg('pLab', v));

    for (const t of TUNABLE) {
      const def = STATION_DEFS[t.key];
      this.slEls[t.key] = mk(t.label, t.key, t.min, t.max, 1, def.servers,
        (v) => `${v}`, (v) => this.h.setServers(t.key, v));
    }
  }

  // ───────── ปุ่มทั้งหมด ─────────
  _buildButtons() {
    const mkGroup = (hostId, items, onPick, initial, danger) => {
      const host = $(hostId);
      host.innerHTML = '';
      const els = [];
      for (const [val, label] of items) {
        const b = document.createElement('button');
        b.className = 'b' + (danger && val === danger ? ' danger' : '');
        b.type = 'button';
        b.textContent = label;
        b.setAttribute('aria-pressed', String(val === initial));
        b.addEventListener('click', () => {
          onPick(val);
          els.forEach(([v, e]) => e.setAttribute('aria-pressed', String(v === val)));
        });
        host.appendChild(b);
        els.push([val, b]);
      }
      return (val) => els.forEach(([v, e]) => e.setAttribute('aria-pressed', String(v === val)));
    };

    this.setScenBtn = mkGroup('bScen',
      Object.entries(SCENARIOS).map(([k, v]) => [k, v.label]),
      (v) => this.h.setScenario(v), 'normal', 'mci');

    this.setCutBtn = mkGroup('bCut', [
      ['roofOff', 'เปิดหลังคา'], ['solid', 'ทึบ'], ['section', 'ตัดขวาง'], ['xray', 'X-ray'],
    ], (v) => this.h.setCutaway(v), 'roofOff');

    this.setFloorBtn = mkGroup('bFloor', [
      ['all', 'ทั้งอาคาร'], ['0', 'ชั้น 1'], ['1', 'ชั้น 2'],
    ], (v) => this.h.setFloor(v === 'all' ? null : parseInt(v, 10)), 'all');

    this.setCamBtn = mkGroup('bCam', [
      ['overview', 'ภาพรวม'], ['top', 'ผังจากบน'], ['eye', 'ระดับสายตา'],
    ], (v) => this.h.setCamera(v), 'overview');

    this.setSpeedBtn = mkGroup('bSpeed', [
      ['5', '5x'], ['1', '1x'], ['20', '20x'], ['60', '60x'],
    ], (v) => this.h.setSpeed(parseFloat(v)), '5');

    $('play').addEventListener('click', () => this.h.togglePlay());
    $('pClose').addEventListener('click', () => this.h.follow(null));
    $('scrub').addEventListener('input', (e) => this.h.seek(parseFloat(e.target.value)));
  }

  // ───────── กราฟ ─────────
  _initCharts() {
    this.cq = $('chQ');
    this.cu = $('chU');
    const fit = (c) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth || 220;
      const h = parseInt(c.getAttribute('height'), 10);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.height = h + 'px';
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };
    this.fit = fit;
    this.chH = $('chH');
    this.qctx = fit(this.cq);
    this.uctx = fit(this.cu);
    this.hctx = this.chH ? fit(this.chH) : null;
    window.addEventListener('resize', () => {
      this.qctx = fit(this.cq);
      this.uctx = fit(this.cu);
      if (this.chH) this.hctx = fit(this.chH);
    });
  }

  _css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  _drawQueue() {
    const ctx = this.qctx;
    if (!ctx) return;
    const W = this.cq.clientWidth;
    const H = parseInt(this.cq.getAttribute('height'), 10);
    if (!W || !H) return; // panel ถูกซ่อนบนจอเล็ก
    ctx.clearRect(0, 0, W, H);

    const hist = this.sim.history;
    const k = this.chartKey;
    let max = 1;
    for (const r of hist) max = Math.max(max, r.q[k] ?? 0);
    $('chMax').textContent = `สูงสุด ${max}`;
    $('chSel').textContent = STATION_DEFS[k].label;

    const t0 = this.sim.startMin;
    const t1 = this.sim.endMin;
    const X = (t) => ((t - t0) / (t1 - t0)) * W;
    const Y = (v) => H - 4 - (v / max) * (H - 12);

    // เส้นตะแกรงทุก 2 ชั่วโมง
    ctx.strokeStyle = this._css('--line');
    ctx.lineWidth = 1;
    for (let t = t0; t <= t1; t += 120) {
      ctx.beginPath();
      ctx.moveTo(X(t), 2);
      ctx.lineTo(X(t), H - 2);
      ctx.stroke();
    }

    if (hist.length > 1) {
      // พื้นที่ใต้กราฟ
      ctx.beginPath();
      ctx.moveTo(X(hist[0].t), Y(0));
      for (const r of hist) ctx.lineTo(X(r.t), Y(r.q[k] ?? 0));
      ctx.lineTo(X(hist[hist.length - 1].t), Y(0));
      ctx.closePath();
      ctx.fillStyle = 'rgba(74,127,181,.18)';
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const x = X(hist[i].t);
        const y = Y(hist[i].q[k] ?? 0);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this._css('--info');
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // เส้นบอกเวลาปัจจุบัน
    ctx.strokeStyle = this._css('--accent');
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(X(this.sim.t), 0);
    ctx.lineTo(X(this.sim.t), H);
    ctx.stroke();
  }

  _drawUtil(snap) {
    const ctx = this.uctx;
    if (!ctx) return;
    const W = this.cu.clientWidth;
    const H = parseInt(this.cu.getAttribute('height'), 10);
    if (!W || !H) return; // panel ถูกซ่อนบนจอเล็ก
    ctx.clearRect(0, 0, W, H);

    const keys = STATION_KEYS.filter((k) => k !== 'ipd');
    const rowH = H / keys.length;
    const labW = 34;
    ctx.font = `10px ${this._css('--mono') || 'monospace'}`;
    ctx.textBaseline = 'middle';

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const u = snap.per[k].util;
      const y = i * rowH + rowH / 2;

      ctx.fillStyle = this._css('--ink-3');
      ctx.fillText(STATION_DEFS[k].short, 0, y);

      const bw = W - labW - 26;
      ctx.fillStyle = this._css('--line');
      ctx.fillRect(labW, y - 3, bw, 6);

      // สีเตือนเมื่อใกล้อิ่มตัว: เกิน 85% คือเริ่มอันตราย เกิน 95% คือคิวจะโตไม่หยุด
      ctx.fillStyle = u > 0.95 ? this._css('--accent') : u > 0.85 ? this._css('--warn') : this._css('--ok');
      ctx.fillRect(labW, y - 3, Math.max(bw * u, 1), 6);

      ctx.fillStyle = this._css('--ink-2');
      ctx.fillText(`${Math.round(u * 100)}%`, W - 24, y);
    }
  }

  // ───────── การกระจายเวลารอ ─────────
  /**
   * ค่าเฉลี่ยบังความจริงได้: OPD เฉลี่ย 16 นาที แต่จริง ๆ คือคนส่วนใหญ่แทบไม่รอ
   * ส่วนคนที่มาเช้ารอเกินครึ่งชั่วโมง กราฟนี้ทำให้เห็นว่าเป็นแบบไหน
   */
  _drawHist() {
    const ctx = this.hctx;
    if (!ctx) return;
    const W = this.chH.clientWidth;
    const H = parseInt(this.chH.getAttribute('height'), 10);
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);

    const k = this.chartKey;
    const hist = this.sim.waitHistogram(k);
    let total = 0;
    for (const c of hist) total += c;
    const p50 = this.sim.waitPercentile(k, 0.5);
    const p90 = this.sim.waitPercentile(k, 0.9);
    const pct = $('chPct');
    if (pct) {
      pct.textContent = total
        ? `กลาง ${Math.round(p50)} น. · 90% ไม่เกิน ${Math.round(p90)} น.`
        : '';
    }
    if (!total) return;

    let max = 1;
    for (const c of hist) max = Math.max(max, c);
    const bw = W / hist.length;
    const span = WAIT_BUCKETS * WAIT_BUCKET_MIN;

    for (let i = 0; i < hist.length; i++) {
      if (!hist[i]) continue;
      const h = (hist[i] / max) * (H - 8);
      const mid = i * WAIT_BUCKET_MIN;
      ctx.fillStyle = mid >= p90 ? this._css('--accent')
        : mid >= p50 ? this._css('--warn')
        : this._css('--info');
      ctx.globalAlpha = 0.85;
      ctx.fillRect(i * bw, H - h, Math.max(bw - 0.6, 1), h);
    }
    ctx.globalAlpha = 1;

    for (const [v, lbl] of [[p50, 'p50'], [p90, 'p90']]) {
      const x = (v / span) * W;
      ctx.strokeStyle = this._css('--ink-3');
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = this._css('--ink-3');
      ctx.font = '9px ui-monospace,monospace';
      ctx.fillText(lbl, Math.min(x + 2, W - 20), 9);
    }
  }

  // ───────── เทียบผลทั้งวัน ─────────
  _buildCompare() {
    this.baseline = null;
    this.current = null;
    this._cmpTimer = null;
    const setBtn = $('cmpSet');
    if (setBtn) {
      setBtn.addEventListener('click', () => {
        this.baseline = this.current ?? runDay(this.sim.cfg, this.sim.seed);
        this._renderCompare();
      });
    }
    const a = $('csvSum');
    const b = $('csvTs');
    if (a) a.addEventListener('click', () => this._exportSummary());
    if (b) b.addEventListener('click', () => this._exportTimeSeries());
    this.scheduleCompare(true);
  }

  /** รันทั้งวันใหม่แบบหน่วงเวลา ไม่ให้คำนวณซ้ำทุกขีดที่ลากสไลเดอร์ */
  scheduleCompare(setBaseline = false) {
    clearTimeout(this._cmpTimer);
    const busy = $('cmpBusy');
    if (busy) busy.textContent = '…';
    this._cmpTimer = setTimeout(() => {
      const t0 = performance.now();
      this.current = runDay(this.sim.cfg, this.sim.seed);
      if (setBaseline || !this.baseline) this.baseline = this.current;
      if (busy) busy.textContent = `${Math.round(performance.now() - t0)} ms`;
      this._renderCompare();
    }, 320);
  }

  _cmpRows() {
    const k = this.chartKey;
    const d = STATION_DEFS[k];
    const n = (v) => String(Math.round(v));
    const mins = (v) => `${r1(v)} น.`;
    return [
      { sec: 'ทั้งโรงพยาบาล' },
      { label: 'กลับบ้านแล้ว', get: (x) => x.left, fmt: n, better: 'higher' },
      { label: 'รับไว้นอน', get: (x) => x.admitted, fmt: n, better: 'higher' },
      { label: 'อยู่ใน รพ. เฉลี่ย', get: (x) => x.avgLOS, fmt: mins, better: 'lower' },
      { label: 'ค้างตอนปิดทำการ', get: (x) => x.stillIn, fmt: n, better: 'lower' },
      { sec: d.label },
      { label: 'จุดบริการ', get: (x) => x.per[k].servers, fmt: n, better: 'none' },
      { label: 'รอเฉลี่ย', get: (x) => x.per[k].avgWait, fmt: mins, better: 'lower' },
      { label: 'รอกลาง (p50)', get: (x) => x.per[k].p50, fmt: mins, better: 'lower' },
      { label: '90% รอไม่เกิน', get: (x) => x.per[k].p90, fmt: mins, better: 'lower' },
      { label: 'คิวสูงสุด', get: (x) => x.per[k].maxQueue, fmt: n, better: 'lower' },
      { label: 'ใช้กำลังคน', get: (x) => x.per[k].util * 100, fmt: (v) => `${Math.round(v)}%`, better: 'none' },
    ];
  }

  _renderCompare() {
    const body = $('cmpBody');
    if (!body || !this.current) return;
    body.innerHTML = '';
    for (const row of this._cmpRows()) {
      const tr = document.createElement('tr');
      if (row.sec) {
        tr.className = 'sec';
        tr.innerHTML = `<td colspan="4">${row.sec}</td>`;
        body.appendChild(tr);
        continue;
      }
      const base = this.baseline ? row.get(this.baseline) : null;
      const cur = row.get(this.current);
      let delta = '<span class="dlt same">—</span>';
      if (base !== null && isFinite(base)) {
        const diff = cur - base;
        const eps = Math.abs(base) * 0.005 + 0.05;
        if (row.better === 'none' || Math.abs(diff) <= eps) {
          delta = `<span class="dlt same">${Math.abs(diff) <= eps ? '—' : (diff > 0 ? '+' : '') + r1(diff)}</span>`;
        } else {
          const good = row.better === 'lower' ? diff < 0 : diff > 0;
          delta = `<span class="dlt ${good ? 'good' : 'bad'}">${diff > 0 ? '+' : ''}${r1(diff)}</span>`;
        }
      }
      tr.innerHTML = `<td>${row.label}</td><td>${base === null ? '—' : row.fmt(base)}</td>`
        + `<td>${row.fmt(cur)}</td><td>${delta}</td>`;
      body.appendChild(tr);
    }
  }

  // ───────── ดาวน์โหลด CSV ─────────
  _exportSummary() {
    const d = this.current ?? runDay(this.sim.cfg, this.sim.seed);
    const scen = $('scenName') ? $('scenName').textContent : '';
    const rows = [
      ['แบบจำลองการไหลของผู้ป่วยในโรงพยาบาล — สรุปรายแผนก'],
      ['สถานการณ์', scen],
      ['ผู้ป่วยมาทั้งหมด', d.arrived],
      ['กลับบ้านแล้ว', d.left],
      ['รับไว้นอน', d.admitted],
      ['เวลาอยู่ใน รพ. เฉลี่ย (นาที)', r1(d.avgLOS)],
      [],
      ['แผนก', 'จุดบริการ', 'ให้บริการ (คน)', 'ใช้กำลังคน (%)',
        'รอเฉลี่ย (นาที)', 'รอกลาง p50', '90% ไม่เกิน', 'รอนานสุด', 'คิวสูงสุด'],
    ];
    for (const k of STATION_KEYS) {
      const p = d.per[k];
      rows.push([p.label, p.servers, p.served, Math.round(p.util * 100),
        r1(p.avgWait), r1(p.p50), r1(p.p90), r1(p.maxWait), p.maxQueue]);
    }
    downloadCSV('hospital-summary.csv', rows);
  }

  _exportTimeSeries() {
    const d = this.current ?? runDay(this.sim.cfg, this.sim.seed);
    const head = ['เวลา', 'อยู่ใน รพ.'];
    for (const k of STATION_KEYS) head.push(`คิว ${STATION_DEFS[k].label}`);
    for (const k of STATION_KEYS) head.push(`ใช้กำลังคน ${STATION_DEFS[k].label} (%)`);
    const rows = [head];
    for (const r of d.history) {
      const m = Math.floor(r.t) % 1440;
      const clock = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const line = [clock, r.inHouse];
      for (const k of STATION_KEYS) line.push(r.q[k]);
      for (const k of STATION_KEYS) line.push(Math.round(r.u[k] * 100));
      rows.push(line);
    }
    downloadCSV('hospital-timeseries.csv', rows);
  }

  // ───────── อัปเดตทุกเฟรม ─────────
  update(snap, opts = {}) {
    this.frame++;
    const every = opts.hudEvery ?? 1;
    if (this.frame % every !== 0) return;

    $('t').textContent = snap.clock;
    $('kArr').textContent = snap.arrived;
    $('kLeft').textContent = snap.left;
    $('kIn').textContent = snap.inHouse;
    $('kAdm').textContent = snap.admitted;
    $('kLos').textContent = mins(snap.avgLOS);

    let worst = 0;
    for (const k of STATION_KEYS) worst = Math.max(worst, snap.per[k].maxWait);
    $('kMax').textContent = mins(worst);

    for (const k of STATION_KEYS) {
      const el = this.deptEls[k];
      const p = snap.per[k];
      const waiting = p.queue;
      el.q.textContent = waiting;
      el.bar.style.width = `${Math.round(p.util * 100)}%`;
      el.bar.style.background = p.util > 0.95 ? 'var(--accent)' : p.util > 0.85 ? 'var(--warn)' : 'var(--info)';
      el.w.textContent = p.headWait >= 1 ? `รอ ${Math.round(p.headWait)} น.` : 'รอ —';
      el.u.textContent = `${p.busy}/${p.servers}`;
      el.root.classList.toggle('bot', k === snap.bottleneck);
    }

    const bot = $('bot');
    if (snap.bottleneck) {
      const p = snap.per[snap.bottleneck];
      bot.textContent = `คอขวด: ${p.label} — รอ ${p.queue} คน นานสุด ${Math.round(p.headWait)} นาที`;
      bot.classList.add('on');
    } else {
      bot.classList.remove('on');
    }

    if (!opts.dragging) $('scrub').value = String(Math.round(snap.t));

    this._drawQueue();
    this._drawUtil(snap);
    this._drawHist();
  }

  setSelected(k) {
    this.selected = k;
    if (k && k !== this.chartKey) {
      this.chartKey = k;
      this._renderCompare();   // ตารางเทียบเปลี่ยนตามแผนกที่เลือก
    }
    for (const [key, el] of Object.entries(this.deptEls)) {
      el.root.setAttribute('aria-pressed', String(key === k));
    }
  }

  setScenarioName(label) {
    $('scenName').textContent = label;
  }

  setPlaying(on) {
    $('play').textContent = on ? 'หยุด' : 'เล่น';
    $('play').setAttribute('aria-pressed', String(on));
  }

  setTour(on) {
    $('tour').classList.toggle('on', on);
  }

  setFps(v) {
    $('fps').textContent = v ? `${v} fps` : '';
  }

  /** การ์ดผู้ป่วยที่กำลังติดตาม */
  showPatient(p, sim) {
    const card = $('card');
    if (!p) {
      card.classList.remove('on');
      return;
    }
    card.classList.add('on');
    $('pid').textContent = `#${p.id}` + (p.lane === 'er' ? ` · ER ระดับ ${p.esi}` : '');
    const host = $('psteps');
    host.innerHTML = '';
    for (const st of p.path) {
      const d = STATION_DEFS[st.key];
      const row = document.createElement('div');
      row.className = 'pstep';
      const dur = st.tOut != null ? st.tOut - st.tIn : sim.t - st.tIn;
      row.innerHTML = `<span>${d.label}</span><span>รอ ${Math.round(st.wait)} / ใช้ ${Math.round(dur)} น.</span>`;
      host.appendChild(row);
    }
    if (!p.path.length) {
      host.innerHTML = '<div class="pstep"><span>กำลังเดินมาถึง</span><span>—</span></div>';
    }
    const inHouse = sim.t - p.tArrive;
    $('pnote').textContent =
      `อยู่ในโรงพยาบาลมาแล้ว ${Math.round(inHouse)} นาที · รอรวม ${Math.round(p.waitTotal)} นาที` +
      (p.admitted ? ' · รับไว้นอนโรงพยาบาล' : '');
  }
}
