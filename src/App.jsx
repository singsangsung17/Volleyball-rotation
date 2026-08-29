import React, { useState, useMemo, useRef, useEffect } from "react";

/* ============================================================
   PART 0 — 角色
   引擎只看「組」：舉球=S、攔中/副攻=M、大砲/自由=X（同組可互為對角）
   前排中間那位是攔中或副攻，決定防守用「砲中」還是「砲背」那一套定點
   ============================================================ */
const ROLE_LIST = ["舉球", "大砲", "副攻", "攔中", "自由"];
const GROUP = { 舉球: "S", 攔中: "M", 副攻: "M", 大砲: "X", 自由: "X" };
// 全圖切到「位置」模式時圈圈裡顯示的簡稱
const ROLE_ABBR = { 舉球: "舉", 大砲: "砲", 攔中: "中", 副攻: "背", 自由: "自" };

/* ============================================================
   PART 1 — 定點表（全系統的座標真相）
   接發＝號位制（1–6）　防守＝角色制（FL/FC/FR/BL/BC/BR）
   防守分兩套：A＝砲背（前排有副攻）、M＝砲中（前排有攔中）
   砲中：砲(左) 中(中) 舉(右)　／　砲背：砲(左) 舉(中) 背(右)
   發球圖用固定的平行陣（SERVE_GRID），格子分配與防守完全同一套規則；
   1號位是發球員，站在端線外
   ============================================================ */
// 發球站位：平行的兩排，格子分配與防守同一套規則（前排看角色、後排看 roleMap）
const SERVE_GRID = {
  FL: [0.20, 0.14], FC: [0.50, 0.14], FR: [0.80, 0.14],
  BL: [0.20, 0.70], BC: [0.50, 0.70], BR: [0.80, 0.70],
  SV: [0.80, 1.06], // 發球員（1號位）站端線外
};
const DEFAULT_ANCHORS = {
  // 使用者的慣用陣型（實際拉點校準）
  // 接發兩套：R5＝5人接發、R4＝4人接發
  recv: {
    R5: {
      P2: { 1: [0.746, 0.816], 2: [0.906, 0.115], 3: [0.795, 0.404], 4: [0.168, 0.407], 5: [0.297, 0.816], 6: [0.503, 0.616] },
      P3: { 1: [0.737, 0.807], 2: [0.805, 0.382], 3: [0.595, 0.127], 4: [0.189, 0.373], 5: [0.312, 0.825], 6: [0.506, 0.598] },
      P4: { 1: [0.725, 0.822], 2: [0.869, 0.401], 3: [0.152, 0.413], 4: [0.106, 0.099], 5: [0.266, 0.810], 6: [0.491, 0.625] },
    },
    R4: {
      P2: { 1: [0.847, 0.549], 2: [0.885, 0.135], 3: [0.177, 0.515], 4: [0.051, 0.129], 5: [0.348, 0.795], 6: [0.673, 0.795] },
      P3: { 1: [0.837, 0.471], 2: [0.594, 0.224], 3: [0.499, 0.112], 4: [0.140, 0.433], 5: [0.341, 0.785], 6: [0.714, 0.768] },
      P4: { 1: [0.865, 0.518], 2: [0.218, 0.573], 3: [0.071, 0.286], 4: [0.054, 0.091], 5: [0.437, 0.785], 6: [0.741, 0.765] },
    },
  },
  def: {
    // M＝砲中（前排中間是攔中）
    M: {
      L: { FL: [0.153, 0.043], FC: [0.294, 0.310], FR: [0.805, 0.330], BL: [0.171, 0.841], BC: [0.475, 0.798], BR: [0.703, 0.656] },
      C: { FL: [0.294, 0.334], FC: [0.509, 0.067], FR: [0.718, 0.327], BL: [0.235, 0.708], BC: [0.5, 0.88], BR: [0.786, 0.687] },
      R: { FL: [0.168, 0.364], FC: [0.851, 0.071], FR: [0.697, 0.313], BL: [0.303, 0.641], BC: [0.568, 0.816], BR: [0.869, 0.844] },
    },
    // A＝砲背（前排中間是副攻）
    A: {
      L: { FL: [0.157, 0.050], FC: [0.263, 0.279], FR: [0.826, 0.348], BL: [0.171, 0.841], BC: [0.475, 0.798], BR: [0.703, 0.656] },
      C: { FL: [0.285, 0.342], FC: [0.499, 0.043], FR: [0.728, 0.339], BL: [0.235, 0.708], BC: [0.5, 0.88], BR: [0.786, 0.687] },
      R: { FL: [0.168, 0.364], FC: [0.697, 0.313], FR: [0.854, 0.060], BL: [0.303, 0.641], BC: [0.568, 0.816], BR: [0.869, 0.844] },
    },
  },
};
// 跑位目標位（目前介面未使用，保留結構讓已拖曳過的座標不會在載入時被丟掉）
DEFAULT_ANCHORS.move = JSON.parse(JSON.stringify(DEFAULT_ANCHORS.recv));

const DEF_MAP = { d1: "R", d2: "C", d3: "L" };

/* ============================================================
   PART 2 — 純引擎
   ============================================================ */
const FRONT = [4, 3, 2]; // 左4 中3 右2
// 前排中間是副攻 → 用「砲背」那一套定點，否則用「砲中」
const frontVariant = (occ) => (FRONT.some((p) => occ[p].role === "副攻") ? "A" : "M");
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
  const roles = FRONT.map((p) => occ[p].role);
  if (roles.some((r) => !GROUP[r])) return { err: "前排有位置未定" };
  if (roles.filter((r) => r === "舉球").length !== 1) return { err: "前排舉球不是 1 人" };
  // 前排三格：
  //   沒有背：砲(其餘)→左、攔中→中、舉球→右
  //   有背　：其餘→左、舉球→中、背→右
  const hasBack = roles.includes("副攻");
  const pivot = hasBack ? "副攻" : "攔中";
  if (roles.filter((r) => r === pivot).length !== 1) return { err: "前排角色組合不符" };
  const slotFor = (e) =>
    hasBack
      ? (e.role === "副攻" ? "FR" : e.role === "舉球" ? "FC" : "FL")
      : (e.role === "舉球" ? "FR" : e.role === "攔中" ? "FC" : "FL");
  return { spots: FRONT.map((p) => ({ pos: p, e: occ[p], xy: set[slotFor(occ[p])] })) };
}

// 自由球員替上：該員輪到後排即替換；但發球那一格由本人發球（自由不能發球）
const liberoIn = (e, pos, serve) => !!(e && e.libero) && BACK.includes(pos) && !(serve && pos === 1);

// 站位解析：{ok, spots:[{pos, e, xy, lib}]} 或 {ok:false, reason}
function formation(lineup, r, sceneId, A, roleMap, recvMode) {
  if (lineup.length !== 6 || lineup.some((e) => !e)) return { ok: false, reason: "名單未滿 6 人" };
  const occ = occupancy(lineup, r);

  if (sceneId === "recv") {
    const fs = FRONT.filter((p) => occ[p].role === "舉球");
    if (fs.length !== 1) return { ok: false, reason: `前排舉球 ${fs.length} 人` };
    const set = A.recv[recvMode || "R5"]["P" + fs[0]];
    return {
      ok: true,
      spots: [1, 2, 3, 4, 5, 6].map((p) => ({ pos: p, e: occ[p], xy: set[p], lib: liberoIn(occ[p], p, false) })),
    };
  }

  // atk＝攻擊模式：跟發球同一組平行陣，只是發球者已經補位進場
  const serve = sceneId === "serve" || sceneId === "atk";
  const set = serve ? SERVE_GRID : A.def[frontVariant(occ)][DEF_MAP[sceneId]];
  const f = frontByRole(occ, set);
  if (f.err) return { ok: false, reason: f.err };
  const spots = [...f.spots];
  backOrder(occ, roleMap).forEach((b, i) => {
    const k = ["BL", "BC", "BR"][i];
    const xy = sceneId === "serve" && b.pos === 1 ? SERVE_GRID.SV : set[k];
    spots.push({ ...b, xy, slot: k, lib: liberoIn(b.e, b.pos, serve) });
  });
  return { ok: true, spots };
}

