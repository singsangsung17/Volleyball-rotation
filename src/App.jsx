import React, { useState, useMemo, useRef, useEffect } from "react";

/* ============================================================
   PART 0 — 角色
   引擎只看「組」：舉球=S、攔中/副攻=M、大砲/自由=X（同組可互為對角）
   前排中間那位是攔中或副攻，決定防守用「砲中」還是「砲背」那一套定點
   ============================================================ */
const ROLE_LIST = ["舉球", "大砲", "副攻", "攔中", "自由"];
const GROUP = { 舉球: "S", 攔中: "M", 副攻: "M", 大砲: "X", 自由: "X" };

/* ============================================================
   PART 1 — 定點表（全系統的座標真相）
   接發＝號位制（1–6）　防守＝角色制（FL/FC/FR/BL/BC/BR）
   防守分兩套：A＝砲背（前排中間是副攻）、M＝砲中（前排中間是攔中）
   發球圖沿用「中間攻擊」防守座標；發球員固定在場外 SERVE_SV
   ============================================================ */
const SERVE_SV = [0.74, 1.08]; // 發球員（場外，固定）
const DEFAULT_ANCHORS = {
  // 使用者的慣用陣型（實際拉點校準）
  recv: {
    P2: { 1: [0.746, 0.816], 2: [0.906, 0.115], 3: [0.795, 0.404], 4: [0.168, 0.407], 5: [0.297, 0.816], 6: [0.503, 0.616] },
    P3: { 1: [0.737, 0.807], 2: [0.805, 0.382], 3: [0.595, 0.127], 4: [0.189, 0.373], 5: [0.312, 0.825], 6: [0.506, 0.598] },
    P4: { 1: [0.725, 0.822], 2: [0.869, 0.401], 3: [0.152, 0.413], 4: [0.106, 0.099], 5: [0.266, 0.810], 6: [0.491, 0.625] },
  },
  def: {
    // M＝砲中（使用者已校準）
    M: {
      L: { FL: [0.177, 0.253], FC: [0.466, 0.155], FR: [0.805, 0.330], BL: [0.171, 0.841], BC: [0.475, 0.798], BR: [0.703, 0.656] },
      C: { FL: [0.285, 0.342], FC: [0.509, 0.127], FR: [0.762, 0.330], BL: [0.235, 0.708], BC: [0.5, 0.88], BR: [0.786, 0.687] },
      R: { FL: [0.168, 0.364], FC: [0.602, 0.133], FR: [0.838, 0.265], BL: [0.303, 0.641], BC: [0.568, 0.816], BR: [0.869, 0.844] },
    },
    // A＝砲背（使用者已校準：背在右、舉在中）
    A: {
      L: { FL: [0.177, 0.253], FC: [0.826, 0.348], FR: [0.506, 0.123], BL: [0.171, 0.841], BC: [0.475, 0.798], BR: [0.703, 0.656] },
      C: { FL: [0.285, 0.342], FC: [0.725, 0.339], FR: [0.503, 0.154], BL: [0.235, 0.708], BC: [0.5, 0.88], BR: [0.786, 0.687] },
      R: { FL: [0.168, 0.364], FC: [0.848, 0.290], FR: [0.623, 0.163], BL: [0.303, 0.641], BC: [0.568, 0.816], BR: [0.869, 0.844] },
    },
  },
};

const DEF_MAP = { d1: "R", d2: "C", d3: "L" };

/* ============================================================
   PART 2 — 純引擎
   ============================================================ */
const FRONT = [4, 3, 2]; // 左4 中3 右2
// 前排中間是副攻 → 用「砲背」那一套定點，否則用「砲中」
const frontVariant = (occ) => {
  const m = FRONT.find((p) => GROUP[occ[p].role] === "M");
  return m && occ[m].role === "副攻" ? "A" : "M";
};
const BACK = [5, 6, 1];  // 左5 中6 右1
const PIN_SLOT = { L: "BL", C: "BC", R: "BR" };
const PIN_NAME = { L: "守左", C: "守中", R: "守右" };

// 後排三格分配，三層優先序：
// ① 依位置固定（roleMap）→ ② 依基本輪轉順序遞補
// 同一格若兩人搶，先輪到的人（5→6→1）取得，另一人往下一層遞補；三格必定填滿
function backOrder(occ, roleMap) {
  const players = BACK.map((p) => ({ pos: p, e: occ[p] }));
  const slotted = {};
  const done = new Set();
  const claim = (pick) =>
    players.forEach((pl, i) => {
      if (done.has(i)) return;
      const s = PIN_SLOT[pick(pl.e)];
      if (s && !slotted[s]) { slotted[s] = pl; done.add(i); }
    });
  claim((e) => e && roleMap && roleMap[e.role]);       // ① 依位置固定
  const rest = players.filter((_, i) => !done.has(i)); // ② 其餘依輪轉順序遞補
  let ri = 0;
  return ["BL", "BC", "BR"].map((s) => slotted[s] || rest[ri++]);
}


// 同排三人規則撞格：列出每一輪的衝突
function backConflicts(lineup, roleMap) {
  const out = [];
  for (let r = 0; r < 6; r++) {
    const occ = occupancy(lineup, r);
    const want = {};
    BACK.forEach((p) => {
      const e = occ[p];
      const k = e && roleMap && roleMap[e.role];
      if (k) (want[k] = want[k] || []).push(`${e.name || "？"}(${e.role})`);
    });
    Object.keys(want).forEach((k) => {
      if (want[k].length > 1) out.push(`R${r + 1}　${want[k].join("、")} 都要${PIN_NAME[k]}`);
    });
  }
  return out;
}

