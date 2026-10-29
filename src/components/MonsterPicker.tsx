import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { ELEMENTS } from "../lib/constants";
import { MONSTERS, monsterOf } from "../store";
import type { Monster } from "../lib/types";
import { Modal, MonsterIcon } from "./ui";

/** 屬性排序：水 → 火 → 風 → 光 → 暗（對應 el 1..5） */
const EL_RANK: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 };
const EL_FILTERS = [1, 2, 3, 4, 5];
/** 元素篩選按鈕的顏色（與全域 --water / --fire … 一致） */
const EL_COLOR: Record<number, string> = {
  1: "var(--water)", 2: "var(--fire)", 3: "var(--wind)", 4: "var(--light)", 5: "var(--dark)",
};

/** 魔靈選擇用的清單項目；key 可對應「帳號內的某隻魔靈」而不是種族本身 */
export interface MonsterEntry {
  key: string;
  monster: Monster;
  /** 卡片上第三行（例如帳號內的速度、符文數、等級） */
  meta?: ReactNode;
  /** 卡片 tooltip */
  title?: string;
  disabled?: boolean;
}

/**
 * 預設排序：屬性 水火風光暗 → 原生星級高到低 → 已覺醒 → 名稱。
 * 所有頁面的魔靈選擇器都共用這個排序。
 */
export function sortMonsterEntries<T extends { monster: Monster }>(list: T[]): T[] {
  return list.slice().sort((a, b) => {
    const x = a.monster;
    const y = b.monster;
    return (
      (EL_RANK[x.el] ?? 99) - (EL_RANK[y.el] ?? 99) ||
      y.nat - x.nat ||
      y.awk - x.awk ||
      x.name.localeCompare(y.name)
    );
  });
}

export function toMonsterEntries(list: Monster[] = MONSTERS): MonsterEntry[] {
  return list.map((m) => ({ key: String(m.id), monster: m }));
}

function matches(m: Monster, term: string, el: number, nat: number, awakeOnly: boolean) {
  if (el && m.el !== el) return false;
  if (nat && m.nat !== nat) return false;
  if (awakeOnly && !m.awk) return false;
  if (!term) return true;
  const elName = ELEMENTS[m.el as 1 | 2 | 3 | 4 | 5]?.name ?? "";
  return m.name.toLowerCase().includes(term) || elName.includes(term) || `${m.nat}★`.includes(term);
}

