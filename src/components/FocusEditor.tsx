import { Plus, Target, X } from "lucide-react";
import { NumberInput } from "./ui";
import { FOCUS_LIMIT, FOCUS_OPTIONS } from "../lib/optimizer";
import type { FocusEntry } from "../lib/types";
import type { StatKey } from "../lib/constants";

/**
 * 焦點屬性編輯器（一鍵配隊的每隻魔靈使用）。
 * 最多 5 組；比重越高，該屬性數值高的符文越優先進入候選池。
 */
export function FocusEditor({
  value,
  onChange,
}: {
  value: FocusEntry[];
  onChange: (v: FocusEntry[]) => void;
}) {
  const used = new Set(value.map((f) => f.key));
  const total = value.reduce((s, f) => s + f.weight, 0);

  const add = () => {
    const next = FOCUS_OPTIONS.find((o) => !used.has(o.key));
    if (!next) return;
    onChange([...value, { key: next.key, weight: 6 }]);
  };

  return (
    <div className="focus-panel" style={{ marginTop: 10 }}>
      <div className="row between" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          <Target size={13} className="gold" />
          <span className="focus-title">焦點屬性</span>
          <span className="tiny dim">{value.length}/{FOCUS_LIMIT}</span>
        </div>
        {value.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([])}>
            清除
          </button>
        )}
      </div>
      <div className="hint" style={{ lineHeight: 1.5 }}>
        最多 5 組。比重越高，該屬性數值高的符文越優先被選進候選池（1 = 輕微、10 = 最優先）。
      </div>
      {value.map((f, i) => (
        <div className="focus-row" key={f.key}>
          <select
            className="select"
            value={f.key}
            onChange={(e) =>
              onChange(value.map((x, j) => (j === i ? { ...x, key: e.target.value as StatKey } : x)))
            }
          >
            {FOCUS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key} disabled={o.key !== f.key && used.has(o.key)}>
                {o.label}
              </option>
            ))}
          </select>
          <NumberInput
            className="input mono"
            min={1}
            max={10}
            value={f.weight}
            title="比重 1~10"
            onChange={(v) => {
              const w = Math.max(1, Math.min(10, Math.round(v)));
              onChange(value.map((x, j) => (j === i ? { ...x, weight: w } : x)));
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-icon"
            title="移除"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {value.length < FOCUS_LIMIT && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={add} style={{ width: "100%" }}>
          <Plus size={13} /> 新增焦點屬性
        </button>
      )}
      {value.length > 0 && (
        <div className="row between tiny dim">
          <span>比重合計 {total}</span>
          <span>數值愈高 → 愈優先被抽入</span>
        </div>
      )}
    </div>
  );
}