function occupancy(lineup, r) {
  const occ = {};
  for (let p = 1; p <= 6; p++) occ[p] = lineup[(p - 1 + r) % 6];
  return occ;
}

function frontByRole(occ, set) {
  const gs = FRONT.map((p) => GROUP[occ[p].role]);
  if (gs.some((g) => !g)) return { err: "前排有位置未定" };
  if (gs.filter((g) => g === "S").length !== 1 || gs.filter((g) => g === "M").length !== 1)
    return { err: "前排角色組合不符" };
  return {
    spots: FRONT.map((p) => ({
      pos: p, e: occ[p], xy: set[{ X: "FL", M: "FC", S: "FR" }[GROUP[occ[p].role]]],
    })),
  };
}

// 自由球員替上：該員輪到後排即替換；但發球那一格由本人發球（自由不能發球）
const liberoIn = (e, pos, serve) => !!(e && e.libero) && BACK.includes(pos) && !(serve && pos === 1);

// 站位解析：{ok, spots:[{pos, e, xy, lib}]} 或 {ok:false, reason}
function formation(lineup, r, sceneId, A, roleMap) {
  const occ = occupancy(lineup, r);

  if (sceneId === "recv") {
    const fs = FRONT.filter((p) => occ[p].role === "舉球");
    if (fs.length !== 1) return { ok: false, reason: `前排舉球 ${fs.length} 人` };
    const set = A.recv["P" + fs[0]];
    return {
      ok: true,
      spots: [1, 2, 3, 4, 5, 6].map((p) => ({ pos: p, e: occ[p], xy: set[p], lib: liberoIn(occ[p], p, false) })),
    };
  }

  const serve = sceneId === "serve";
  // 發球沿用「中間攻擊」座標；發球員（1號位）站場外
  const v = frontVariant(occ);
  const set = A.def[v][serve ? "C" : DEF_MAP[sceneId]];
  const f = frontByRole(occ, set);
  if (f.err) return { ok: false, reason: f.err };
  const spots = [...f.spots];
  backOrder(occ, roleMap).forEach((b, i) => {
    const xy = serve && b.pos === 1 ? SERVE_SV : set[["BL", "BC", "BR"][i]];
    spots.push({ ...b, xy, lib: liberoIn(b.e, b.pos, serve) });
  });
  return { ok: true, spots };
}

// 位置錯誤檢查（僅接發：擊球瞬間的相對順序）
function checkLegal(spots) {
  const at = {};
  spots.forEach((s) => (at[s.pos] = s.xy));
  const bad = [];
  const fb = (f, b) => { if (at[f][1] >= at[b][1]) bad.push(`${f}號位未在${b}號位前方`); };
  fb(4, 5); fb(3, 6); fb(2, 1);
  const lr = (l, rr) => { if (at[l][0] >= at[rr][0]) bad.push(`${l}號位未在${rr}號位左側`); };
  lr(4, 3); lr(3, 2); lr(5, 6); lr(6, 1);
  return bad;
}

const SCENES = [
  { id: "serve", label: "發球" },
  { id: "recv", label: "接發" },
  { id: "d3", label: "左邊攻擊", ball: true }, // DEF_MAP.d3 = L
  { id: "d2", label: "中間攻擊", ball: true },
  { id: "d1", label: "右邊攻擊", ball: true },
];
const ZONE_NAME = { 1: "右後・先發球", 2: "右前", 3: "中前", 4: "左前", 5: "左後", 6: "中後" };

/* ============================================================
   PART 3 — UI
   ============================================================ */
const C = {
  paper: "#E7E3D9", dot: "#C6C0B0", court: "#C89264", courtDeep: "#B67F52",
  line: "#F6F1E8", ink: "#221D17", red: "#C4402B", blue: "#4C9FD4",
  panel: "#FBF9F5", edge: "#D8D2C4", muted: "#7B7365", warn: "#B5552F",
};
const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif';
const MONO = 'ui-monospace,Menlo,monospace';
const VB_H = 148;
const toPx = (x) => x * 100;
const toPy = (y) => 30 + y * 100;
const STORAGE_KEY = "volley-squad-v1";
const STORAGE_V = 5; // 每次改變存檔結構就 +1，並在 MIGRATIONS 補一步

/* ---- 存檔位置 ----------------------------------------------------------
   Claude 內建環境有 window.storage（每位使用者各自一份，預設 shared=false）。
   自行部署成網站時沒有這個 API，退回瀏覽器的 localStorage（每台裝置一份）。
   兩種情況都是「各存各的」，不同使用者不會互相覆蓋。
   ---------------------------------------------------------------------- */
