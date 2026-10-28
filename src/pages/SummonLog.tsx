import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ScrollText, Search } from "lucide-react";
import { MONSTER_MAP, useStore } from "../store";
import { ELEMENTS } from "../lib/constants";
import { ElementTag, MonsterIcon } from "../components/ui";

const PAGE_SIZES = [10, 25, 50];

/** 屬性 ID → 顏色變數（與符文 / 魔靈頁一致） */
const EL_VAR: Record<number, string> = {
  1: "var(--water)",
  2: "var(--fire)",
  3: "var(--wind)",
  4: "var(--light)",
  5: "var(--dark)",
};

/**
 * 遊戲的 create_time 是伺服器時間（UTC+9），顯示時換算成瀏覽器本地時間，
 * 例如 2026-10-26 11:39:09（UTC+9）→ 香港時間 2026/10/26 10:39。
 */
const SERVER_OFFSET_MS = 9 * 60 * 60 * 1000;

function dateText(s: string): string {
  const src = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(src);
  // 已有時區（ISO Z / +08:00）就直接解析；否則視為遊戲伺服器時間 UTC+9。
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(src);
  let time = NaN;
  if (zoned) time = new Date(src.replace(" ", "T")).getTime();
  else if (m) {
    time = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) - SERVER_OFFSET_MS;
  }
  if (!Number.isFinite(time)) return src.slice(0, 16).replace(/-/g, "/");
  const d = new Date(time);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pageWindow(current: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(pages - 1, current + 1);
  if (start > 2) out.push("gap");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pages - 1) out.push("gap");
  out.push(pages);
  return out;
}

