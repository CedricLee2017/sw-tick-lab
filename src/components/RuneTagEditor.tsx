/** 自行分類（標籤）編輯器：名稱 + 套裝 + 副屬性門檻 */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { RUNE_SETS, STAT_TYPES } from "../lib/constants";
import { tagRequiredMatches } from "../lib/runeTags";
import type { RuneTagRule } from "../lib/types";
import { Modal, NumberInput } from "./ui";

/** 可選的屬性條件（速度、百分比、爆擊、命中抵抗、固定值） */
const STAT_OPTIONS = [8, 2, 4, 6, 9, 10, 11, 12, 1, 3, 5];
/** 遠古（99）只是標記，不是可選的套裝 */
const SET_OPTIONS = RUNE_SETS.filter((s) => s.id !== 99);

export default function RuneTagEditor({
  rule,
  onSave,
  onClose,
}: {
  rule: RuneTagRule;
  onSave: (rule: RuneTagRule) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<RuneTagRule>(() => ({
    ...rule,
    sets: [...rule.sets],
    stats: rule.stats.map((s) => ({ ...s })),
  }));

  const patch = (p: Partial<RuneTagRule>) => setDraft((d) => ({ ...d, ...p }));
  const need = tagRequiredMatches(draft);
  const nameOk = draft.name.trim().length > 0;

  const toggleSet = (id: number) =>
    patch({
      sets: draft.sets.includes(id) ? draft.sets.filter((x) => x !== id) : [...draft.sets, id].sort((a, b) => a - b),
    });

  const setStat = (i: number, p: Partial<{ t: number; min: number }>) =>
    patch({ stats: draft.stats.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  const addStat = () => {
    // 優先挑還沒用過的屬性，避免同一條屬性重複設定
    const used = new Set(draft.stats.map((s) => s.t));
    const t = STAT_OPTIONS.find((x) => !used.has(x)) ?? 8;
    patch({ stats: [...draft.stats, { t, min: 15 }] });
  };

  const removeStat = (i: number) => {
    const stats = draft.stats.filter((_, j) => j !== i);
    patch({ stats, minMatch: Math.min(Math.max(1, draft.minMatch), Math.max(1, stats.length)) });
  };

  return (
    <Modal title={rule.name ? `編輯自行分類「${rule.name}」` : "新增自行分類"} onClose={onClose} width={640}>
      <div className="col" style={{ gap: 12 }}>
        <div>
          <div className="tiny dim" style={{ marginBottom: 4 }}>名稱</div>
          <input
            className="input"
            style={{ width: "100%" }}
            value={draft.name}
            placeholder="例如：極限輸出符"
            autoFocus
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>

        <div>
          <div className="row between" style={{ marginBottom: 5 }}>
            <span className="tiny dim">限定套裝（不選 = 不限套裝）</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch({ sets: [] })}>清除</button>
          </div>
          <div className="tag-set-box">
            {SET_OPTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip ${draft.sets.includes(s.id) ? "gold" : "muted"}`}
                style={{ cursor: "pointer" }}
                aria-pressed={draft.sets.includes(s.id)}
                onClick={() => toggleSet(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="row between" style={{ marginBottom: 5 }}>
            <span className="tiny dim">
              副屬性門檻（副屬性＋固有，含精煉；不計主屬性）
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={addStat} disabled={draft.stats.length >= STAT_OPTIONS.length}>
              <Plus size={12} /> 新增條件
            </button>
          </div>
          {draft.stats.length === 0 && (
            <div className="tiny dim" style={{ padding: "6px 2px" }}>
              沒有屬性條件時，只會依套裝標記（適合「只要是猛攻就標起來」這種用法）。
            </div>
          )}
          <div className="col" style={{ gap: 6 }}>
            {draft.stats.map((s, i) => (
              <div key={i} className="row" style={{ gap: 6 }}>
                <select
                  className="select"
                  style={{ width: 132 }}
                  value={s.t}
                  onChange={(e) => setStat(i, { t: Number(e.target.value) })}
                >
                  {STAT_OPTIONS.map((t) => (
                    <option key={t} value={t}>{STAT_TYPES[t]?.label ?? `屬性 ${t}`}</option>
                  ))}
                </select>
                <span className="tiny dim">≥</span>
                <NumberInput
                  className="input mono"
                  style={{ width: 92 }}
                  min={0}
                  max={2000}
                  step={1}
                  value={s.min}
                  onChange={(v) => setStat(i, { min: v })}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-icon"
                  title="移除這條條件"
                  onClick={() => removeStat(i)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {draft.stats.length > 1 && (
          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <span className="tiny dim">符合條件數</span>
            <select
              className="select"
              style={{ width: 150 }}
              value={need}
              onChange={(e) => patch({ minMatch: Number(e.target.value) })}
            >
              {draft.stats.map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1 === draft.stats.length ? `全部 ${i + 1} 條` : i === 0 ? "任一 1 條" : `任 ${i + 1} 條`}
                </option>
              ))}
            </select>
            <span className="tiny dim">
              {need < draft.stats.length
                ? `符合其中 ${need} 條就算這個分類`
                : "所有屬性門檻都要達到才算"}
            </span>
          </div>
        )}

        <label className="row tiny" style={{ gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          啟用這個分類（關閉後不再標記、也不出現在篩選）
        </label>

        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>取消</button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!nameOk}
            title={nameOk ? "儲存這個分類" : "請先輸入名稱"}
            onClick={() => onSave({ ...draft, name: draft.name.trim(), minMatch: need })}
          >
            儲存
          </button>
        </div>
      </div>
    </Modal>
  );
}