const hostStore = () => (typeof window !== "undefined" && window.storage) || null;
const store = {
  async get(key) {
    const h = hostStore();
    if (h) return h.get(key, false); // false＝個人資料，非共用
    const v = window.localStorage.getItem(key);
    return v == null ? null : { key, value: v };
  },
  async set(key, value) {
    const h = hostStore();
    if (h) return h.set(key, value, false);
    window.localStorage.setItem(key, value);
    return { key, value };
  },
  async remove(key) {
    const h = hostStore();
    if (h) return h.delete(key, false);
    window.localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

/* ---- 存檔升級 ----------------------------------------------------------
   MIGRATIONS[n] 把「第 n 版」轉成「第 n+1 版」，只處理那一步的差異。
   舊存檔沒有 v 欄位（v1–v4 期間結構變過數次且無法區分），
   由 fromLegacy() 一次正規化到目前結構。
   新增結構改動時：STORAGE_V += 1，並在此加上 MIGRATIONS[舊版號]。
   ---------------------------------------------------------------------- */
const MIGRATIONS = {
  // 範例（下次改結構時照這個形狀補）：
  // 5: (d) => ({ ...d, 新欄位: 預設值 }),
};

// 只收正規點位，順手丟掉早期版本殘留的鍵（例如已廢除的 FA）
function normalizeAnchors(raw) {
  const out = { recv: {}, def: { M: {}, A: {} } };
  ["P2", "P3", "P4"].forEach((k) => {
    const base = DEFAULT_ANCHORS.recv[k];
    const src = (raw && raw.recv && raw.recv[k]) || {};
    out.recv[k] = {};
    Object.keys(base).forEach((pt) => { out.recv[k][pt] = src[pt] || base[pt]; });
  });
  const rawDef = (raw && raw.def) || {};
  const flat = rawDef.L && rawDef.L.FL; // 舊格式：def 直接是 {L,C,R}
  ["M", "A"].forEach((v) => ["L", "C", "R"].forEach((k) => {
    const base = DEFAULT_ANCHORS.def[v][k];
    const src = (flat ? rawDef[k] : (rawDef[v] || {})[k]) || {};
    out.def[v][k] = {};
    Object.keys(base).forEach((pt) => { out.def[v][k][pt] = src[pt] || base[pt]; });
  }));
  return out;
}

// 無版本號的舊存檔 → 目前結構
function fromLegacy(d) {
  return {
    v: STORAGE_V,
    roster: (d.roster || []).map((e) => ({
      id: e.id, name: e.name || "", role: e.role || "", libero: !!e.libero,
      // 早期的 back / pins / pinId / special 規則已由 roleMap 取代，不保留
    })),
    court: d.court,
    anchors: d.anchors ? normalizeAnchors(d.anchors) : null,
    roleMap: d.roleMap ? { ...DEFAULT_ROLE_MAP, ...d.roleMap } : null,
  };
}

// 回傳目前結構的存檔物件；存檔比程式新時回傳 null（不冒險解析）
function upgradeSave(raw) {
  let d = JSON.parse(raw);
  if (typeof d.v !== "number") d = fromLegacy(d);
  while (d.v < STORAGE_V) {
    const step = MIGRATIONS[d.v];
    if (!step) { d = { ...d, v: STORAGE_V }; break; } // 缺步驟就跳到最新，不中斷
    d = { ...step(d), v: d.v + 1 };
  }
  return d.v > STORAGE_V ? null : d;
}

function Court({ spots, ball, size = 96, svgRef, onDown, labels, flag }) {
  const r = size > 150 ? 7 : 9;
  return (
    <svg ref={svgRef} viewBox={`0 0 100 ${VB_H}`} width={size} height={(size * VB_H) / 100}
      style={{ display: "block", touchAction: onDown ? "none" : "auto" }}>
      <rect x="0" y="0" width="100" height="130" rx="4" fill={C.court} />
      <rect x="0" y="0" width="100" height="30" fill={C.courtDeep} opacity="0.45" />
      <line x1="0" y1="30" x2="100" y2="30" stroke={C.line} strokeWidth="1.6" />
      <line x1="0" y1="63" x2="100" y2="63" stroke={C.line} strokeWidth="0.9" opacity="0.8" />
      <rect x="1" y="1" width="98" height="128" rx="3" fill="none" stroke={flag ? C.warn : C.line}
        strokeWidth={flag ? 2.2 : 0.9} opacity={flag ? 1 : 0.7} />
      {ball && <circle cx={toPx({ L: 0.22, C: 0.5, R: 0.78 }[ball])} cy="14" r="4.5" fill={C.blue} />}
      {spots.map((s, i) => {
        const isFrontSetter = s.e && s.e.role === "舉球" && FRONT.includes(s.pos);
        const label = labels ? (s.label || s.key) : s.lib ? "L" : s.e.name;
        return (
          <g key={s.key || (s.e && s.e.id) || i}
            onPointerDown={onDown ? (ev) => onDown(ev, s.key) : undefined}
            style={{ cursor: onDown ? "grab" : "default" }}>
            <circle cx={toPx(s.xy[0])} cy={toPy(s.xy[1])} r={labels ? r + 1 : r}
              fill={isFrontSetter ? "none" : s.lib ? C.ink : labels ? C.panel : C.court}
              stroke={isFrontSetter ? C.red : labels ? C.ink : "none"} strokeWidth="1.4" />
            <text x={toPx(s.xy[0])} y={toPy(s.xy[1]) + 3.4} textAnchor="middle"
              fontSize={labels ? (String(label).length > 1 ? 6.5 : 8) : 10} fontFamily={s.lib ? MONO : FONT}
              fontWeight={s.lib ? 800 : 600} fill={s.lib ? C.paper : C.ink}>
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---- 球場式名單編輯器 ---- */
const ZONES = [
  { p: 4, x: 21, y: 22 }, { p: 3, x: 50, y: 22 }, { p: 2, x: 79, y: 22 },
  { p: 5, x: 21, y: 62 }, { p: 6, x: 50, y: 62 }, { p: 1, x: 79, y: 62 },
];

function CourtEditor({ zoneEntry, selZone, onTap }) {
  const arrow = (x1, y1, x2, y2) => {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const ax = x2 - 2.6 * Math.cos(ang), ay = y2 - 2.6 * Math.sin(ang);
    const l = (a) => [x2 - 3.4 * Math.cos(ang - a), y2 - 3.4 * Math.sin(ang - a)];
    const [p1x, p1y] = l(0.45), [p2x, p2y] = l(-0.45);
    return (
      <g stroke={C.muted} strokeWidth="0.9" fill={C.muted} opacity="0.85">
        <line x1={x1} y1={y1} x2={ax} y2={ay} />
        <polygon points={`${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`} stroke="none" />
      </g>
    );
  };
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 340, margin: "10px auto 0", aspectRatio: "100/96" }}>
      <svg viewBox="0 0 100 96" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <rect x="5" y="8" width="90" height="72" rx="2.5" fill={C.court} opacity="0.55" />
        <line x1="2" y1="8" x2="98" y2="8" stroke={C.ink} strokeWidth="1.6" />
        <text x="3" y="5.6" fontSize="4" fontFamily={FONT} fill={C.muted}>網</text>
        <line x1="5" y1="34" x2="95" y2="34" stroke={C.line} strokeWidth="0.8" />
        <rect x="5" y="8" width="90" height="72" rx="2.5" fill="none" stroke={C.line} strokeWidth="1" />
        <line x1="5" y1="80" x2="5" y2="94" stroke={C.muted} strokeWidth="0.7" strokeDasharray="2 2" />
        <line x1="95" y1="80" x2="95" y2="94" stroke={C.muted} strokeWidth="0.7" strokeDasharray="2 2" />
        {arrow(30, 22, 41, 22)}
        {arrow(59, 22, 70, 22)}
        {arrow(79, 31, 79, 53)}
        {arrow(70, 62, 59, 62)}
        {arrow(41, 62, 30, 62)}
        {arrow(21, 53, 21, 31)}
        <text x="50" y="44" fontSize="4.2" fontFamily={FONT} fill={C.muted} textAnchor="middle">
          （順時針輪轉）
        </text>
        <path d="M 84 70 Q 90 78 88 90" fill="none" stroke={C.warn} strokeWidth="0.9" strokeDasharray="2.2 2" />
        <polygon points="88,93 86.6,89.6 89.7,89.9" fill={C.warn} />
        <text x="80" y="93.5" fontSize="4.2" fontFamily={FONT} fill={C.warn} textAnchor="end">發球</text>
      </svg>
      {ZONES.map((z) => {
        const e = zoneEntry(z.p);
        const selected = selZone === z.p;
        const isFrontSetter = e && e.role === "舉球" && [2, 3, 4].includes(z.p);
        return (
          <button key={z.p}
            onClick={(ev) => { ev.stopPropagation(); onTap(selected ? null : z.p); }}
            style={{
              position: "absolute", left: `${z.x}%`, top: `${(z.y / 96) * 100}%`,
              transform: "translate(-50%,-50%)", width: "21.5%", aspectRatio: "1",
              borderRadius: "50%", cursor: "pointer",
              background: selected ? C.ink : C.panel,
              color: selected ? C.paper : C.ink,
              border: `2px solid ${isFrontSetter ? C.red : selected ? C.ink : C.edge}`,
              boxShadow: "0 1px 3px rgba(34,29,23,0.18)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: 0, fontFamily: FONT, lineHeight: 1.15,
            }}>
            <span style={{
              position: "absolute", top: "-6%", left: "-6%", width: 18, height: 18, borderRadius: "50%",
              background: C.ink, color: C.paper, fontSize: 10.5, fontFamily: MONO, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{z.p}</span>
            {e && e.libero && (
              <span style={{
                position: "absolute", top: "-6%", right: "-6%", width: 18, height: 18, borderRadius: "50%",
                background: C.ink, color: C.paper, fontSize: 10.5, fontFamily: MONO, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>L</span>
            )}
            <span style={{ fontSize: 16, fontWeight: 800 }}>{e ? e.name || "？" : "？"}</span>
            <span style={{ fontSize: 9.5, opacity: 0.72 }}>{e ? e.role || "未定" : ""}</span>
          </button>
        );
      })}
    </div>
  );
}

const ROSTER0 = [
  { id: "m1", name: "利", role: "大砲" },
  { id: "m2", name: "草", role: "舉球" },
  { id: "m3", name: "怡", role: "攔中" },
  { id: "m4", name: "宜", role: "大砲" },
  { id: "m5", name: "宋", role: "舉球" },
  { id: "m6", name: "溫", role: "攔中" },
];
const COURT0 = ["m1", "m2", "m3", "m4", "m5", "m6"];
// 後排依位置固定防守位置（可改；設為 null 即不套用）
const DEFAULT_ROLE_MAP = { 攔中: "L", 副攻: "L", 大砲: "C", 舉球: "R", 自由: null };

export default function RotationBoard() {
  const [roster, setRoster] = useState(ROSTER0);
  const [court, setCourt] = useState(COURT0);
  const [anchors, setAnchors] = useState(DEFAULT_ANCHORS);
  const [roleMap, setRoleMap] = useState(DEFAULT_ROLE_MAP);
  const [tab, setTab] = useState("setup");
  const [selZone, setSelZone] = useState(null);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [saveState, setSaveState] = useState("");
  const [zoom, setZoom] = useState(null);
  const [printHint, setPrintHint] = useState(false);

  const [editKey, setEditKey] = useState("recv.P2");
  const [drag, setDrag] = useState(null);
  const svgRef = useRef(null);
  const idRef = useRef(7);
  const readyRef = useRef(false); // 初始載入完成前不啟動自動儲存，避免用預設值蓋掉存檔

  /* ---- 儲存／載入（跨工作階段保存） ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await store.get(STORAGE_KEY);
        if (res && res.value) {
          const d = upgradeSave(res.value);
          if (!d) { readyRef.current = false; return; } // 存檔比程式新，保持原狀不覆寫
          if (Array.isArray(d.roster) && d.roster.length) {
            setRoster(d.roster);
            const nums = d.roster.map((e) => parseInt(String(e.id).replace(/\D/g, ""), 10)).filter(Number.isFinite);
            if (nums.length) idRef.current = Math.max(...nums) + 1;
          }
          if (Array.isArray(d.court) && d.court.length === 6) setCourt(d.court);
          if (d.anchors) setAnchors(d.anchors);
          if (d.roleMap) setRoleMap(d.roleMap);
        }
      } catch { /* 尚未儲存過，用預設值 */ }
      readyRef.current = true;
    })();
  }, []);
  // 自動儲存：任何變動後約 1 秒寫入（拖完點不必再按儲存）
  useEffect(() => {
    if (!readyRef.current) return;
    const t = setTimeout(() => {
      try {
        store.set(STORAGE_KEY, JSON.stringify({ v: STORAGE_V, roster, court, anchors, roleMap })).catch(() => {});
      } catch { /* 儲存失敗不影響操作 */ }
    }, 900);
    return () => clearTimeout(t);
  }, [roster, court, anchors, roleMap]);
  const save = async () => {
    setSaveState("saving");
    try {
      const r = await store.set(STORAGE_KEY, JSON.stringify({ v: STORAGE_V, roster, court, anchors, roleMap }));
      setSaveState(r ? "saved" : "error");
    } catch { setSaveState("error"); }
    setTimeout(() => setSaveState(""), 1800);
  };
  const clearSaved = async () => {
    try { await store.remove(STORAGE_KEY); } catch { /* 沒有存檔 */ }
    setRoster(ROSTER0); setCourt(COURT0); setAnchors(DEFAULT_ANCHORS); setRoleMap(DEFAULT_ROLE_MAP);
    idRef.current = 7;
  };

  const byId = useMemo(() => Object.fromEntries(roster.map((e) => [e.id, e])), [roster]);
  const lineup = useMemo(() => court.map((id) => byId[id]), [court, byId]);
  const zoneEntry = (p) => byId[court[p - 1]];
  const zoneOf = (id) => court.indexOf(id) + 1; // 0 = 板凳

  const issues = useMemo(() => {
    const out = [];
    for (let r = 0; r < 6; r++) {
      const fm = formation(lineup, r, "recv", anchors);
      if (!fm.ok) continue;
      const bad = checkLegal(fm.spots);
      if (bad.length) out.push(`R${r + 1} 接發：${bad[0]}`);
    }
    return out;
  }, [lineup, anchors]);

  const clashes = useMemo(() => backConflicts(lineup, roleMap), [lineup, roleMap]);

  const setMember = (id, patch) =>
    setRoster((R) => R.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const addMember = () => {
    if (roster.length >= 20) return;
    setRoster((R) => [...R, { id: "m" + idRef.current++, name: "", role: "" }]);
  };
  const removeMember = (id) => {
    if (zoneOf(id)) return;
    setRoster((R) => R.filter((e) => e.id !== id));
  };
  const assign = (p, id) =>
    setCourt((cur) => {
      const n = [...cur];
      const from = n.indexOf(id);
      if (from >= 0) n[from] = n[p - 1];
      n[p - 1] = id;
      return n;
    });
  const rotateOne = () => setCourt((cur) => [...cur.slice(1), cur[0]]);
  const rotateBack = () => setCourt((cur) => [cur[5], ...cur.slice(0, 5)]);
  // 規則寫在人身上；再點一次同一格＝取消
  const clearAllPins = () => {
    setRoster((R) => R.map((e) => (e.libero ? { ...e, libero: false } : e)));
    setRoleMap({ 舉球: null, 大砲: null, 副攻: null, 攔中: null, 自由: null });
  };
  const setRoleSlot = (role, k) =>
    setRoleMap((M) => ({ ...M, [role]: M[role] === k ? null : k }));
  const exportPdf = () => {
    setPrintHint(true);
    setTimeout(() => { try { window.print(); } catch { /* 提示文字引導手動列印 */ } }, 120);
  };
  // 場上同位置（恰好兩人）的配對，供一鍵互換
  const sameRolePairs = useMemo(() => {
    const byRole = {};
    court.forEach((id, i) => {
      const e = byId[id];
      if (!e || !e.role) return;
      (byRole[e.role] = byRole[e.role] || []).push(i);
    });
    return ROLE_LIST.filter((r) => (byRole[r] || []).length === 2)
      .map((r) => ({ role: r, idx: byRole[r] }));
  }, [court, byId]);
  const swapSame = (idx) =>
    setCourt((cur) => {
      const n = [...cur];
      [n[idx[0]], n[idx[1]]] = [n[idx[1]], n[idx[0]]];
      return n;
    });

  const EDIT_SETS = [
    { key: "recv.P2", label: "舉球在2號位", get: (A) => A.recv.P2, ball: null },
    { key: "recv.P3", label: "舉球在3號位", get: (A) => A.recv.P3, ball: null },
    { key: "recv.P4", label: "舉球在4號位", get: (A) => A.recv.P4, ball: null },
    { key: "def.A.L", label: "左邊攻擊", get: (A) => A.def.A.L, ball: "L" },
    { key: "def.A.C", label: "中間攻擊", get: (A) => A.def.A.C, ball: "C" },
    { key: "def.A.R", label: "右邊攻擊", get: (A) => A.def.A.R, ball: "R" },
    { key: "def.M.L", label: "左邊攻擊", get: (A) => A.def.M.L, ball: "L" },
    { key: "def.M.C", label: "中間攻擊", get: (A) => A.def.M.C, ball: "C" },
    { key: "def.M.R", label: "右邊攻擊", get: (A) => A.def.M.R, ball: "R" },
  ];
  const cur = EDIT_SETS.find((s) => s.key === editKey);
  const curSet = cur.get(anchors);
  const midLabel = editKey.startsWith("def.A") ? "背" : "中";
  const ANCHOR_LABEL = { FL: "砲", FC: midLabel, FR: "舉", BL: "後排", BC: "後排", BR: "後排" };
  const VALID_KEYS = editKey.startsWith("recv")
    ? ["1", "2", "3", "4", "5", "6"]
    : ["FL", "FC", "FR", "BL", "BC", "BR"];
  const editSpots = VALID_KEYS.filter((k) => curSet[k]).map((k) => ({
    key: k, label: ANCHOR_LABEL[k] || k, xy: curSet[k],
  }));
  const moveAnchor = (k, xy) =>
    setAnchors((A) => {
      const next = JSON.parse(JSON.stringify(A));
      let node = next;
      editKey.split(".").forEach((seg) => { node = node[seg]; });
      node[k] = xy;
      return next;
    });
  const onPointerMove = (e) => {
    if (!drag || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * VB_H;
    moveAnchor(drag, [
      Math.max(0.04, Math.min(0.96, x / 100)),
      Math.max(-0.2, Math.min(1.15, (y - 30) / 100)),
    ]);
  };

  const btn = {
    fontFamily: FONT, fontSize: 12, padding: "6px 10px", borderRadius: 8,
    border: `1px solid ${C.edge}`, background: C.panel, color: C.ink, cursor: "pointer",
  };
  const card = { background: C.panel, border: `1px solid ${C.edge}`, borderRadius: 12, padding: 12 };
  const SHEET_GAP = 26;
  const groupHead = {
    fontSize: 10, color: C.muted, textAlign: "center", letterSpacing: "0.12em",
    borderBottom: `1px solid ${C.edge}`, paddingBottom: 3,
  };

  const selEntry = selZone ? zoneEntry(selZone) : null;

  return (
    <div onClick={() => setSelZone(null)}
      style={{
        fontFamily: FONT, color: C.ink, minHeight: "100%", padding: 14,
        background: `radial-gradient(${C.dot} 1px, transparent 1px) 0 0/14px 14px, ${C.paper}`,
      }}>
      <style>{`
        .print-title { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-title { display: block !important; }
          .sheet-row { break-inside: avoid; }
        }
      `}</style>
      <div className="flex items-baseline justify-between mb-2 no-print">
        <div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>雙舉輪轉板</div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, letterSpacing: "0.08em" }}>
            ROSTER → LINEUP → 30 FORMATIONS
          </div>
        </div>
        <div className="flex gap-1 flex-wrap justify-end">
          {[["setup", "① 名單"], ["sheet", "② 全圖"], ["anchor", "③ 定點"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ ...btn, background: tab === k ? C.ink : C.panel, color: tab === k ? C.paper : C.ink }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {clashes.length > 0 && (
        <div className="no-print" style={{ ...card, borderColor: C.blue, marginBottom: 8, padding: 9 }}>
          <div style={{ fontSize: 12, color: C.blue, fontWeight: 700 }}>
            後排規則撞格 {clashes.length} 處
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
            {clashes.slice(0, 3).join("　/　")}
            <br />先輪到的人取得該格，另一人依基本輪轉順序遞補
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="no-print" style={{ ...card, borderColor: C.warn, marginBottom: 8, padding: 9 }}>
          <div style={{ fontSize: 12, color: C.warn, fontWeight: 700 }}>
            位置錯誤 {issues.length} 處（接發擊球瞬間重疊）
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{issues.slice(0, 3).join("　/　")}</div>
        </div>
      )}

      {/* ① 名單 */}
      {tab === "setup" && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, borderBottom: `2px solid ${C.ink}`, display: "inline-block", paddingBottom: 2 }}>
            輪轉順序
          </div>
          <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>點場上位置編輯</span>

          <CourtEditor zoneEntry={zoneEntry} selZone={selZone} onTap={setSelZone} />

          {selEntry && (
            <div onClick={(ev) => ev.stopPropagation()}
              style={{
                marginTop: 10, padding: 10, borderRadius: 10,
                border: `1.5px solid ${C.ink}`, background: "#fff",
              }}>
              <div className="flex items-center justify-between mb-2">
                <div style={{ fontWeight: 800, fontSize: 13 }}>
                  {selZone}號位
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 400, marginLeft: 6 }}>
                    {ZONE_NAME[selZone]}・{selEntry.name || "？"}
                  </span>
                </div>
                <button onClick={() => setSelZone(null)} style={{ ...btn, padding: "3px 8px" }}>收合</button>
              </div>

              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>球員</div>
              <div className="flex gap-1 flex-wrap mb-2">
                {roster.map((e) => {
                  const z = zoneOf(e.id);
                  const isHere = e.id === selEntry.id;
                  return (
                    <button key={e.id} onClick={() => !isHere && assign(selZone, e.id)}
                      style={{
                        ...btn, padding: "5px 9px",
                        background: isHere ? C.ink : C.panel,
                        color: isHere ? C.paper : C.ink,
                        opacity: e.name ? 1 : 0.5,
                      }}>
                      {e.name || "？"}
                      {z > 0 && !isHere && (
                        <span style={{ fontSize: 9, fontFamily: MONO, marginLeft: 4, opacity: 0.65 }}>{z}號</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>位置</div>
              <div className="flex gap-1 flex-wrap mb-2">
                {ROLE_LIST.map((r) => (
                  <button key={r} onClick={() => setMember(selEntry.id, { role: r })}
                    style={{
                      ...btn, padding: "5px 9px",
                      background: selEntry.role === r ? (r === "舉球" ? C.red : C.ink) : C.panel,
                      color: selEntry.role === r ? "#fff" : C.ink,
                    }}>
                    {r}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
                後排防守位置
                {selEntry.role && (
                  <span style={{ marginLeft: 4 }}>（設定所有「{selEntry.role}」）</span>
                )}
              </div>
              <div className="flex gap-1 flex-wrap">
                {["L", "C", "R"].map((k) => {
                  const on = !!selEntry.role && roleMap[selEntry.role] === k;
                  return (
                    <button key={k} disabled={!selEntry.role}
                      onClick={() => setRoleSlot(selEntry.role, k)}
                      style={{
                        ...btn, padding: "5px 9px",
                        background: on ? C.blue : C.panel,
                        color: on ? "#fff" : C.ink,
                        opacity: selEntry.role ? 1 : 0.4,
                      }}>
                      {PIN_NAME[k]}
                    </button>
                  );
                })}
                <button onClick={() => setMember(selEntry.id, { libero: !selEntry.libero })}
                  style={{
                    ...btn, padding: "5px 9px",
                    background: selEntry.libero ? C.ink : C.panel,
                    color: selEntry.libero ? C.paper : C.ink,
                  }}>
                  替自由 L
                </button>
                {(roster.some((e) => e.libero) || ROLE_LIST.some((x) => roleMap[x])) && (
                  <button onClick={clearAllPins}
                    style={{ ...btn, padding: "5px 9px", marginLeft: "auto", color: C.warn }}>
                    全部清除
                  </button>
                )}
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
                依位置套用到所有輪次，未指定的位置依基本輪轉順序遞補。
                「替自由」＝該員輪到後排時由自由球員替上（輪到發球時仍由本人發球）
              </div>
            </div>
          )}

          {sameRolePairs.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-3">
              <span style={{ fontSize: 11, color: C.muted }}>同位置互換：</span>
              {sameRolePairs.map((p) => (
                <button key={p.role} onClick={() => swapSame(p.idx)} style={btn}>
                  {p.role}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2 flex-wrap">
            <button onClick={rotateOne} style={btn}>整隊輪轉一格</button>
            <button onClick={rotateBack} style={btn}>逆轉一格</button>
            <button onClick={() => setTab("sheet")}
              style={{ ...btn, background: C.ink, color: C.paper, fontWeight: 700 }}>
              產生輪轉 →
            </button>
          </div>

          {/* 隊員名單（可收合、可儲存） */}
          <div style={{ borderTop: `1px solid ${C.edge}`, marginTop: 12, paddingTop: 10 }}>
            <div className="flex items-center justify-between mb-2">
              <div style={{ fontSize: 13, fontWeight: 800 }}>
                隊員名單
                <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, fontWeight: 400, marginLeft: 6 }}>
                  {roster.length}/20
                </span>
              </div>
              <div className="flex gap-1">
                <button onClick={save} style={{ ...btn, padding: "4px 9px" }}>
                  {saveState === "saving" ? "儲存中…" : saveState === "saved" ? "已儲存 ✓" : saveState === "error" ? "儲存失敗" : "儲存"}
                </button>
                <button onClick={() => setRosterOpen((o) => !o)} style={{ ...btn, padding: "4px 9px" }}>
                  {rosterOpen ? "收起 ▴" : "展開 ▾"}
                </button>
              </div>
            </div>
            {rosterOpen && (
              <>
                {roster.map((e) => {
                  const z = zoneOf(e.id);
                  return (
                    <div key={e.id} className="flex items-center gap-1 mb-1">
                      <input value={e.name} onChange={(ev) => setMember(e.id, { name: ev.target.value })}
                        placeholder="名字"
                        style={{
                          flex: 1, fontFamily: FONT, fontSize: 13, fontWeight: 700,
                          padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.edge}`, background: "#fff", color: C.ink,
                        }} />
                      {z === 0 && (
                        <button onClick={() => removeMember(e.id)} style={{ ...btn, padding: "4px 8px", color: C.warn }}>刪</button>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-between mt-1">
                  <button onClick={addMember} disabled={roster.length >= 20}
                    style={{ ...btn, opacity: roster.length >= 20 ? 0.4 : 1 }}>
                    ＋ 新增隊員
                  </button>
                  <button onClick={clearSaved} style={{ ...btn, border: "none", background: "none", color: C.muted, fontSize: 11 }}>
                    清除儲存並還原預設
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ② 全圖 */}
      {tab === "sheet" && (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div className="print-title" style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>雙舉輪轉表</div>
          <div style={{ minWidth: 632 }}>
            <div className="flex" style={{ paddingLeft: 92, marginBottom: 2 }}>
              <div style={{ width: 200, ...groupHead }}>發球權</div>
              <div style={{ width: 300, marginLeft: SHEET_GAP, ...groupHead }}>對方進攻</div>
            </div>
            <div className="flex" style={{ paddingLeft: 92 }}>
              {SCENES.map((s, i) => (
                <div key={s.id} style={{
                  width: 100, marginLeft: i === 2 ? SHEET_GAP : 0,
                  fontSize: 11, fontWeight: 700, color: C.muted, textAlign: "center",
                }}>
                  {s.label}
                </div>
              ))}
            </div>
            {[0, 1, 2, 3, 4, 5].map((r) => (
              <div key={r} className="flex items-center sheet-row" style={{ marginBottom: 6 }}>
                <div style={{ width: 92, flexShrink: 0, paddingRight: 6 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: C.muted }}>R{r + 1}</div>
                  <div className="flex flex-wrap" style={{ marginTop: 2 }}>
                    {[...FRONT, ...BACK].map((p) => {
                      const e = occupancy(lineup, r)[p];
                      return (
                        <span key={p} style={{
                          width: "33.3%", fontSize: 14, fontWeight: 800,
                          lineHeight: 1.45, color: C.ink, textAlign: "center",
                        }}>
                          {e ? e.name || "？" : "？"}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {SCENES.map((s, i) => {
                  const gap = i === 2 ? SHEET_GAP : 0;
                  const fm = formation(lineup, r, s.id, anchors, roleMap);
                  if (!fm.ok)
                    return (
                      <div key={s.id} style={{ width: 100, marginLeft: gap, padding: "0 2px" }}>
                        <div style={{
                          height: 142, border: `1.5px dashed ${C.warn}`, borderRadius: 6,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, color: C.warn, textAlign: "center", padding: 4, lineHeight: 1.5,
                        }}>
                          無法解析<br />{fm.reason}
                        </div>
                      </div>
                    );
                  const viol = s.id === "recv" ? checkLegal(fm.spots) : [];
                  return (
                    <button key={s.id} onClick={() => setZoom({ r, scene: s })}
                      style={{ width: 100, marginLeft: gap, background: "none", border: "none", padding: "0 2px" }}>
                      <Court spots={fm.spots} ball={s.ball && DEF_MAP[s.id]} size={96}
                        flag={viol.length > 0} />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="no-print" style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>
              紅框＝接發在擊球瞬間有位置錯誤。點小圖放大看細節。
            </div>
            <button onClick={exportPdf} style={{ ...btn, background: C.ink, color: C.paper, fontWeight: 700 }}>
              輸出 PDF
            </button>
            {printHint && (
              <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>
                在列印視窗選「另存為 PDF」；若視窗沒出現，請用瀏覽器選單的「列印」。
              </span>
            )}
          </div>
        </div>
      )}

      {/* 定點 */}
      {tab === "anchor" && (
        <div style={card}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
            拖動任一個點，全部輪轉同步更新，並自動儲存。六套表就是整個系統的座標來源。
          </div>
          {[["接發", EDIT_SETS.slice(0, 3)], ["砲背", EDIT_SETS.slice(3, 6)], ["砲中", EDIT_SETS.slice(6)]].map(([g, sets]) => (
            <div key={g} className="flex items-center gap-1 mb-2">
              <span style={{ fontSize: 11, color: C.muted, width: 30, flexShrink: 0 }}>{g}</span>
              {sets.map((s) => (
                <button key={s.key} onClick={() => setEditKey(s.key)}
                  style={{ ...btn, fontSize: 11, padding: "5px 8px", background: editKey === s.key ? C.ink : C.panel, color: editKey === s.key ? C.paper : C.ink }}>
                  {s.label}
                </button>
              ))}
            </div>
          ))}
          <div className="flex justify-center" onPointerMove={onPointerMove}
            onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
            <Court spots={editSpots} labels ball={cur.ball} size={260}
              svgRef={svgRef} onDown={(e, k) => { e.preventDefault(); setDrag(k); }} />
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.7 }}>
            接發的點是 1–6號位。防守分兩套：<b>砲背</b>＝前排中間是副攻、<b>砲中</b>＝前排中間是攔中
            （攔中與副攻互為對角，每輪只會出現一個）。前排三點：砲（左）・背或中（中）・舉（右）；
            後排點按照基本輪轉順序，除非適用特殊規則。
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => setAnchors(DEFAULT_ANCHORS)} style={btn}>還原預設（我的慣用陣型）</button>
          </div>
          <pre style={{
            fontFamily: MONO, fontSize: 9.5, background: C.paper, border: `1px solid ${C.edge}`,
            borderRadius: 8, padding: 8, marginTop: 10, maxHeight: 150, overflow: "auto", lineHeight: 1.5,
          }}>{JSON.stringify(anchors, null, 1)}</pre>
        </div>
      )}

      {/* 放大 */}
      {zoom && (() => {
        const fm = formation(lineup, zoom.r, zoom.scene.id, anchors, roleMap);
        const viol = fm.ok && zoom.scene.id === "recv" ? checkLegal(fm.spots) : [];
        return (
          <div onClick={() => setZoom(null)} className="fixed inset-0 flex items-center justify-center"
            style={{ background: "rgba(34,29,23,0.72)", zIndex: 50, padding: 20 }}>
            <div style={{ ...card, padding: 16 }} onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-baseline mb-2">
                <div style={{ fontWeight: 700 }}>
                  {zoom.scene.label}
                  <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted, marginLeft: 8 }}>R{zoom.r + 1}</span>
                </div>
                <button onClick={() => setZoom(null)} style={btn}>關閉</button>
              </div>
              {fm.ok && (
                <Court spots={fm.spots} ball={zoom.scene.ball && DEF_MAP[zoom.scene.id]} size={250} flag={viol.length > 0} />
              )}
              {viol.length > 0 && (
                <div style={{ fontSize: 11, color: C.warn, marginTop: 8, lineHeight: 1.7 }}>
                  位置錯誤：{viol.join("；")}
                </div>
              )}
              <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
                紅圈＝前排舉球　深色 L＝自由球員
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
