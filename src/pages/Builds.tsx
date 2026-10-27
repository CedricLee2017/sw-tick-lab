import { useMemo, useState } from "react";
import { Bookmark, RotateCcw, Trash2, Unlock, Wand2 } from "lucide-react";
import { MONSTER_MAP, useStore, monsterLabel } from "../store";
import { SET_BY_ID } from "../lib/constants";
import { setSummary } from "../lib/stats";
import { Modal, MonsterIcon, RuneCard, StatGrid, TickBadge, fmt, setColor } from "../components/ui";
import type { Loadout } from "../store";

export default function BuildsPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
  const loadouts = useStore((s) => s.loadouts);
  const removeLoadout = useStore((s) => s.removeLoadout);
  const notify = useStore((s) => s.notify);
  const setRuneFlag = useStore((s) => s.setRuneFlag);
  const lockedRunes = useStore((s) => s.settings.lockedRunes);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const includedRunes = useStore((s) => s.settings.includedRunes);
  const [open, setOpen] = useState<Loadout | null>(null);

  const sorted = useMemo(() => [...loadouts].sort((a, b) => b.createdAt - a.createdAt), [loadouts]);
  const owner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const rid of u.runes) m.set(rid, monsterLabel(u.master));
    return m;
  }, [account]);

  const apply = (l: Loadout) => {
    sessionStorage.setItem(
      "swtick:draft",
      JSON.stringify({ monsterId: l.monsterId, includeRunes: l.runeIds, mode: "speed", speed: 0 }),
    );
    window.location.hash = "#/optimizer";
    notify("已把配裝帶入配符頁（符文設為 Include）");
  };

  /** 一鍵解除這組符文的 App 鎖定 */
  const clearLocks = (l: Loadout) => {
    const n = l.runeIds.filter((id) => lockedRunes.includes(id)).length;
    setRuneFlag("locked", l.runeIds, false);
    notify(n > 0 ? `已解除 ${n} 顆符文的鎖定` : "這組符文目前沒有鎖定");
  };

  /** 一鍵解除這組符文的 Exclude / Include 限制 */
  const clearRestrictions = (l: Loadout) => {
    const n = l.runeIds.filter((id) => excludedRunes.includes(id) || includedRunes.includes(id)).length;
    setRuneFlag("excluded", l.runeIds, false);
    setRuneFlag("included", l.runeIds, false);
    notify(n > 0 ? `已解除 ${n} 顆符文的 Exclude / Include 限制` : "這組符文目前沒有 Exclude / Include 限制");
  };

  if (!account) return <div className="empty"><Bookmark size={40} /><div>尚未匯入存檔</div></div>;

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title">配裝收藏 BUILDS</div>
          <div className="card-sub">儲存有興趣的符文組合；隨時查看，或一鍵帶回配符頁</div>
        </div>
        <span className="chip gold">{loadouts.length} 組</span>
      </div>

      {sorted.length === 0 ? (
        <div className="empty" style={{ padding: "60px 20px" }}>
          <Bookmark size={40} style={{ opacity: .3, marginBottom: 10 }} />
          <div style={{ fontWeight: 600, color: "var(--text)" }}>還沒有收藏的配裝</div>
          <div className="tiny" style={{ marginTop: 4 }}>在配符結果卡按「儲存為配裝」就會出現在這裡。</div>
        </div>
      ) : (
        <div className="grid g3">
          {sorted.map((l) => {
            const monster = MONSTER_MAP.get(l.monsterId);
            const runes = l.runeIds.map((id) => runeMap.get(id)).filter(Boolean);
            const sets = runes.reduce((m, r) => ({ ...m, [r!.set]: (m[r!.set] ?? 0) + 1 }), {} as Record<number, number>);
            return (
              <div key={l.id} className="card card-pad build-fav">
                <div className="row" style={{ gap: 10 }}>
                  <MonsterIcon id={l.monsterId} size={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{monster?.name ?? l.name}</div>
                    <div className="tiny dim">
                      {new Date(l.createdAt).toLocaleString("zh-TW")} · {runes.length}/6 符文
                    </div>
                  </div>
                  <TickBadge spd={l.stats.spd} />
                </div>
                <div className="row wrap tiny" style={{ gap: 8, marginTop: 8, color: "var(--muted)" }}>
                  <span className="mono gold" style={{ fontSize: 16, fontWeight: 800 }}>{l.stats.spd}</span>
                  <span>HP {fmt(l.stats.hp)}</span>
                  <span>DEF {fmt(l.stats.def)}</span>
                  <span>EHP {fmt(l.stats.ehp)}</span>
                </div>
                <div className="tiny dim" style={{ marginTop: 5 }}>{setSummary(sets) || "—"}</div>
                <div className="row wrap" style={{ gap: 5, marginTop: 8 }}>
                  {runes.slice(0, 6).map((r) => (
                    <span key={r!.id} className="rune-dot" style={{ width: 18, height: 5, borderRadius: 3, background: setColor(r!.set) }} title={SET_BY_ID[r!.set]?.name} />
                  ))}
                </div>
                <div className="row" style={{ gap: 6, marginTop: 10 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => apply(l)}><Wand2 size={12} /> 帶入配符</button>
                  <button className="btn btn-sm" onClick={() => setOpen(l)}>查看</button>
                  <button className="btn btn-sm btn-ghost btn-icon" title="一鍵解鎖" onClick={() => clearLocks(l)}><Unlock size={13} /></button>
                  <button className="btn btn-sm btn-ghost btn-icon" title="一鍵解符（解除 Exclude / Include）" onClick={() => clearRestrictions(l)}><RotateCcw size={13} /></button>
                  <button className="btn btn-sm btn-ghost btn-icon" title="刪除" style={{ marginLeft: "auto" }} onClick={() => removeLoadout(l.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <Modal title={`${MONSTER_MAP.get(open.monsterId)?.name ?? "配裝"} · ${open.name}`} onClose={() => setOpen(null)} width={760}>
          <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
            <div className="tiny dim">儲存於 {new Date(open.createdAt).toLocaleString("zh-TW")}</div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-primary" onClick={() => apply(open)}><Wand2 size={12} /> 帶入配符</button>
              <button className="btn btn-sm" onClick={() => clearLocks(open)}><Unlock size={12} /> 一鍵解鎖</button>
              <button className="btn btn-sm" onClick={() => clearRestrictions(open)}><RotateCcw size={12} /> 一鍵解符</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { removeLoadout(open.id); setOpen(null); }}>
                <Trash2 size={12} /> 刪除
              </button>
            </div>
          </div>
          <StatGrid stats={open.stats} />
          <div className="rune-wheel-head" style={{ marginTop: 14 }}>
            <span className="rune-wheel-title">符文組合</span>
            <span className="tiny dim">{open.runeIds.length}/6</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
            {[1, 2, 3, 4, 5, 6].map((slot) => {
              const r = open.runeIds.map((id) => runeMap.get(id)).find((x) => x?.slot === slot);
              return r ? <RuneCard key={slot} rune={r} owner={owner.get(r.id)} compact /> : (
                <div key={slot} className="rune rune-empty"><span className="tiny dim">位置 {slot} 無符文</span></div>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
