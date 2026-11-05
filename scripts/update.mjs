// 從台灣彩券官網 API 補抓最新開獎，合併進 site/data.json
// 格式：{"checked": ISO 時間, "649": [[期別, yyyymmdd, n1..n6, 特別號], ...新→舊], "638": [...]}
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../site/data.json", import.meta.url);
const GAMES = {
  "649": { api: "Lotto649Result", key: "lotto649Res", start: "2007-01" },
  "638": { api: "SuperLotto638Result", key: "superLotto638Res", start: "2008-01" },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchMonth(game, month) {
  const g = GAMES[game];
  const url = `https://api.taiwanlottery.com/TLCAPIWeB/Lottery/${g.api}?month=${month}&pageNum=1&pageSize=50`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 LottoPick", Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list = json?.content?.[g.key];
      if (!Array.isArray(list)) throw new Error("回傳格式不對");
      return list.flatMap(e => {
        const n = e.drawNumberSize;
        if (!Array.isArray(n) || n.length < 7) return [];
        const nums = n.slice(0, 6).sort((a, b) => a - b);
        return [[e.period, Number(String(e.lotteryDate).slice(0, 10).replaceAll("-", "")), ...nums, n[6]]];
      });
    } catch (err) {
      console.log(`  ${game} ${month} 第 ${attempt} 次失敗：${err.message}`);
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  return null;
}

// 台北時間的「本月」
function taipeiMonth(offset = 0) {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsFrom(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

const data = JSON.parse(await readFile(FILE, "utf8"));
let added = 0, ok = 0, failed = 0;

for (const game of Object.keys(GAMES)) {
  const rows = data[game] ?? [];
  const last = rows.length ? String(Math.max(...rows.map(r => r[1]))) : null;
  // 從最後一期所在月份抓到本月（月初時多抓上個月，避免漏掉）
  const from = last ? `${last.slice(0, 4)}-${last.slice(4, 6)}` : GAMES[game].start;
  const months = monthsFrom(from < taipeiMonth(-1) ? from : taipeiMonth(-1), taipeiMonth());
  const byPeriod = new Map(rows.map(r => [r[0], r]));
  const before = byPeriod.size;
  for (const month of months) {
    const list = await fetchMonth(game, month);
    if (list === null) { failed++; continue; }
    ok++;
    for (const r of list) byPeriod.set(r[0], r);
    await sleep(300);
  }
  data[game] = [...byPeriod.values()].sort((a, b) => b[0] - a[0]);
  const n = byPeriod.size - before;
  added += n;
  console.log(`${game}：抓 ${months.length} 個月，新增 ${n} 期，最新第 ${data[game][0]?.[0]} 期`);
}

if (ok === 0) {
  console.error("全部月份都下載失敗（可能是官網擋國外連線），這次不更新。");
  process.exit(1);
}

data.checked = new Date().toISOString().replace(/\.\d+Z$/, "Z");
await writeFile(FILE, JSON.stringify(data));
console.log(`完成：新增 ${added} 期，失敗 ${failed} 個月`);