// 位置錯誤檢查（僅接發：擊球瞬間的相對順序）
function checkLegal(spots) {
  const at = {}, who = {};
  spots.forEach((s) => { at[s.pos] = s.xy; who[s.pos] = (s.e && s.e.name) || "？"; });
  const bad = [];
  const nm = (p) => `${who[p]}（${p}號位）`;
  const fb = (f, b) => { if (at[f][1] >= at[b][1]) bad.push(`${nm(f)} 站得比 ${nm(b)} 還後面`); };
  fb(4, 5); fb(3, 6); fb(2, 1);
  const lr = (l, r) => { if (at[l][0] >= at[r][0]) bad.push(`${nm(l)} 站得比 ${nm(r)} 還右邊`); };
  lr(4, 3); lr(3, 2); lr(5, 6); lr(6, 1);
  return bad;
}

/* ============================================================
   比賽追蹤：純狀態轉移，與畫面無關
   一局 25 分，24 平之後要領先 2 分。
   輪轉只在 side-out 發生：我方在「沒有發球權」的狀態下得分才轉一格。
   ============================================================ */
/* 手勢辨識：一筆畫分辨三種記號（座標為球場正規化座標，y 往底線遞增）
   圈＝繞回起點附近；勾＝一個明顯轉折且終點比起點高；斜線＝夠直的一筆
   認不出來時回傳 null，交給畫面上的按鈕手動指定 */
function recognize(pts) {
  if (!pts || pts.length < 4) return null;
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let path = 0;
  for (let i = 1; i < pts.length; i++) path += d(pts[i - 1], pts[i]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (size < 0.05 || path < 0.1) return null; // 太小，當成誤觸
  const A = pts[0], B = pts[pts.length - 1];
  const chord = d(A, B);
  // 累積轉向角：圈接近 360°，勾只有一個轉折，直線幾乎為 0
  let turn = 0;
  for (let i = 2; i < pts.length; i++) {
    const a1 = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
    const a2 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    let dd = a2 - a1;
    while (dd > Math.PI) dd -= 2 * Math.PI;
    while (dd < -Math.PI) dd += 2 * Math.PI;
    turn += dd;
  }
  if (Math.abs(turn) > 4.4) return "o";                     // 圈（畫不滿也算）
  if (chord / size < 0.45 && path / size > 2.2) return "o"; // 圈（有閉合）
  const cl = Math.max(chord, 1e-6);
  let maxPerp = 0, corner = null;
  for (const q of pts) {
    const t = Math.abs((B[0] - A[0]) * (A[1] - q[1]) - (A[0] - q[0]) * (B[1] - A[1])) / cl;
    if (t > maxPerp) { maxPerp = t; corner = q; }
  }
  if (maxPerp / cl > 0.22 && corner && corner[1] > A[1] && corner[1] > B[1] && B[1] < A[1]) return "v"; // 勾
  if (chord / path > 0.75) return "x"; // 斜線
  return null;
}

const SET_TARGET = 25;
const setWinner = (us, them) => {
  const done = (a, b) => a >= SET_TARGET && a - b >= 2;
  return done(us, them) ? "us" : done(them, us) ? "them" : null;
};

// 回傳新的比賽狀態；action = { page, kind, ... }
function applyAction(m, act) {
  const n = { ...m, marks: [...m.marks], rallies: [...m.rallies] };
  const winRally = () => {
    n.us += 1;
    if (!n.serving) { n.rot = (n.rot + 1) % 6; n.serving = true; n.serveCount = 0; } // side-out
  };
  const loseRally = () => { n.them += 1; if (n.serving) { n.serving = false; n.serveCount = 0; } };
  const endRally = (won) => {
    n.rallies.push({ rot: m.rot, serving: m.serving, serverId: m.serverId, serveCount: m.serveCount, marks: n.marks, won });
    n.marks = [];
    n.serverId = null;
  };

  if (act.page === "serve") {
    n.serveCount = m.serveCount + 1;
    n.serverId = act.serverId;
    if (act.kind === "miss") { loseRally(); endRally(false); n.page = "recv"; }
    else n.page = "def";
  } else if (act.kind === "ace") {
    // Ace 在防守頁按下：對方完全沒碰到球。發球數已在發球頁計過，這裡只加分
    winRally(); endRally(true); n.page = "serve";
  } else if (act.skip) {
    n.page = "atk"; // 防守跳過：不留記號，直接進攻擊模式
  } else {
    n.marks.push(act.mark);
    if (act.page === "def") {
      if (act.mark.kind === "o") n.page = "atk";
      else { loseRally(); endRally(false); n.page = "recv"; }
    } else if (act.page === "recv") {
      if (act.mark.kind === "o") n.page = "atk";
      else { loseRally(); endRally(false); n.page = "recv"; }
    } else if (act.page === "atk") {
      if (act.mark.kind === "o") n.page = "def";
      else if (act.mark.kind === "v") { winRally(); endRally(true); n.page = "serve"; }
      else { loseRally(); endRally(false); n.page = "recv"; }
    }
  }
  n.winner = setWinner(n.us, n.them);
  if (n.winner) n.page = "done";
  return n;
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
  paper: "#E7E3D9", dot: "#C6C0B0", court: "#DAB596", courtDeep: "#CDA889",
  line: "#F6F1E8", ink: "#221D17", red: "#C4402B", blue: "#4C9FD4",
  panel: "#FBF9F5", edge: "#D8D2C4", muted: "#7B7365", warn: "#B5552F", green: "#4F8A3F",
};
const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif';
const MONO = 'ui-monospace,Menlo,monospace';
const VB_H = 148;
// 對方進攻點（藍球）在網另一側的位置：左右兩點靠近邊線
const BALL_X = { L: 0.12, C: 0.5, R: 0.88 };
const toPx = (x) => x * 100;
const toPy = (y) => 30 + y * 100;
const STORAGE_KEY = "volley-squad-v1";
const STORAGE_V = 11; // 每次改變存檔結構就 +1，並在 MIGRATIONS 補一步

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
  // v5 → v6：原本單一名單，改成可以有多個團隊
  5: (d) => ({
    anchors: d.anchors,
    roleMap: d.roleMap,
    activeId: null,
    teams: (d.roster && d.roster.length)
      ? [{ id: "t-legacy", name: "我的隊伍", roster: d.roster, court: d.court || [null, null, null, null, null, null] }]
      : [],
  }),
  // v6 → v7：接發拆成 4 人／5 人兩套，並記住目前用哪一套
  6: (d) => ({
    ...d,
    recvMode: "R5",
    anchors: d.anchors ? normalizeAnchors(d.anchors) : d.anchors,
  }),
  // v7 → v8：前排規則改成「有背時 舉→中、背→右」，
  // 舊存檔的砲背座標仍是「FC＝背、FR＝舉」的年代，把中／右對調回來
  7: (d) => {
    const def = d.anchors && d.anchors.def;
    if (!def || !def.A) return { ...d };
    const A = {};
    ["L", "C", "R"].forEach((k) => {
      const s = def.A[k];
      A[k] = s ? { ...s, FC: s.FR, FR: s.FC } : s;
    });
    return { ...d, anchors: { ...d.anchors, def: { ...def, A } } };
  },
  // v8 → v9：預設團隊「小巨人」。舊存檔存著空的團隊清單會蓋掉預設值，
  // 這一步只在清單為空時補上，之後使用者刪掉就是刪掉，不會再長回來
  8: (d) => ({ ...d, teams: d.teams && d.teams.length ? d.teams : DEFAULT_TEAMS }),
  // v9 → v10：新增「跑位目標位」座標（介面已移除，資料仍保留）
  9: (d) => ({ ...d, anchors: d.anchors ? normalizeAnchors(d.anchors) : d.anchors }),
  // v10 → v11：新增比賽追蹤
  10: (d) => ({ ...d, match: null }),
  // 下次改結構時照這個形狀往下加：
  // 11: (d) => ({ ...d, 新欄位: 預設值 }),
};