export function MonsterPickerModal({
  title = "選擇魔靈",
  width = 980,
  entries,
  onPick,
  onClose,
  multi = false,
  pickedCount = 0,
  lastPicked,
  footerLeft,
  extraActions,
  emptyText = "找不到符合條件的魔靈",
}: {
  title?: string;
  width?: number;
  entries: MonsterEntry[];
  onPick: (entry: MonsterEntry) => void;
  onClose: () => void;
  /** true：點擊後不關閉，可連續加入多隻 */
  multi?: boolean;
  pickedCount?: number;
  lastPicked?: string;
  footerLeft?: ReactNode;
  extraActions?: ReactNode;
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const [el, setEl] = useState(0);
  const [nat, setNat] = useState(0);
  const [awakeOnly, setAwakeOnly] = useState(false);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sortMonsterEntries(entries.filter((e) => matches(e.monster, term, el, nat, awakeOnly)));
  }, [entries, q, el, nat, awakeOnly]);

  return (
    <Modal title={title} width={width} onClose={onClose}>
      <div className="mp-toolbar">
        <input
          autoFocus
          className="input"
          placeholder="搜尋魔靈名稱（英文，例如 Lushen）…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mp-filter-row">
          <span className="mp-label">元素</span>
          <button type="button" className={`mp-chip ${el === 0 ? "on" : ""}`} onClick={() => setEl(0)}>全部</button>
          {EL_FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              className={`mp-chip ${el === id ? "on" : ""}`}
              style={{ color: EL_COLOR[id] }}
              onClick={() => setEl(id)}
            >
              <i className="mp-dot" />
              {ELEMENTS[id as 1].name}
            </button>
          ))}
        </div>
        <div className="mp-filter-row">
          <span className="mp-label">胎生星級</span>
          <button type="button" className={`mp-chip ${nat === 0 ? "on" : ""}`} onClick={() => setNat(0)}>全部</button>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={`mp-chip ${nat === n ? "on" : ""}`} onClick={() => setNat(n)}>
              {n}★
            </button>
          ))}
          <label className="row tiny" style={{ gap: 6, marginLeft: "auto", cursor: "pointer" }}>
            <input type="checkbox" checked={awakeOnly} onChange={(e) => setAwakeOnly(e.target.checked)} />
            只顯示已覺醒
          </label>
        </div>
      </div>

      <div className="mp-count">
        符合 {list.length} 隻
        {list.length > 0 && (multi ? " · 點擊即可加入，可連續加入多隻" : " · 點擊即可選擇")}
      </div>

      <div className="mp-grid">
        {list.map((e) => {
          const m = e.monster;
          return (
            <button
              key={e.key}
              type="button"
              className="mp-card"
              disabled={e.disabled}
              title={e.title ?? `${m.name} · ${ELEMENTS[m.el as 1]?.name ?? ""} · ${m.nat}★ · 基礎速度 ${m.spd}`}
              onClick={() => {
                onPick(e);
                if (!multi) onClose();
              }}
            >
              <MonsterIcon id={m.id} size={48} />
              <span className="mp-name">{m.name}</span>
              <span className="mp-meta">
                <span className={`el-${m.el}`}>{ELEMENTS[m.el as 1]?.name}</span> · {m.nat}★
              </span>
              {e.meta && <span className="mp-ext">{e.meta}</span>}
            </button>
          );
        })}
        {list.length === 0 && (
          <div className="empty" style={{ gridColumn: "1 / -1", padding: "32px 16px" }}>{emptyText}</div>
        )}
      </div>

      <div className="row between" style={{ marginTop: 12, gap: 10 }}>
        <span className="tiny dim">
          {footerLeft ?? (multi ? `已加入 ${pickedCount} 隻${lastPicked ? `（最近：${lastPicked}）` : ""}` : "")}
        </span>
        <div className="row" style={{ gap: 8 }}>
          {extraActions}
          <button type="button" className="btn btn-primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </Modal>
  );
}

/** 表單用的魔靈欄位：點開後是與 Speed Tick 相同的卡片式選擇視窗 */
export function MonsterPickerField({
  value,
  onChange,
  options,
  entries,
  placeholder = "搜尋魔靈（英文名）…",
  title,
  label,
}: {
  /** 已選項目的 key（預設等於 monster id，也可以傳入 entries 的 key） */
  value: number;
  onChange: (key: number) => void;
  options?: Monster[];
  /** 自訂清單（例如帳號內每一隻魔靈）；key 會原樣傳回 onChange */
  entries?: MonsterEntry[];
  placeholder?: string;
  title?: string;
  /** 按鈕上顯示的文字，預設為魔靈名稱 */
  label?: (entry: MonsterEntry | undefined) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const list = useMemo(() => entries ?? toMonsterEntries(options), [entries, options]);
  const current = list.find((e) => e.key === String(value));
  const m = current?.monster ?? (value ? monsterOf(value) : undefined);
  const text = label?.(current) ?? (m ? m.name : placeholder);

  return (
    <>
      <button
        type="button"
        className="input"
        style={{ display: "flex", alignItems: "center", gap: 9, textAlign: "left" }}
        onClick={() => setOpen(true)}
      >
        {m ? <MonsterIcon id={m.id} size={26} /> : <Search size={15} className="dim" />}
        <span style={{ flex: 1, color: m ? "var(--text)" : "var(--muted-2)" }}>{text}</span>
        <ChevronDown size={14} className="dim" />
      </button>
      {open && (
        <MonsterPickerModal
          title={title ?? "選擇魔靈"}
          entries={list}
          onPick={(e) => onChange(Number(e.key) || e.monster.id)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
