import { useMemo, useState } from "react";
import { Ban, Pin, Plus, X } from "lucide-react";
import { MONSTER_MAP, monsterLabel, useStore } from "../store";
import { SET_BY_ID, STAT_TYPES } from "../lib/constants";
import { fmt } from "./ui";
import type { Rune } from "../lib/types";

type Flag = "excluded" | "included";

const runeLabel = (r: Rune) =>
  `#${r.slot} ${SET_BY_ID[r.set]?.name ?? `套裝${r.set}`} · ${STAT_TYPES[r.main.t]?.label ?? "?"} +${fmt(r.main.v)}`;

/** 排除 / 固定使用符文（可一次加入整隻魔靈目前裝備的符文） */
export function RuneRestrictions({ targetUnit }: { targetUnit: number }) {
  const account = useStore((s) => s.account);
  const settings = useStore((s) => s.settings);
  const setRuneFlag = useStore((s) => s.setRuneFlag);
  const toggleRuneFlag = useStore((s) => s.toggleRuneFlag);
  const notify = useStore((s) => s.notify);
  const [tab, setTab] = useState<Flag>("excluded");

  const runeMap = useMemo(() => new Map((account?.runes ?? []).map((r) => [r.id, r])), [account]);
  const owner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const rid of u.runes) m.set(rid, monsterLabel(u.master));
    return m;
  }, [account]);

  const units = useMemo(() => {
    if (!account) return [];
    return account.units
      .map((u) => ({ u, m: MONSTER_MAP.get(u.master) }))
      .filter((x) => !!x.m)
      .sort((a, b) => a.m!.name.localeCompare(b.m!.name));
  }, [account]);

  const selected = tab === "excluded" ? settings.excludedRunes : settings.includedRunes;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const lockedSet = useMemo(() => new Set(settings.lockedRunes), [settings.lockedRunes]);

  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    if (!account || !q.trim()) return [];
    const s = q.trim().toLowerCase();
    return account.runes
      .filter((r) => {
        const text = `${r.id} ${SET_BY_ID[r.set]?.name ?? ""} ${SET_BY_ID[r.set]?.en ?? ""} ${STAT_TYPES[r.main.t]?.label ?? ""} ${owner.get(r.id) ?? ""}`.toLowerCase();
        return text.includes(s);
      })
      .slice(0, 8);
  }, [account, q, owner]);

  if (!account) return null;

  const addIds = (ids: number[]) => {
    if (ids.length === 0) return;
    let next = [...ids];
    if (tab === "included") {
      // 每個位置只能固定一顆：新加入的同位置符文會取代舊的
      const slots = new Set(next.map((id) => runeMap.get(id)?.slot).filter(Boolean));
      const kept = settings.includedRunes.filter((id) => {
        const r = runeMap.get(id);
        return r && !slots.has(r.slot);
      });
      if (kept.length !== settings.includedRunes.length) {
        setRuneFlag("included", settings.includedRunes.filter((id) => !kept.includes(id)), false);
      }
      // 鎖定在別的魔靈身上的符文不可拿來固定使用
      const blocked = next.filter((id) => {
        const r = runeMap.get(id);
        return r && lockedSet.has(id) && (!targetUnit || r.occupied !== targetUnit);
      });
      if (blocked.length > 0) {
        next = next.filter((id) => !blocked.includes(id));
        notify(`有 ${blocked.length} 顆符文已鎖定在別的魔靈，不能加入固定使用`, "err");
      }
    }
    if (next.length > 0) setRuneFlag(tab, next, true);
  };

  const addUnit = (unitId: number) => {
    const u = units.find((x) => x.u.id === unitId)?.u;
    if (!u) return;
    if (u.runes.length === 0) return notify("這隻魔靈目前沒有裝備符文", "err");
    addIds(u.runes);
    notify(`已將 ${MONSTER_MAP.get(u.master)?.name ?? "魔靈"} 的 ${u.runes.length} 顆符文加入${tab === "excluded" ? "排除" : "固定使用"}`);
  };

  const addRune = (r: Rune) => {
    addIds([r.id]);
    setQ("");
  };

  const shown = selected.slice(0, 24);

  return (
    <div className="card card-pad rune-restrict">
      <div className="row between" style={{ gap: 8 }}>
        <div className="card-title">符文限制</div>
        <span className="tiny dim">Exclude / Include</span>
      </div>
      <div className="tabs" style={{ width: "100%", marginTop: 8 }}>
        <button type="button" className={`tab ${tab === "excluded" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setTab("excluded")}>
          <Ban size={12} /> 排除 Exclude（{settings.excludedRunes.length}）
        </button>
        <button type="button" className={`tab ${tab === "included" ? "active" : ""}`} style={{ flex: 1 }} onClick={() => setTab("included")}>
          <Pin size={12} /> 固定使用 Include（{settings.includedRunes.length}）
        </button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {tab === "excluded"
          ? "排除的符文不會進入任何配符；加入整隻魔靈會排除牠目前裝備的全部符文。"
          : "固定使用的符文會鎖定該位置；每個位置最多一顆，加入整隻魔靈會固定牠目前裝備的全部符文。"}
      </div>

      <div className="grid g2" style={{ gap: 6, marginTop: 8 }}>
        <select
          className="select"
          value={0}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) addUnit(id);
            e.target.value = "0";
          }}
        >
          <option value={0}>加入整隻魔靈的符文…</option>
          {units.map(({ u, m }) => (
            <option key={u.id} value={u.id}>
              {m!.name} · {u.stars}★Lv.{u.level}（{u.runes.length} 顆）
            </option>
          ))}
        </select>
        <div style={{ position: "relative" }}>
          <input
            className="input"
            placeholder="搜尋符文 ID / 套裝 / 主屬 / 擁有者"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q.trim() && (
            <div className="rune-search-pop">
              {matches.map((r) => (
                <button key={r.id} type="button" onClick={() => addRune(r)}>
                  <span>{runeLabel(r)}</span>
                  <span className="tiny dim">{owner.get(r.id) ?? "未裝備"} · ID {r.id}</span>
                </button>
              ))}
              {matches.length === 0 && <div className="empty tiny" style={{ padding: 12 }}>找不到符文</div>}
            </div>
          )}
        </div>
      </div>

      <div className="rune-chip-list" style={{ marginTop: 8 }}>
        {shown.map((id) => {
          const r = runeMap.get(id);
          if (!r) return null;
          return (
            <span key={id} className={`rune-chip ${selectedSet.has(id) ? "on" : ""}`}>
              {runeLabel(r)}
              <span className="dim tiny"> {owner.get(id) ?? "未裝備"}</span>
              <button type="button" title="移除" onClick={() => toggleRuneFlag(tab, id)}><X size={10} /></button>
            </span>
          );
        })}
        {selected.length === 0 && <span className="tiny dim">尚未選擇</span>}
        {selected.length > shown.length && <span className="tiny dim">… 另有 {selected.length - shown.length} 顆</span>}
      </div>
      {selected.length > 0 && (
        <div className="row" style={{ marginTop: 6, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRuneFlag(tab, selected, false)}>
            清除全部
          </button>
        </div>
      )}
    </div>
  );
}