export default function SummonLogPage() {
  const account = useStore((s) => s.account);
  const [nat, setNat] = useState<0 | 4 | 5>(0);
  /** 可多選；空陣列 = 全部屬性 */
  const [els, setEls] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [newestFirst, setNewestFirst] = useState(true);

  // 只保留原生 4★ / 5★；名稱與屬性都從 monsters.json 取得。
  const records = useMemo(() => {
    return (account?.summons ?? []).flatMap((record) => {
      const monster = MONSTER_MAP.get(record.master);
      return monster && (monster.nat === 4 || monster.nat === 5) ? [{ record, monster }] : [];
    });
  }, [account]);

  const counts = useMemo(() => {
    let five = 0;
    let four = 0;
    for (const x of records) {
      if (x.monster.nat === 5) five++;
      else four++;
    }
    return { five, four, total: records.length };
  }, [records]);

  // 先套用「原生星數 + 名稱」條件；屬性按鈕上的數量才不會被屬性篩選自己影響。
  const pool = useMemo(() => {
    const key = q.trim().toLowerCase();
    return records.filter(({ record, monster }) => {
      if (nat && monster.nat !== nat) return false;
      if (key && !monster.name.toLowerCase().includes(key) && String(record.master) !== key) return false;
      return true;
    });
  }, [records, nat, q]);

  const elCounts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const x of pool) c[x.monster.el] = (c[x.monster.el] ?? 0) + 1;
    return c;
  }, [pool]);

  const filtered = useMemo(() => {
    const arr = els.length === 0 ? pool : pool.filter(({ monster }) => els.includes(monster.el));
    return [...arr].sort((a, b) =>
      newestFirst
        ? b.record.createdAt.localeCompare(a.record.createdAt)
        : a.record.createdAt.localeCompare(b.record.createdAt),
    );
  }, [pool, els, newestFirst]);

  const toggleEl = (n: number) => {
    setEls((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b)));
    setPage(1);
  };

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);
  const latest = filtered.length > 0
    ? filtered.reduce((a, b) => (a.record.createdAt > b.record.createdAt ? a : b))
    : null;

  if (!account) {
    return (
      <div className="empty">
        <ScrollText size={40} />
        <div>尚未匯入存檔</div>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="empty">
        <ScrollText size={40} />
        <div>這個存檔沒有魔靈取得時間</div>
        <div className="tiny dim" style={{ marginTop: 6 }}>
          請重新匯入 SWEX / SWOP 匯出的 JSON；舊版快取需要重新匯入才會包含 create_time。
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div className="tabs">
          <button className={`tab ${nat === 0 ? "active" : ""}`} onClick={() => { setNat(0); setPage(1); }}>
            原4 + 原5 · {counts.total}
          </button>
          <button className={`tab ${nat === 5 ? "active" : ""}`} onClick={() => { setNat(5); setPage(1); }}>
            原5 · {counts.five}
          </button>
          <button className={`tab ${nat === 4 ? "active" : ""}`} onClick={() => { setNat(4); setPage(1); }}>
            原4 · {counts.four}
          </button>
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input
              className="input"
              style={{ width: 190, paddingLeft: 28 }}
              placeholder="搜尋魔靈名稱…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
            />
          </div>
          <button
            className="btn btn-sm"
            title={newestFirst ? "目前：最新在前" : "目前：最舊在前"}
            onClick={() => { setNewestFirst((v) => !v); setPage(1); }}
          >
            {newestFirst ? "最新在前 ↓" : "最舊在前 ↑"}
          </button>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 6, marginBottom: 14, alignItems: "center" }}>
        <span className="tiny dim" style={{ marginRight: 2 }}>屬性</span>
        <button
          className={`chip ${els.length === 0 ? "gold" : "muted"}`}
          style={{ cursor: "pointer", fontWeight: els.length === 0 ? 700 : 500 }}
          onClick={() => { setEls([]); setPage(1); }}
          title="顯示全部屬性"
        >
          全屬性 · {pool.length}
        </button>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = els.includes(n);
          const dim = els.length > 0 && !on;
          return (
            <button
              key={n}
              className="chip"
              onClick={() => toggleEl(n)}
              title={`${ELEMENTS[n as 1].name}屬性 · 點擊${on ? "取消" : "加入"}篩選（可多選）`}
              style={{
                cursor: "pointer",
                padding: "5px 11px",
                color: dim ? "var(--muted-2)" : EL_VAR[n],
                background: on ? "rgba(255, 255, 255, .06)" : "transparent",
                borderColor: on ? EL_VAR[n] : "var(--line-soft)",
                boxShadow: on ? `inset 0 0 0 1px ${EL_VAR[n]}` : "none",
                fontWeight: on ? 700 : 500,
              }}
            >
              {on ? "✓ " : ""}{ELEMENTS[n as 1].name} · {elCounts[n] ?? 0}
            </button>
          );
        })}
        {els.length > 1 && (
          <span className="tiny dim" style={{ marginLeft: 4 }}>
            已選 {els.length} 個屬性（符合任一個）
          </span>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">召喚記錄</div>
            <div className="card-sub">
              依每隻魔靈的 create_time 排列 · 包含背包與保管箱中的魔靈
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {latest && (
              <span className="chip muted">
                最近：{dateText(latest.record.createdAt)}
              </span>
            )}
            <span className="chip gold">顯示 {filtered.length} 筆</span>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ cursor: "pointer" }} onClick={() => { setNewestFirst((v) => !v); setPage(1); }}>
                  日期 <span className="dim">{newestFirst ? "↓" : "↑"}</span>
                </th>
                <th>原生</th>
                <th>魔靈</th>
                <th>屬性</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ record, monster }) => (
                <tr key={record.unitId || `${record.master}-${record.createdAt}`}>
                  <td
                    className="mono"
                    style={{ whiteSpace: "nowrap" }}
                    title={`伺服器時間 ${record.createdAt}`}
                  >
                    {dateText(record.createdAt)}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span
                      title={`原生 ${monster.nat}★`}
                      style={{
                        color: monster.nat === 5 ? "var(--gold)" : "#b07cff",
                        letterSpacing: 1,
                        fontSize: 12,
                      }}
                    >
                      {"★".repeat(monster.nat)}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 9 }}>
                      <MonsterIcon id={monster.id} size={38} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>{monster.name}</div>
                        <div className="tiny dim">#{record.master}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <ElementTag el={monster.el} />
                  </td>
                  <td className="tiny dim" style={{ whiteSpace: "nowrap" }}>
                    {record.stars}★ Lv.{record.level}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty tiny" style={{ padding: "30px 10px" }}>沒有符合條件的記錄</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div
          className="row between wrap"
          style={{ padding: "10px 14px", borderTop: "1px solid var(--line-soft)", gap: 8 }}
        >
          <div className="row" style={{ gap: 8 }}>
            <span className="tiny dim">
              顯示 {filtered.length === 0 ? 0 : start + 1}–{Math.min(start + pageSize, filtered.length)}，共 {filtered.length} 筆
            </span>
            <select
              className="select"
              style={{ width: 92, padding: "4px 26px 4px 9px", fontSize: 11.5 }}
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              {PAGE_SIZES.map((n) => <option key={n} value={n}>每頁 {n}</option>)}
            </select>
          </div>

          <div className="row" style={{ gap: 4 }}>
            <button
              className="btn btn-sm"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              title="上一頁"
            >
              <ChevronLeft size={13} />
            </button>
            {pageWindow(safePage, pages).map((p, i) =>
              p === "gap" ? (
                <span key={`gap-${i}`} className="tiny dim" style={{ padding: "0 3px" }}>…</span>
              ) : (
                <button
                  key={p}
                  className={`btn btn-sm ${p === safePage ? "btn-primary" : ""}`}
                  onClick={() => setPage(p)}
                  style={{ minWidth: 30 }}
                >
                  {p}
                </button>
              ),
            )}
            <button
              className="btn btn-sm"
              disabled={safePage >= pages}
              onClick={() => setPage(safePage + 1)}
              title="下一頁"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="tiny dim" style={{ marginTop: 10, lineHeight: 1.7 }}>
        註：SWEX / SWOP 匯出檔沒有逐筆召喚 API 紀錄，這裡是依魔靈的 create_time（取得時間）整理；
        因此關卡掉落、活動贈送、合成等取得方式也會一併列入，無法區分召喚來源。
        遊戲伺服器時間為 UTC+9，表格已換算成你的本地時間（滑鼠移到日期可看原始時間）。
      </div>
    </>
  );
}