// 只收正規點位，順手丟掉早期版本殘留的鍵（例如已廢除的 FA）
function normalizeAnchors(raw) {
  const out = { recv: { R5: {}, R4: {} }, move: { R5: {}, R4: {} }, def: { M: {}, A: {} } };
  ["recv", "move"].forEach((grp) => {
    const rawGrp = (raw && raw[grp]) || {};
    const flat = !!rawGrp.P2; // 舊格式：recv 直接是 {P2,P3,P4}
    ["R5", "R4"].forEach((m) => {
      out[grp][m] = {};
      ["P2", "P3", "P4"].forEach((k) => {
        const base = DEFAULT_ANCHORS[grp][m][k];
        const src = (flat ? rawGrp[k] : (rawGrp[m] || {})[k]) || {};
        out[grp][m][k] = {};
        Object.keys(base).forEach((pt) => { out[grp][m][k][pt] = src[pt] || base[pt]; });
      });
    });
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
    v: 5,
    roster: (d.roster || []).map((e) => ({
      id: e.id, name: e.name || "", role: e.role || "", libero: !!e.libero,
      // 早期的 back / pins / pinId / special 規則已由 roleMap 取代，不保留
    })),
    court: d.court,
    // 注意：fromLegacy 產出的是 v5 結構，接著會被 MIGRATIONS[5] 轉成團隊制
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

function Court({ spots, ball, size = 96, fluid, svgRef, onDown, labels, flag, byRole, marks, onCourtTap, dimSlots, ink, onInk }) {
  const toCourt = (ev, el) => {
    const r = el.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width, (((ev.clientY - r.top) / r.height) * VB_H - 30) / 100];
  };
  const tap = (ev) => {
    if (!onCourtTap) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const nx = (ev.clientX - r.left) / r.width;
    const ny = (((ev.clientY - r.top) / r.height) * VB_H - 30) / 100;
    onCourtTap(nx, ny);
  };
  const r = size > 150 ? 7 : 9;
  return (
    <svg ref={svgRef} viewBox={`0 0 100 ${VB_H}`} width={fluid ? undefined : size} height={fluid ? undefined : (size * VB_H) / 100}
      onClick={onCourtTap ? tap : undefined}
      onPointerDown={onInk ? (ev) => {
        ev.preventDefault();
        if (ev.currentTarget.setPointerCapture) ev.currentTarget.setPointerCapture(ev.pointerId);
        onInk("start", toCourt(ev, ev.currentTarget));
      } : undefined}
      onPointerMove={onInk ? (ev) => onInk("move", toCourt(ev, ev.currentTarget)) : undefined}
      onPointerUp={onInk ? () => onInk("end") : undefined}
      onPointerCancel={onInk ? () => onInk("end") : undefined}
      style={{
        display: "block", width: fluid ? "100%" : undefined, height: fluid ? "auto" : undefined,
        touchAction: onDown || onInk ? "none" : "auto",
        cursor: onCourtTap || onInk ? "crosshair" : "default",
      }}>
      <rect x="0" y="0" width="100" height="130" rx="4" fill={C.court} />
      <rect x="0" y="0" width="100" height="30" fill={C.courtDeep} opacity="0.45" />
      <line x1="0" y1="30" x2="100" y2="30" stroke={C.line} strokeWidth="1.6" />
      <line x1="0" y1="63" x2="100" y2="63" stroke={C.line} strokeWidth="0.9" opacity="0.8" />
      <rect x="1" y="1" width="98" height="128" rx="3" fill="none" stroke={flag ? C.warn : C.line}
        strokeWidth={flag ? 2.2 : 0.9} opacity={flag ? 1 : 0.7} />
      {ball && <circle cx={toPx(BALL_X[ball])} cy="14" r="4.5" fill={C.blue} />}
      {ink && ink.length > 1 && (
        <polyline fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          opacity="0.75" points={ink.map((q) => `${toPx(q[0])},${toPy(q[1])}`).join(" ")} />
      )}
      {marks && marks.map((m, i) => {
        const cx = toPx(m.x), cy = toPy(m.y);
        const col = m.kind === "x" ? C.red : m.kind === "v" ? C.green : C.blue;
        return (
          <g key={`mk${i}`} stroke={col} strokeWidth="1.8" fill="none" strokeLinecap="round">
            {m.kind === "o" && <circle cx={cx} cy={cy} r="6" />}
            {m.kind === "x" && <><line x1={cx - 5} y1={cy - 5} x2={cx + 5} y2={cy + 5} />
              <line x1={cx + 5} y1={cy - 5} x2={cx - 5} y2={cy + 5} /></>}
            {m.kind === "v" && <path d={`M${cx - 5} ${cy} L${cx - 1} ${cy + 4} L${cx + 6} ${cy - 5}`} />}
          </g>
        );
      })}
      {spots.map((s, i) => {
        const isFrontSetter = s.e && s.e.role === "舉球" && FRONT.includes(s.pos);
        const label = labels
          ? (s.label || s.key)
          : s.lib ? "L" : byRole ? (ROLE_ABBR[s.e.role] || "？") : s.e.name;
        const dimmed = dimSlots && s.slot && dimSlots.includes(s.slot);
        return (
          <g key={s.key || (s.e && s.e.id) || i}
            opacity={dimmed ? 0.3 : 1}
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

function CourtEditor({ zoneEntry, selZone, onTap, onSwap, zoneRole }) {
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const [dragFrom, setDragFrom] = useState(null);
  const [dropOn, setDropOn] = useState(null);

  // 指標落在哪一個號位上（同一套 ZONES 座標，取最近且在半徑內的）
  const zoneAt = (cx, cy) => {
    const r = wrapRef.current && wrapRef.current.getBoundingClientRect();
    if (!r) return null;
    const px = ((cx - r.left) / r.width) * 100;
    const py = ((cy - r.top) / r.height) * 96;
    let best = null, bestD = Infinity;
    ZONES.forEach((z) => {
      const d = (px - z.x) ** 2 + (py - z.y) ** 2;
      if (d < bestD) { bestD = d; best = z.p; }
    });
    return bestD <= 13 * 13 ? best : null;
  };
  const downZone = (ev, p) => {
    ev.stopPropagation();
    dragRef.current = { zone: p, x0: ev.clientX, y0: ev.clientY, moved: false };
    if (ev.currentTarget.setPointerCapture) ev.currentTarget.setPointerCapture(ev.pointerId);
  };
  const moveZone = (ev) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 8) return; // 手抖不算拖曳
    if (!d.moved) { d.moved = true; setDragFrom(d.zone); }
    setDropOn(zoneAt(ev.clientX, ev.clientY));
  };
  const upZone = (ev) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragFrom(null);
    setDropOn(null);
    if (!d) return;
    if (!d.moved) { onTap(selZone === d.zone ? null : d.zone); return; } // 純點擊
    const t = zoneAt(ev.clientX, ev.clientY);
    if (t && t !== d.zone) onSwap(d.zone, t);
  };

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
    <div ref={wrapRef} style={{ position: "relative", width: "100%", maxWidth: 340, margin: "10px auto 0", aspectRatio: "100/96" }}>
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
            onPointerDown={(ev) => downZone(ev, z.p)}
            onPointerMove={moveZone}
            onPointerUp={upZone}
            onPointerCancel={upZone}
            onClick={(ev) => ev.stopPropagation()}
            style={{
              position: "absolute", left: `${z.x}%`, top: `${(z.y / 96) * 100}%`,
              transform: `translate(-50%,-50%) scale(${dropOn === z.p && dragFrom !== z.p ? 1.12 : 1})`,
              width: "21.5%", aspectRatio: "1", touchAction: "none",
              borderRadius: "50%", cursor: dragFrom ? "grabbing" : "grab",
              opacity: dragFrom === z.p ? 0.45 : 1,
              background: selected ? C.ink : C.panel,
              color: selected ? C.paper : C.ink,
              border: `2px solid ${dropOn === z.p && dragFrom !== z.p ? C.blue : isFrontSetter ? C.red : selected ? C.ink : C.edge}`,
              boxShadow: "0 1px 3px rgba(34,29,23,0.18)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: 0, fontFamily: FONT, lineHeight: 1.15,
              transition: "transform 90ms, opacity 90ms",
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
            <span style={{ fontSize: 16, fontWeight: 800, opacity: e ? 1 : 0.35 }}>
              {e ? e.name || "？" : "＋"}
            </span>
            <span style={{ fontSize: 9.5, opacity: e ? 0.72 : 0.5 }}>
              {e ? e.role || "未定" : zoneRole(z.p) || ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const EMPTY_COURT = [null, null, null, null, null, null];
// 一鍵套用的位置順序，依號位 1→6（對角自動成立：1↔4、2↔5、3↔6）
const PRESETS = {
  砲中: ["舉球", "大砲", "攔中", "舉球", "大砲", "攔中"],
  砲背: ["舉球", "副攻", "大砲", "舉球", "副攻", "大砲"],
};
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const newTeam = (name) => ({ id: uid("t"), name, roster: [], court: [...EMPTY_COURT], mode: null });

// 沒有存檔時的起始團隊
const DEFAULT_TEAMS = [{
  id: "t-giants",
  name: "小巨人",
  mode: null,
  court: [...EMPTY_COURT],
  roster: ["安", "佾", "羊", "蓁", "宋", "妙", "張", "邱"].map((n, i) => ({
    id: "g" + (i + 1), name: n, role: "", libero: false,
  })),
}];
// 後排依位置固定防守位置（可改；設為 null 即不套用）
const DEFAULT_ROLE_MAP = { 攔中: "L", 副攻: "L", 大砲: "C", 舉球: "R", 自由: null };

export default function RotationBoard() {
  const [teams, setTeams] = useState(DEFAULT_TEAMS);
  const [activeId, setActiveId] = useState(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [bulk, setBulk] = useState("");
  const [anchors, setAnchors] = useState(DEFAULT_ANCHORS);
  const [roleMap, setRoleMap] = useState(DEFAULT_ROLE_MAP);
  const [recvMode, setRecvMode] = useState("R5");
  const [tab, setTab] = useState("setup");
  const [selZone, setSelZone] = useState(null);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [saveState, setSaveState] = useState("");
  const [zoom, setZoom] = useState(null);
  const [pngUrl, setPngUrl] = useState(null);
  const [pngBusy, setPngBusy] = useState(false);
  const [showRole, setShowRole] = useState(false);
  const [match, setMatch] = useState(null);
  const [hist, setHist] = useState([]);
  const [ink, setInk] = useState(null);         // { dir, pts } 目前這一筆
  const [pending, setPending] = useState(null); // 已辨識、正在顯示確認的記號
  const [note, setNote] = useState("");

  const [editKey, setEditKey] = useState("recv.R5.P2");
  const [drag, setDrag] = useState(null);
  const svgRef = useRef(null);

  // 目前團隊的名單／場上陣容；setRoster / setCourt 只改到這一隊
  const team = teams.find((t) => t.id === activeId) || null;
  const roster = team ? team.roster : [];
  const court = team ? team.court : EMPTY_COURT;
  const patchTeam = (fn) => setTeams((T) => T.map((t) => (t.id === activeId ? fn(t) : t)));
  const setRoster = (u) => patchTeam((t) => ({ ...t, roster: typeof u === "function" ? u(t.roster) : u }));
  const setCourt = (u) => patchTeam((t) => ({ ...t, court: typeof u === "function" ? u(t.court) : u }));

  const addTeam = () => {
    const n = newName.trim();
    if (!n) return;
    const t = newTeam(n);
    setTeams((T) => [...T, t]);
    setActiveId(t.id);
    setNewName("");
    setTab("setup");
  };
  const renameTeam = (id, name) => setTeams((T) => T.map((t) => (t.id === id ? { ...t, name } : t)));
  const removeTeam = (id) => {
    setTeams((T) => T.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(null);
  };
  const readyRef = useRef(false); // 初始載入完成前不啟動自動儲存，避免用預設值蓋掉存檔

  /* ---- 儲存／載入（跨工作階段保存） ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await store.get(STORAGE_KEY);
        if (res && res.value) {
          const d = upgradeSave(res.value);
          if (!d) { readyRef.current = false; return; } // 存檔比程式新，保持原狀不覆寫
          if (Array.isArray(d.teams)) setTeams(d.teams);
          if (d.activeId) setActiveId(d.activeId);
          if (d.anchors && d.anchors.recv && d.anchors.def) setAnchors(normalizeAnchors(d.anchors));
          if (d.roleMap) setRoleMap(d.roleMap);
          if (d.recvMode) setRecvMode(d.recvMode);
          if (d.match) setMatch(d.match);
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
        store.set(STORAGE_KEY, JSON.stringify({ v: STORAGE_V, teams, activeId, anchors, roleMap, recvMode, match })).catch(() => {});
      } catch { /* 儲存失敗不影響操作 */ }
    }, 900);
    return () => clearTimeout(t);
  }, [teams, activeId, anchors, roleMap, recvMode, match]);
  const save = async () => {
    setSaveState("saving");
    try {
      const r = await store.set(STORAGE_KEY, JSON.stringify({ v: STORAGE_V, teams, activeId, anchors, roleMap, recvMode, match }));
      setSaveState(r ? "saved" : "error");
    } catch { setSaveState("error"); }
    setTimeout(() => setSaveState(""), 1800);
  };
  const clearSaved = async () => {
    try { await store.remove(STORAGE_KEY); } catch { /* 沒有存檔 */ }
    setTeams(DEFAULT_TEAMS); setActiveId(null); setAnchors(DEFAULT_ANCHORS); setRoleMap(DEFAULT_ROLE_MAP); setRecvMode("R5");
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
      if (bad.length) out.push(`第 ${r + 1} 輪接發：${bad[0]}`);
    }
    return out;
  }, [lineup, anchors, recvMode]);

  const clashes = useMemo(() => backConflicts(lineup, roleMap), [lineup, roleMap]);

  /* ---- 比賽追蹤 ---- */
  const mLineup = useMemo(
    () => (match ? match.court.map((id) => byId[id]) : []),
    [match, byId]
  );
  const mReady = mLineup.length === 6 && mLineup.every(Boolean);
  const mForm = (scene) => (mReady ? formation(mLineup, match.rot, scene, anchors, roleMap, recvMode) : { ok: false, reason: "名單有異動" });
  const server = mReady ? occupancy(mLineup, match.rot)[1] : null;

  const startMatch = (weServe) => {
    setHist([]);
    setMatch({
      court: [...court], us: 0, them: 0, rot: 0, serving: weServe, serveCount: 0,
      serverId: null, page: weServe ? "serve" : "recv", marks: [], rallies: [], winner: null,
    });
  };
  const act = (a) => {
    setHist((H) => [...H.slice(-40), match]);
    setMatch((m) => applyAction(m, a));
    setInk(null);
  };
  const undoAll = () => { setInk(null); setPending(null); setNote(""); };
  const undo = () => {
    if (!hist.length) return;
    setMatch(hist[hist.length - 1]);
    setHist((H) => H.slice(0, -1));
  };
  const clearInk = () => setInk(null);
  // 送出前先讓記號停留一下，使用者才看得到自己畫的被認成什麼
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      act({ page: pending.page, mark: pending.mark });
      setPending(null);
    }, 420);
    return () => clearTimeout(t);
  }, [pending]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 1400);
    return () => clearTimeout(t);
  }, [note]);
  // 落點換算成「座標＋最近的球員」
  const markAt = (spots, x, y, kind, dir) => {
    let best = null, bd = Infinity;
    spots.forEach((s) => {
      const d = Math.hypot(s.xy[0] - x, s.xy[1] - y);
      if (d < bd) { bd = d; best = s; }
    });
    return { kind, x, y, dir: dir || null, playerId: best ? best.e.id : null, dist: +bd.toFixed(3) };
  };

  const setMember = (id, patch) =>
    setRoster((R) => R.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const addMember = () => {
    if (roster.length >= 20) return;
    setRoster((R) => [...R, { id: uid("m"), name: "", role: "" }]);
  };
  // 一次貼上多個名字（空白、逗號、頓號、換行都能分隔）
  const addBulk = () => {
    const names = bulk.split(/[\s,、，\n]+/).filter(Boolean);
    if (!names.length) return;
    setRoster((R) => [
      ...R,
      ...names.slice(0, 20 - R.length).map((n) => ({ id: uid("m"), name: n, role: "" })),
    ]);
    setBulk("");
  };
  const removeMember = (id) => {
    if (zoneOf(id)) return;
    setRoster((R) => R.filter((e) => e.id !== id));
  };
  // 拖曳交換兩個號位（含空位）
  const swapZones = (a, b) =>
    setCourtSynced((cur) => {
      const n = [...cur];
      [n[a - 1], n[b - 1]] = [n[b - 1], n[a - 1]];
      return n;
    });
  const assign = (p, id) =>
    setCourtSynced((cur) => {
      const n = [...cur];
      if (id === null) { n[p - 1] = null; return n; } // 清空此位
      const from = n.indexOf(id);
      if (from >= 0) n[from] = n[p - 1]; // 已在場上＝兩人互換
      n[p - 1] = id;
      return n;
    });
  // 套用模式：場上六格依號位填好位置，名字清空等待重填（板凳球員不動）
  // 按模式：只清空場上陣容，隊員名單原封不動；之後填進哪個號位就套用該號位的位置
  const applyPreset = (key) =>
    patchTeam((t) => ({ ...t, mode: key, court: [...EMPTY_COURT] }));
  const zoneRole = (p) => (team && team.mode ? PRESETS[team.mode][p - 1] : null);
  // 改動場上陣容時，若有模式就把位置同步成該號位應有的角色
  const setCourtSynced = (fn) =>
    patchTeam((t) => {
      const nextCourt = fn(t.court);
      const seq = t.mode && PRESETS[t.mode];
      if (!seq) return { ...t, court: nextCourt };
      const roster = t.roster.map((e) => {
        const z = nextCourt.indexOf(e.id);
        return z >= 0 ? { ...e, role: seq[z] } : e;
      });
      return { ...t, court: nextCourt, roster };
    });
  const rotateOne = () => setCourt((cur) => [...cur.slice(1), cur[0]]);
  const rotateBack = () => setCourt((cur) => [cur[5], ...cur.slice(0, 5)]);
  // 規則寫在人身上；再點一次同一格＝取消
  const clearAllPins = () => {
    setRoster((R) => R.map((e) => (e.libero ? { ...e, libero: false } : e)));
    setRoleMap({ 舉球: null, 大砲: null, 副攻: null, 攔中: null, 自由: null });
  };
  const switchRecvMode = (m) => {
    setRecvMode(m);
    setEditKey((k) => (k.startsWith("recv.") ? k.replace(/^recv\.(R4|R5)\./, `recv.${m}.`) : k));
  };
  const setRoleSlot = (role, k) =>
    setRoleMap((M) => ({ ...M, [role]: M[role] === k ? null : k }));
  /* ---- 輸出 PNG --------------------------------------------------------
     直接用 Canvas 2D 逐格重畫整張輪轉表，不經過 SVG→圖片那條路——
     那條路在轉檔時載不到網頁字型，中文會變成方框。Canvas 的 fillText
     走瀏覽器自己的字型堆疊，中文正常。
     產生後顯示在彈窗裡：桌機按下載，手機長按圖片即可存到相簿。
     -------------------------------------------------------------------- */
  const exportPng = () => {
    setPngBusy(true);
    setTimeout(() => {
      try {
        const S = 2.6; // 解析度倍率
        const PAD = 18, LABEL_W = 92, CW = 100, CH = 148, GAP = 26, ROWGAP = 10, HEAD = 52;
        const W = PAD * 2 + LABEL_W + CW * SCENES.length + GAP;
        const H = PAD * 2 + HEAD + (CH + ROWGAP) * 6;
        const cv = document.createElement("canvas");
        cv.width = Math.round(W * S);
        cv.height = Math.round(H * S);
        const ctx = cv.getContext("2d");
        ctx.scale(S, S);
        ctx.fillStyle = C.paper;
        ctx.fillRect(0, 0, W, H);
        ctx.textBaseline = "alphabetic";

        const rr = (x, y, w, h, r) => {
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
          else ctx.rect(x, y, w, h);
        };
        const txt = (str, x, y, o = {}) => {
          const { size = 10, weight = 600, color = C.ink, align = "center" } = o;
          ctx.font = `${weight} ${size}px ${FONT}`;
          ctx.fillStyle = color;
          ctx.textAlign = align;
          ctx.fillText(str, x, y);
        };
        const hline = (x1, y, x2, color, w, alpha = 1) => {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = color;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y);
          ctx.stroke();
          ctx.restore();
        };

        const drawCourt = (ox, oy, spots, ball, flag) => {
          ctx.fillStyle = C.court;
          rr(ox, oy, CW, 130, 4);
          ctx.fill();
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = C.courtDeep;
          ctx.fillRect(ox, oy, CW, 30);
          ctx.restore();
          hline(ox, oy + 30, ox + CW, C.line, 1.6);
          hline(ox, oy + 63, ox + CW, C.line, 0.9, 0.8);
          ctx.save();
          ctx.globalAlpha = flag ? 1 : 0.7;
          ctx.strokeStyle = flag ? C.warn : C.line;
          ctx.lineWidth = flag ? 2.2 : 0.9;
          rr(ox + 1, oy + 1, CW - 2, 128, 3);
          ctx.stroke();
          ctx.restore();
          if (ball) {
            ctx.fillStyle = C.blue;
            ctx.beginPath();
            ctx.arc(ox + BALL_X[ball] * 100, oy + 14, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
          spots.forEach((sp) => {
            const cx = ox + sp.xy[0] * 100;
            const cy = oy + 30 + sp.xy[1] * 100;
            const frontSetter = sp.e.role === "舉球" && FRONT.includes(sp.pos);
            ctx.beginPath();
            ctx.arc(cx, cy, 9, 0, Math.PI * 2);
            if (frontSetter) {
              ctx.strokeStyle = C.red;
              ctx.lineWidth = 1.4;
              ctx.stroke();
            } else {
              ctx.fillStyle = sp.lib ? C.ink : C.court;
              ctx.fill();
            }
            const lab = sp.lib ? "L" : showRole ? ROLE_ABBR[sp.e.role] || "？" : sp.e.name || "？";
            txt(lab, cx, cy + 3.4, {
              size: 10, weight: sp.lib ? 800 : 600, color: sp.lib ? C.paper : C.ink,
            });
          });
        };

        const colX = (i) => PAD + LABEL_W + CW * i + (i >= 2 ? GAP : 0);

        txt("雙舉輪轉表", PAD, PAD + 15, { size: 15, weight: 800, align: "left" });
        const gy = PAD + HEAD - 20;
        txt("發球權", colX(0) + CW, gy, { size: 9.5, color: C.muted });
        txt("對方進攻", colX(2) + CW * 1.5, gy, { size: 9.5, color: C.muted });
        hline(colX(0), gy + 4, colX(0) + CW * 2, C.edge, 1);
        hline(colX(2), gy + 4, colX(2) + CW * 3, C.edge, 1);
        SCENES.forEach((sc, i) => {
          const lb = sc.id === "recv" ? `接發（${recvMode === "R4" ? "4" : "5"}人）` : sc.label;
          txt(lb, colX(i) + CW / 2, PAD + HEAD - 4, { size: 10.5, weight: 700, color: C.muted });
        });

        for (let r = 0; r < 6; r++) {
          const oy = PAD + HEAD + (CH + ROWGAP) * r;
          txt(`R${r + 1}`, PAD, oy + 12, { size: 11, weight: 700, color: C.muted, align: "left" });
          const occ = occupancy(lineup, r);
          [...FRONT, ...BACK].forEach((pz, n) => {
            const e = occ[pz];
            txt(e ? (showRole ? ROLE_ABBR[e.role] || "？" : e.name || "？") : "？",
              PAD + 14 + (n % 3) * 26, oy + 32 + Math.floor(n / 3) * 20,
              { size: 14, weight: 800 });
          });
          SCENES.forEach((sc, i) => {
            const fm = formation(lineup, r, sc.id, anchors, roleMap, recvMode);
            const ox = colX(i);
            if (!fm.ok) {
              ctx.save();
              ctx.strokeStyle = C.warn;
              ctx.setLineDash([3, 3]);
              ctx.lineWidth = 1.5;
              rr(ox + 2, oy, CW - 4, 130, 6);
              ctx.stroke();
              ctx.restore();
              txt("無法解析", ox + CW / 2, oy + 62, { size: 10, color: C.warn });
              txt(fm.reason, ox + CW / 2, oy + 76, { size: 10, color: C.warn });
              return;
            }
            drawCourt(ox, oy, fm.spots, sc.ball && DEF_MAP[sc.id], false); // 分享用的圖不標紅框
          });
        }

        setPngUrl(cv.toDataURL("image/png"));
      } catch {
        setPngUrl("error");
      }
      setPngBusy(false);
    }, 30);
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
    { key: `recv.${recvMode}.P2`, label: "舉球在2號位", get: (A) => (A.recv[recvMode] || A.recv.R5).P2, ball: null },
    { key: `recv.${recvMode}.P3`, label: "舉球在3號位", get: (A) => (A.recv[recvMode] || A.recv.R5).P3, ball: null },
    { key: `recv.${recvMode}.P4`, label: "舉球在4號位", get: (A) => (A.recv[recvMode] || A.recv.R5).P4, ball: null },
    { key: "def.A.L", label: "左邊攻擊", get: (A) => A.def.A.L, ball: "L" },
    { key: "def.A.C", label: "中間攻擊", get: (A) => A.def.A.C, ball: "C" },
    { key: "def.A.R", label: "右邊攻擊", get: (A) => A.def.A.R, ball: "R" },
    { key: "def.M.L", label: "左邊攻擊", get: (A) => A.def.M.L, ball: "L" },
    { key: "def.M.C", label: "中間攻擊", get: (A) => A.def.M.C, ball: "C" },
    { key: "def.M.R", label: "右邊攻擊", get: (A) => A.def.M.R, ball: "R" },
  ];
  const cur = EDIT_SETS.find((s) => s.key === editKey) || EDIT_SETS[0];
  const curKey = cur.key; // editKey 可能過期，實際生效的是這個
  const curSet = cur.get(anchors) || {};
  const isBackVar = curKey.startsWith("def.A"); // 砲背那套
  const ANCHOR_LABEL = {
    FL: "砲", FC: isBackVar ? "舉" : "中", FR: isBackVar ? "背" : "舉",
    BL: "後排", BC: "後排", BR: "後排",
  };
  const VALID_KEYS = curKey.startsWith("recv")
    ? ["1", "2", "3", "4", "5", "6"]
    : ["FL", "FC", "FR", "BL", "BC", "BR"];
  const editSpots = VALID_KEYS.filter((k) => curSet[k]).map((k) => ({
    key: k, label: ANCHOR_LABEL[k] || k, xy: curSet[k],
  }));
  const moveAnchor = (k, xy) =>
    setAnchors((A) => {
      const next = JSON.parse(JSON.stringify(A));
      let node = next;
      curKey.split(".").forEach((seg) => { node = node[seg]; });
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
  const selOpen = !!selZone;

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
          <div style={{ fontSize: 11, color: C.muted }}>
            {team ? team.name : "尚未選擇團隊"}
          </div>
        </div>
        {team && (
          <div className="flex gap-1 flex-wrap justify-end">
            <button onClick={() => { setActiveId(null); setSelZone(null); }} style={btn}>切換團隊</button>
            {[["setup", "① 名單"], ["match", "② 比賽"], ["sheet", "③ 全圖"], ["anchor", "④ 定點"]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                style={{ ...btn, background: tab === k ? C.ink : C.panel, color: tab === k ? C.paper : C.ink }}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 團隊選擇：沒有選定團隊時就只有這一頁 */}
      {!team && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, borderBottom: `2px solid ${C.ink}`, display: "inline-block", paddingBottom: 2 }}>
            選擇團隊
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6, marginBottom: 10 }}>
            每個團隊有自己的隊員名單與輪轉順序；定點與後排防守位置全部團隊共用。點兩下團隊名稱可改名。
          </div>

          {teams.length === 0 && (
            <div style={{
              fontSize: 12, color: C.muted, padding: "14px 10px", marginBottom: 10,
              border: `1px dashed ${C.edge}`, borderRadius: 8, textAlign: "center",
            }}>
              還沒有任何團隊，先在下面建立一個
            </div>
          )}

          {teams.map((t) => (
            <div key={t.id} className="flex items-center gap-2 mb-1"
              style={{ padding: "8px 10px", border: `1px solid ${C.edge}`, borderRadius: 8, background: "#fff" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {renaming === t.id ? (
                  <input value={t.name} autoFocus
                    onChange={(ev) => renameTeam(t.id, ev.target.value)}
                    onBlur={() => setRenaming(null)}
                    onKeyDown={(ev) => (ev.key === "Enter" || ev.key === "Escape") && setRenaming(null)}
                    placeholder="團隊名稱"
                    style={{
                      width: "100%", fontFamily: FONT, fontSize: 14, fontWeight: 800, color: C.ink,
                      padding: "1px 3px", marginLeft: -4, borderRadius: 5,
                      border: `1px solid ${C.ink}`, background: "#fff",
                    }} />
                ) : (
                  <div onDoubleClick={() => setRenaming(t.id)}
                    style={{ fontSize: 14, fontWeight: 800, cursor: "text" }}>
                    {t.name || "未命名"}
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  {t.roster.length} 名隊員・場上 {t.court.filter(Boolean).length}/6
                </div>
              </div>
              <button onClick={() => { setActiveId(t.id); setTab("setup"); setSelZone(null); }}
                style={{ ...btn, background: C.ink, color: C.paper, fontWeight: 700 }}>
                進入
              </button>
              <button onClick={() => removeTeam(t.id)} style={{ ...btn, color: C.warn }}>刪</button>
            </div>
          ))}

          <div className="flex gap-1 mt-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTeam()}
              placeholder="團隊名稱"
              style={{
                flex: 1, fontFamily: FONT, fontSize: 13, padding: "8px 10px",
                borderRadius: 8, border: `1px solid ${C.edge}`, background: "#fff", color: C.ink,
              }} />
            <button onClick={addTeam} disabled={!newName.trim()}
              style={{ ...btn, fontWeight: 700, opacity: newName.trim() ? 1 : 0.4 }}>
              ＋ 建立團隊
            </button>
          </div>
        </div>
      )}

      {team && clashes.length > 0 && (
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

      {team && issues.length > 0 && (
        <div className="no-print" style={{ ...card, borderColor: C.warn, marginBottom: 8, padding: 9 }}>
          <div style={{ fontSize: 12, color: C.warn, fontWeight: 700 }}>
            位置錯誤 {issues.length} 處
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.8 }}>
            {issues.slice(0, 3).map((t) => <div key={t}>{t}</div>)}
            <div style={{ marginTop: 3 }}>
              判定只看<b>發球員擊球那一瞬間</b>；球一離手就可以自由跑位。
            </div>
          </div>
        </div>
      )}

      {/* ① 名單 */}
      {team && tab === "setup" && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, borderBottom: `2px solid ${C.ink}`, display: "inline-block", paddingBottom: 2 }}>
            輪轉順序
          </div>
          <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>點一下編輯，拖曳可互換位置</span>

          <CourtEditor zoneEntry={zoneEntry} selZone={selZone} onTap={setSelZone} onSwap={swapZones} zoneRole={zoneRole} />

          {selOpen && (
            <div onClick={(ev) => ev.stopPropagation()}
              style={{
                marginTop: 10, padding: 10, borderRadius: 10,
                border: `1.5px solid ${C.ink}`, background: "#fff",
              }}>
              <div className="flex items-center justify-between mb-2">
                <div style={{ fontWeight: 800, fontSize: 13 }}>
                  {selZone}號位
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 400, marginLeft: 6 }}>
                    {ZONE_NAME[selZone]}・{selEntry ? selEntry.name || "？" : "空位"}
                  </span>
                </div>
                <button onClick={() => setSelZone(null)} style={{ ...btn, padding: "3px 8px" }}>收合</button>
              </div>

              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>球員</div>
              <div className="flex gap-1 flex-wrap mb-2">
                {roster.length === 0 && (
                  <span style={{ fontSize: 11, color: C.muted }}>下方「隊員名單」還沒有人，先新增隊員</span>
                )}
                {roster.map((e) => {
                  const z = zoneOf(e.id);
                  const isHere = selEntry && e.id === selEntry.id;
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
                {selEntry && (
                  <button onClick={() => assign(selZone, null)}
                    style={{ ...btn, padding: "5px 9px", color: C.warn }}>清空此位</button>
                )}
              </div>

              {selEntry && (<>
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
              </>)}
            </div>
          )}

          <div className="flex items-center gap-1 flex-wrap mt-3">
            <span style={{ fontSize: 11, color: C.muted }}>模式：</span>
            {["砲中", "砲背"].map((k) => (
              <button key={k} onClick={() => applyPreset(k)}
                style={{
                  ...btn,
                  background: team.mode === k ? C.ink : C.panel,
                  color: team.mode === k ? C.paper : C.ink,
                }}>
                {k}
              </button>
            ))}
          </div>

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
                <div className="flex gap-1 mt-2">
                  <input value={bulk} onChange={(ev) => setBulk(ev.target.value)}
                    onKeyDown={(ev) => ev.key === "Enter" && addBulk()}
                    placeholder="一次貼多個名字，空白或逗號分隔"
                    style={{
                      flex: 1, fontFamily: FONT, fontSize: 13, padding: "6px 10px",
                      borderRadius: 8, border: `1px solid ${C.edge}`, background: "#fff", color: C.ink,
                    }} />
                  <button onClick={addBulk} disabled={roster.length >= 20 || !bulk.trim()}
                    style={{ ...btn, opacity: roster.length >= 20 || !bulk.trim() ? 0.4 : 1 }}>
                    批次新增
                  </button>
                </div>
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

      {/* ② 比賽 */}
      {team && tab === "match" && (
        <div>
          {!match && (
            <div style={card}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>開始記錄</div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.8 }}>
                一局 25 分，24 平之後要領先 2 分。輪轉由程式自動處理——只有在我方接發時得分才會轉一格。
              </div>
              {court.some((id) => !id) ? (
                <div style={{ fontSize: 12, color: C.warn }}>場上還沒滿 6 人，先到①名單排好陣容。</div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => startMatch(true)} style={{ ...btn, background: C.ink, color: C.paper, fontWeight: 700 }}>先發球</button>
                  <button onClick={() => startMatch(false)} style={{ ...btn, fontWeight: 700 }}>先接發球</button>
                </div>
              )}
            </div>
          )}

          {match && (
            <div style={card}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-baseline gap-2">
                  <span style={{ fontSize: 26, fontWeight: 800, fontFamily: MONO }}>
                    {match.us}<span style={{ color: C.muted, margin: "0 4px" }}>:</span>{match.them}
                  </span>
                  <span style={{ fontSize: 11, color: C.muted }}>
                    R{match.rot + 1}・{match.serving ? "我方發球" : "對方發球"}
                  </span>
                  {match.serving && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: C.paper, background: C.ink,
                      borderRadius: 6, padding: "2px 7px",
                    }}>
                      連續發球 {match.serveCount}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { undoAll(); undo(); }} disabled={!hist.length}
                    style={{ ...btn, padding: "4px 9px", opacity: hist.length ? 1 : 0.4 }}>← 上一步</button>
                  <button onClick={() => { undoAll(); setMatch(null); setHist([]); }}
                    style={{ ...btn, padding: "4px 9px", color: C.warn }}>結束</button>
                </div>
              </div>

              {!mReady && (
                <div style={{ fontSize: 12, color: C.warn }}>名單有異動，這場記錄無法繼續。請按「結束」重開一場。</div>
              )}

              {mReady && match.page === "done" && (
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
                    {match.winner === "us" ? "我方獲勝" : "對方獲勝"}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>
                    共 {match.rallies.length} 球。按「結束」回到名單頁重排陣容，再開下一局。
                  </div>
                </div>
              )}

              {mReady && match.page !== "done" && (
                <div className="flex items-baseline gap-2" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "0.05em" }}>
                    {{ serve: "發球", def: "防守", atk: "攻擊", recv: "接發" }[match.page]}
                  </span>
                  <span style={{ fontSize: 11.5, color: C.muted }}>
                    {{
                      serve: "選這一球的發球結果",
                      def: "對方進攻，在圖上畫記號",
                      atk: "我方進攻，畫在該攻擊手身上",
                      recv: "對方發球，在圖上畫記號",
                    }[match.page]}
                  </span>
                </div>
              )}

              {mReady && match.page === "serve" && (() => {
                const fm = mForm("serve");
                return (
                  <div>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>
                      發球員：<b>{server ? server.name || "？" : "？"}</b>
                      <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>本輪已發 {match.serveCount} 球</span>
                    </div>
                    <div style={{ maxWidth: 300, margin: "0 auto" }}>
                      {fm.ok ? <Court spots={fm.spots} fluid /> : <div style={{ fontSize: 12, color: C.warn }}>{fm.reason}</div>}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => act({ page: "serve", kind: "in", serverId: server.id })}
                        style={{ ...btn, flex: 1, fontSize: 15, fontWeight: 800, padding: "12px 0", background: C.green, color: "#fff", border: `2px solid ${C.green}` }}>成功</button>
                      <button onClick={() => act({ page: "serve", kind: "miss", serverId: server.id })}
                        style={{ ...btn, flex: 1, fontSize: 15, fontWeight: 800, padding: "12px 0", color: C.red, border: `2px solid ${C.red}` }}>失誤</button>
                    </div>
                  </div>
                );
              })()}

              {mReady && (match.page === "def" || match.page === "recv" || match.page === "atk") && (() => {
                const isDef = match.page === "def";
                const isAtk = match.page === "atk";
                const kinds = isAtk
                  ? [["o", "過網", C.blue], ["v", "得分", C.green], ["x", "失誤", C.red]]
                  : [["o", "接起", C.blue], ["x", "失誤", C.red]];
                const KIND_NAME = { o: isAtk ? "過網" : "接起", x: "失誤", v: "得分" };
                const KIND_COLOR = { o: C.blue, x: C.red, v: C.green };
                const commit = (kind) => {
                  if (!ink || ink.pts.length < 2 || pending) return;
                  const xs = ink.pts.map((q) => q[0]), ys = ink.pts.map((q) => q[1]);
                  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
                  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
                  const fm = mForm(isAtk ? "atk" : isDef ? (ink.dir === "L" ? "d3" : ink.dir === "C" ? "d2" : "d1") : "recv");
                  if (!fm.ok) { clearInk(); return; }
                  const mk = markAt(fm.spots, cx, cy, kind, ink.dir);
                  if (isAtk && mk.dist > 0.16) { clearInk(); setNote("記號要畫在球員身上"); return; }
                  clearInk();
                  setPending({ page: match.page, mark: mk });
                };
                const inkHandler = (dir) => (phase, pt) => {
                  if (phase === "start") setInk({ dir, pts: [pt] });
                  else if (phase === "move") setInk((k) => (k && k.dir === dir ? { ...k, pts: [...k.pts, pt] } : k));
                  else if (ink && ink.pts.length > 1) {
                    const g = recognize(ink.pts);
                    if (g) commit(g); // 認出來就直接送出；認不出來留著墨跡等手動指定
                  }
                };
                const dirs = [["L", "對手大砲"], ["C", "中間"], ["R", "副攻"]];
                const guess = ink ? recognize(ink.pts) : null;
                return (
                  <div>
                    {isDef ? (
                      <div className="flex gap-1" style={{ alignItems: "flex-start" }}>
                        {dirs.map(([d, l]) => {
                          const fm = mForm(d === "L" ? "d3" : d === "C" ? "d2" : "d1");
                          return (
                            <div key={d} style={{ flex: "1 1 0", minWidth: 0 }}>
                              <div style={{ fontSize: 10.5, color: C.muted, textAlign: "center", marginBottom: 2 }}>{l}</div>
                              {fm.ok ? (
                                <Court spots={fm.spots} fluid ball={d}
                                  marks={pending && pending.mark.dir === d ? [pending.mark] : null}
                                  ink={ink && ink.dir === d ? ink.pts : null}
                                  onInk={pending ? null : inkHandler(d)} />
                              ) : <div style={{ fontSize: 10, color: C.warn }}>{fm.reason}</div>}
                            </div>
                          );
                        })}
                      </div>
                    ) : (() => {
                      const fm = mForm(isAtk ? "atk" : "recv");
                      return (
                        <div style={{ maxWidth: 320, margin: "0 auto" }}>
                          {fm.ok ? (
                            <Court spots={fm.spots} fluid dimSlots={isAtk ? ["BL", "BR"] : null}
                              marks={pending ? [pending.mark] : null}
                              ink={ink ? ink.pts : null}
                              onInk={pending ? null : inkHandler(null)} />
                          ) : <div style={{ fontSize: 12, color: C.warn }}>{fm.reason}</div>}
                        </div>
                      );
                    })()}

                    <div style={{ minHeight: 26, marginTop: 6 }}>
                      {pending && (
                        <span style={{
                          fontSize: 16, fontWeight: 800, color: "#fff",
                          background: KIND_COLOR[pending.mark.kind], borderRadius: 8, padding: "3px 12px",
                        }}>
                          {pending.mark.kind === "o" ? "○" : pending.mark.kind === "x" ? "✕" : "✓"} {KIND_NAME[pending.mark.kind]}
                        </span>
                      )}
                      {!pending && note && (
                        <span style={{ fontSize: 12.5, color: C.warn, fontWeight: 700 }}>{note}</span>
                      )}
                      {!pending && !note && ink && !guess && (
                        <span style={{ fontSize: 12.5, color: C.warn, fontWeight: 700 }}>
                          看不出畫的是什麼，按下面的按鈕指定
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2" style={{ marginTop: 10 }}>
                      {kinds.map(([k, l, col]) => (
                        <button key={k} onClick={() => commit(k)} disabled={!ink || !!pending}
                          style={{
                            ...btn, flex: 1, padding: "12px 0", fontSize: 15, fontWeight: 800,
                            background: C.panel, color: col, border: `2px solid ${col}`,
                            opacity: ink && !pending ? 1 : 0.35,
                          }}>
                          {k === "o" ? "○" : k === "x" ? "✕" : "✓"} {l}
                        </button>
                      ))}
                      {isDef && match.serving && match.marks.length === 0 && (
                        <button onClick={() => { clearInk(); act({ page: "def", kind: "ace" }); }}
                          style={{ ...btn, flex: 1, padding: "12px 0", fontSize: 15, fontWeight: 800, background: C.ink, color: C.paper }}>
                          Ace
                        </button>
                      )}
                      {isDef && (
                        <button onClick={() => { clearInk(); act({ page: "def", skip: true }); }}
                          style={{ ...btn, flex: 1, padding: "12px 0", fontSize: 15, fontWeight: 700, color: C.muted }}>
                          跳過
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.9 }}>
                      直接在球場上畫：<b style={{ color: C.blue }}>畫圈</b>＝接起／過網、
                      <b style={{ color: C.red }}>畫一條斜線</b>＝失誤{isAtk && <>、<b style={{ color: C.green }}>畫勾</b>＝得分</>}。
                      {isDef && " 畫在三張圖的哪一張，等於記下對方的攻擊方向。"}
                      {isAtk && " 記號要畫在球員身上。"}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ② 全圖 */}
      {team && tab === "sheet" && (
        <>
        <div className="flex items-center gap-1 mb-2 no-print">
          <span style={{ fontSize: 11, color: C.muted }}>顯示：</span>
          {[["名字", false], ["位置", true]].map(([l, v]) => (
            <button key={l} onClick={() => setShowRole(v)}
              style={{ ...btn, background: showRole === v ? C.ink : C.panel, color: showRole === v ? C.paper : C.ink }}>
              {l}
            </button>
          ))}
        </div>
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
                  {s.id === "recv" ? `接發（${recvMode === "R4" ? "4" : "5"}人）` : s.label}
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
                      const txt = e ? (showRole ? ROLE_ABBR[e.role] || "？" : e.name || "？") : "？";
                      return (
                        <span key={p} style={{
                          width: "33.3%", fontSize: 14, fontWeight: 800,
                          lineHeight: 1.45, color: C.ink, textAlign: "center",
                        }}>
                          {txt}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {SCENES.map((s, i) => {
                  const gap = i === 2 ? SHEET_GAP : 0;
                  const fm = formation(lineup, r, s.id, anchors, roleMap, recvMode);
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
                      <Court spots={fm.spots} byRole={showRole} ball={s.ball && DEF_MAP[s.id]} size={96}
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
            <button onClick={exportPng} disabled={pngBusy}
              style={{ ...btn, background: C.ink, color: C.paper, fontWeight: 700, opacity: pngBusy ? 0.5 : 1 }}>
              {pngBusy ? "產生中…" : "輸出圖片"}
            </button>
          </div>
        </div>
        </>
      )}

      {/* 定點 */}
      {team && tab === "anchor" && (
        <div style={card}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
            拖動任一個點，全部輪轉同步更新，並自動儲存。六套表就是整個系統的座標來源。
          </div>
          <div className="flex items-center gap-1 mb-2">
            <span style={{ fontSize: 11, color: C.muted, width: 30, flexShrink: 0 }}>人數</span>
            {[["R4", "4人接發"], ["R5", "5人接發"]].map(([m, l]) => (
              <button key={m} onClick={() => switchRecvMode(m)}
                style={{ ...btn, fontSize: 11, padding: "5px 8px", background: recvMode === m ? C.ink : C.panel, color: recvMode === m ? C.paper : C.ink }}>
                {l}
              </button>
            ))}
            <span style={{ fontSize: 10.5, color: C.muted, marginLeft: 4 }}>全圖也會跟著換</span>
          </div>
          {[["接發", EDIT_SETS.slice(0, 3)], ["砲背", EDIT_SETS.slice(3, 6)], ["砲中", EDIT_SETS.slice(6)]].map(([g, sets]) => (
            <div key={g} className="flex items-center gap-1 mb-2">
              <span style={{ fontSize: 11, color: C.muted, width: 30, flexShrink: 0 }}>{g}</span>
              {sets.map((s) => (
                <button key={s.key} onClick={() => setEditKey(s.key)}
                  style={{ ...btn, fontSize: 11, padding: "5px 8px", background: curKey === s.key ? C.ink : C.panel, color: curKey === s.key ? C.paper : C.ink }}>
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
            接發的點是 1–6號位，4人／5人各一套；4人接發時把不接的那兩位拖到網前即可。
            防守分兩套：<b>砲背</b>＝前排有副攻、<b>砲中</b>＝前排有攔中
            （兩者互為對角，每輪只會出現一個）。前排三點：
            砲中＝砲（左）・中（中）・舉（右）；砲背＝砲（左）・<b>舉（中）</b>・<b>背（右）</b>；
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

      {/* 輸出圖片 */}
      {pngUrl && (
        <div onClick={() => setPngUrl(null)} className="fixed inset-0 flex items-center justify-center no-print"
          style={{ background: "rgba(34,29,23,0.78)", zIndex: 60, padding: 16 }}>
          <div style={{ ...card, padding: 12, maxWidth: "94vw", maxHeight: "92vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}>
            {pngUrl === "error" ? (
              <div style={{ fontSize: 13, color: C.warn }}>圖片產生失敗，請重試一次。</div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div style={{ fontSize: 12, color: C.muted }}>
                    手機長按圖片即可存到相簿，或直接分享到群組
                  </div>
                  <div className="flex gap-1">
                    <a href={pngUrl} download="雙舉輪轉表.png"
                      style={{ ...btn, background: C.ink, color: C.paper, fontWeight: 700, textDecoration: "none" }}>
                      下載
                    </a>
                    <button onClick={() => setPngUrl(null)} style={btn}>關閉</button>
                  </div>
                </div>
                <img src={pngUrl} alt="輪轉表"
                  style={{ display: "block", width: "100%", maxWidth: 900, border: `1px solid ${C.edge}`, borderRadius: 6 }} />
              </>
            )}
          </div>
        </div>
      )}

      {/* 放大 */}
      {zoom && (() => {
        const fm = formation(lineup, zoom.r, zoom.scene.id, anchors, roleMap, recvMode);
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
                <Court spots={fm.spots} byRole={showRole} ball={zoom.scene.ball && DEF_MAP[zoom.scene.id]} size={250} flag={viol.length > 0} />
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
