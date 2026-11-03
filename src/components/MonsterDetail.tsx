import { useMemo, type ReactNode } from "react";
import { Trash2, Wand2 } from "lucide-react";
import { useStore } from "../store";
import { SET_BY_ID } from "../lib/constants";
import { setSummary, type BaseStats } from "../lib/stats";
import type { Artifact, Monster, Rune, Stats } from "../lib/types";
import { ArtifactCard, Modal, MonsterPanel, RuneBoard, RuneCard } from "./ui";

/**
 * 魔靈完整面板：魔靈頁、預設隊等地方共用。
 * 內容與「魔靈」頁點選魔靈時完全一致（三圍、符文、神器、套裝加成、鎖定 / 排除）。
 */
export function MonsterDetailModal({
  monster,
  base,
  stats,
  stars,
  level,
  runes,
  artifacts,
  badge,
  title,
  ownerName,
  note,
  custom,
  onRemoveCustom,
  onOptimize,
  onClose,
  width = 820,
}: {
  monster: Monster;
  base: BaseStats;
  stats: Stats;
  stars: number;
  level: number;
  runes: Rune[];
  artifacts: Artifact[];
  /** 標題右側的額外資訊（例如 Tick 徽章） */
  badge?: ReactNode;
  title?: string;
  /** 符文卡片上顯示的擁有者名稱，預設為魔靈名稱 */
  ownerName?: string;
  /** 面板下方的補充說明（例如「依預設隊快照計算」） */
  note?: string;
  /** 自訂魔靈：顯示移除按鈕 */
  custom?: boolean;
  onRemoveCustom?: () => void;
  /** 有提供時顯示「幫這隻配符」 */
  onOptimize?: () => void;
  onClose: () => void;
  width?: number;
}) {
  const lockedRunes = useStore((s) => s.settings.lockedRunes);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const toggleRuneFlag = useStore((s) => s.toggleRuneFlag);
  const lockedSet = useMemo(() => new Set(lockedRunes), [lockedRunes]);
  const excludedSet = useMemo(() => new Set(excludedRunes), [excludedRunes]);

  const owner = ownerName ?? monster.name;
  const setText = runes.length
    ? setSummary(
        Object.fromEntries(runes.reduce((m, r) => m.set(r.set, (m.get(r.set) ?? 0) + 1), new Map<number, number>())),
      )
    : "未裝備";

  return (
    <Modal title={title ?? monster.name} onClose={onClose} width={width}>
      <MonsterPanel
        monster={monster}
        base={base}
        stats={stats}
        stars={stars}
        level={level}
        artifacts={artifacts}
        badge={badge}
      />

      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        <span className="chip gold">{monster.nat}★ 原生</span>
        <span className="chip muted">符文 {runes.length}/6</span>
        <span className="chip muted">神器 {artifacts.length}/2</span>
        {custom && <span className="chip gold">自訂魔靈</span>}
      </div>

      {note && (
        <div className="tiny dim" style={{ marginTop: 8, lineHeight: 1.65 }}>
          {note}
        </div>
      )}

      <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
        <div className="card-title">目前配裝</div>
        <span className="tiny dim">{setText}</span>
      </div>

      {runes.length === 0 ? (
        <div className="empty tiny">這隻魔靈目前沒有裝備符文</div>
      ) : (
        <RuneBoard
          runes={runes}
          renderRune={(r) => (
            <RuneCard
              rune={r}
              owner={owner}
              locked={lockedSet.has(r.id)}
              excluded={excludedSet.has(r.id)}
              onToggleLock={() => toggleRuneFlag("locked", r.id)}
              onToggleExclude={() => toggleRuneFlag("excluded", r.id)}
            />
          )}
        />
      )}

      <div className="row between" style={{ marginTop: 18, marginBottom: 8 }}>
        <div className="card-title">神器</div>
        <span className="tiny dim">裝備 {artifacts.length} / 2</span>
      </div>
      {artifacts.length === 0 ? (
        <div className="empty tiny">這隻魔靈目前沒有裝備神器</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
          {artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={owner} />)}
        </div>
      )}

      <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
        {onOptimize && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onOptimize}>
            <Wand2 size={13} /> 幫這隻配符
          </button>
        )}
        <span className="tiny dim">
          套裝加成：
          {runes.length
            ? Object.entries(runes.reduce((acc, r) => ({ ...acc, [r.set]: (acc[r.set] ?? 0) + 1 }), {} as Record<number, number>))
                .map(([id, c]) => `${SET_BY_ID[Number(id)]?.name}×${c}`)
                .join(" · ")
            : "—"}
        </span>
      </div>

      {custom && onRemoveCustom && (
        <div
          className="row between wrap"
          style={{ marginTop: 16, paddingTop: 12, gap: 8, borderTop: "1px dashed var(--line-soft)" }}
        >
          <span className="tiny dim" style={{ flex: 1, minWidth: 180, lineHeight: 1.6 }}>
            這是自訂魔靈，只存在這台裝置。重新匯入存檔時會保留，但配裝會被清空。
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ color: "var(--red, #ff7b7b)" }}
            onClick={onRemoveCustom}
          >
            <Trash2 size={13} /> 移除自訂魔靈
          </button>
        </div>
      )}
    </Modal>
  );
}
