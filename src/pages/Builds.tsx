import { useMemo, useState } from "react";
import { Ban, Bookmark, Layers, Loader2, RefreshCw, RotateCcw, Shirt, Trash2, Unlock, Wand2 } from "lucide-react";
import { MONSTER_MAP, unitLabel, useStore, monsterLabel } from "../store";
import { SET_BY_ID } from "../lib/constants";
import { setSummary, baseStats } from "../lib/stats";
import { deckTypeLabel } from "../lib/deckTypes";
import { sendOptimizerDraft } from "../lib/draft";
import { ArtifactCard, Modal, MonsterIcon, MonsterPanel, RuneBoard, RuneCard, TickBadge, fmt, setColor } from "../components/ui";
import type { Artifact, Rune } from "../lib/types";
import type { DeckFav, Loadout } from "../store";

export default function BuildsPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
  const loadouts = useStore((s) => s.loadouts);
  const removeLoadout = useStore((s) => s.removeLoadout);
  const deckFavs = useStore((s) => s.deckFavs);
  const removeDeckFav = useStore((s) => s.removeDeckFav);
  const notify = useStore((s) => s.notify);
  const syncLibrary = useStore((s) => s.syncLibrary);
  const setRuneFlag = useStore((s) => s.setRuneFlag);
  const equipRunes = useStore((s) => s.equipRunes);
  const lockedRunes = useStore((s) => s.settings.lockedRunes);
  const excludedRunes = useStore((s) => s.settings.excludedRunes);
  const includedRunes = useStore((s) => s.settings.includedRunes);
  const excludedArtifacts = useStore((s) => s.settings.excludedArtifacts ?? []);
  const setArtifactExcluded = useStore((s) => s.setArtifactExcluded);
  const [open, setOpen] = useState<Loadout | null>(null);
  const [openDeck, setOpenDeck] = useState<DeckFav | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const syncNow = async () => {
    setSyncing(true);
    setSyncMsg(null);
    const res = await syncLibrary();
    setSyncing(false);
    setSyncMsg(res.ok ? (res.pushed ? "已同步（已上傳本機變更）" : "已同步") : res.error ?? "同步失敗");
    if (res.ok) notify(res.pushed ? "儲存庫已同步並上傳" : "儲存庫已同步");
  };

  const sortedDecks = useMemo(
    () => [...deckFavs].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    [deckFavs],
  );

  const sorted = useMemo(
    () => [...loadouts].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    [loadouts],
  );
  const owner = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const rid of u.runes) m.set(rid, unitLabel(u));
    return m;
  }, [account]);
  const artifactMap = useMemo(() => new Map((account?.artifacts ?? []).map((a) => [a.id, a])), [account]);

  /**
   * 找出魔靈要排除的裝備：優先用儲存庫快照，快照沒有時才用目前裝備。
   * 只保留目前帳號真的存在的符文 / 神器，避免舊資料把不存在的 id 寫進排除清單。
   */
  const unitEquipOf = (
    unitId: number,
    master: number,
    snapshotRunes: number[] = [],
    snapshotArtifacts: number[] = [],
  ) => {
    const current =
      (unitId ? account?.units.find((u) => u.id === unitId) : undefined) ??
      account?.units.find((u) => u.master === master);
    const runes = (snapshotRunes.length > 0 ? snapshotRunes : current?.runes ?? []).filter((id) => runeMap.has(id));
    const artifacts = (snapshotArtifacts.length > 0 ? snapshotArtifacts : current?.artifacts ?? []).filter((id) =>
      artifactMap.has(id),
    );
    return { runes, artifacts };
  };

  const loadoutEquipOf = (l: Loadout) => ({
    runes: l.runeIds.filter((id) => runeMap.has(id)),
    artifacts: (l.unitId ? account?.units.find((u) => u.id === l.unitId)?.artifacts ?? [] : []).filter((id) =>
      artifactMap.has(id),
    ),
  });

  const deckEquipOf = (d: DeckFav) => {
    const runes = new Set<number>();
    const artifacts = new Set<number>();
    for (const u of d.units) {
      const eq = unitEquipOf(u.unitId, u.master, u.runeIds, u.artifactIds);
      for (const id of eq.runes) runes.add(id);
      for (const id of eq.artifacts) artifacts.add(id);
    }
    return { runes: [...runes], artifacts: [...artifacts] };
  };

  const allExcluded = (runes: number[], artifacts: number[]) =>
    runes.length + artifacts.length > 0 &&
    runes.every((id) => excludedRunes.includes(id)) &&
    artifacts.every((id) => excludedArtifacts.includes(id));

  /** 一鍵排除 / 解除排除：符文與神器一起處理 */
  const toggleExclusion = (runes: number[], artifacts: number[], label: string) => {
    if (runes.length + artifacts.length === 0) {
      notify(`${label} 沒有可排除的符文或神器`, "err");
      return;
    }
    const off = allExcluded(runes, artifacts);
    setRuneFlag("excluded", runes, !off);
    setArtifactExcluded(artifacts, !off);
    const detail = `${runes.length} 顆符文 / ${artifacts.length} 件神器`;
    notify(
      off
        ? `已解除 ${label} 的排除（${detail}）`
        : `已排除 ${label} 的 ${detail}；配符與一鍵配隊不會再使用`,
      "ok",
    );
  };

  /** 檢視配裝時用來顯示「基礎＋綠色加成」的魔靈與等級 */
  const openMonster = open ? MONSTER_MAP.get(open.monsterId) : undefined;
  const openUnit = open && account
    ? account.units.find((u) => (open.unitId ? u.id === open.unitId : u.master === open.monsterId))
    : undefined;

  /** 把預設隊儲存庫中某一隻魔靈的符文帶到配符頁（設為包括） */
  const applyDeckUnit = (master: number, runeIds: number[]) => {
    sendOptimizerDraft({ monsterId: master, includeRunes: runeIds, mode: "speed", speed: 0 });
    window.location.hash = "#/optimizer";
    notify("已把這隻魔靈的符文帶入配符頁（符文設為包括）");
  };

  const apply = (l: Loadout) => {
    sendOptimizerDraft({ monsterId: l.monsterId, includeRunes: l.runeIds, mode: "speed", speed: 0 });
    window.location.hash = "#/optimizer";
    notify("已把配裝帶入配符頁（符文設為包括）");
  };

  /** 一鍵把收藏的符文上符到該魔靈（僅本工具本機模擬） */
  const equip = (l: Loadout) => {
    const target =
      (l.unitId ? account?.units.find((u) => u.id === l.unitId && u.master === l.monsterId) : undefined) ??
      account?.units.find((u) => u.master === l.monsterId);
    if (!target) return notify("找不到這組配裝對應的魔靈", "err");
    const n = equipRunes(target.id, l.runeIds);
    notify(
      n > 0
        ? `已將 ${n} 顆符文上符到 ${monsterLabel(target.master)}（僅本機模擬，不會修改遊戲）`
        : "上符失敗：沒有可用的符文",
      n > 0 ? "ok" : "err",
    );
  };

  /** 一鍵解除這組符文的 App 鎖定 */
  const clearLocks = (l: Loadout) => {
    const n = l.runeIds.filter((id) => lockedRunes.includes(id)).length;
    setRuneFlag("locked", l.runeIds, false);
    notify(n > 0 ? `已解除 ${n} 顆符文的鎖定` : "這組符文目前沒有鎖定");
  };

  /** 一鍵解除這組符文的排除／包括限制 */
  const clearRestrictions = (l: Loadout) => {
    const n = l.runeIds.filter((id) => excludedRunes.includes(id) || includedRunes.includes(id)).length;
    setRuneFlag("excluded", l.runeIds, false);
    setRuneFlag("included", l.runeIds, false);
    notify(n > 0 ? `已解除 ${n} 顆符文的排除／包括限制` : "這組符文目前沒有排除／包括限制");
  };

  /** 目前開啟的預設隊要排除的裝備（給詳細視窗的整隊按鈕用） */
  const openDeckEquip = openDeck ? deckEquipOf(openDeck) : null;
  const openDeckExcluded = openDeckEquip ? allExcluded(openDeckEquip.runes, openDeckEquip.artifacts) : false;
  /** 目前開啟的配裝要排除的裝備 */
  const openLoadoutEquip = open ? loadoutEquipOf(open) : null;
  const openLoadoutExcluded = openLoadoutEquip
    ? allExcluded(openLoadoutEquip.runes, openLoadoutEquip.artifacts)
    : false;

  if (!account) return <div className="empty"><Bookmark size={40} /><div>尚未匯入存檔</div></div>;

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title">儲存庫</div>
          <div className="card-sub">整隊存到預設隊儲存庫，單隻魔靈存到配裝儲存庫；隨時查看或帶回配符頁</div>
        </div>
        <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void syncNow()}
            disabled={syncing}
            title="從雲端拉取其他裝置的變更，並上傳本機的新增 / 修改"
          >
            {syncing ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />} 同步雲端
          </button>
          {syncMsg && <span className="tiny dim">{syncMsg}</span>}
          <span className="chip gold">預設隊 {deckFavs.length} 組</span>
          <span className="chip gold">配裝 {loadouts.length} 組</span>
        </div>
      </div>

      <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
        <div className="card-title row" style={{ gap: 7 }}>
          <Layers size={15} className="gold" /> 預設隊儲存庫
        </div>
        <span className="tiny dim">在「預設隊」或「一鍵配隊」頁按「儲存」加入</span>
      </div>

      {sortedDecks.length === 0 ? (
        <div className="empty" style={{ padding: "30px 20px", marginBottom: 20 }}>
          <Layers size={34} style={{ opacity: .3, marginBottom: 8 }} />
          <div style={{ fontWeight: 600, color: "var(--text)" }}>還沒有儲存的預設隊</div>
          <div className="tiny" style={{ marginTop: 4 }}>到「預設隊」頁按「儲存整隊」，或在「一鍵配隊」頁按「儲存到儲存庫」就會出現在這裡。</div>
        </div>
      ) : (
        <div className="grid g3" style={{ marginBottom: 22 }}>
          {sortedDecks.map((d) => {
            const runeCount = d.units.reduce((s, u) => s + u.runeIds.length, 0);
            const artifactCount = d.units.reduce((s, u) => s + u.artifactIds.length, 0);
            const eq = deckEquipOf(d);
            const off = allExcluded(eq.runes, eq.artifacts);
            return (
              <div key={d.id} className="card card-pad build-fav">
                <div className="row between" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 6, minWidth: 0 }}>
                    <span className="chip gold">{deckTypeLabel(d.type)}</span>
                    <span className="tiny dim">第 {d.seq} 隊 · {d.units.length} 人</span>
                    {off && <span className="chip muted">已排除</span>}
                  </div>
                  <span className="tiny dim">{new Date(d.updatedAt ?? d.createdAt).toLocaleDateString("zh-TW")}</span>
                </div>
                <div className="deck-units" style={{ marginTop: 8 }}>
                  {d.units.map((u) => (
                    <span key={u.unitId} className="deck-unit" title={monsterLabel(u.master)}>
                      <MonsterIcon id={u.master} size={34} />
                      <span className="tiny">{monsterLabel(u.master)}</span>
                    </span>
                  ))}
                </div>
                <div className="row wrap tiny dim" style={{ gap: 8, marginTop: 8 }}>
                  <span>{runeCount} 顆符文</span>
                  <span>{artifactCount} 件神器</span>
                  {d.battlePower ? <span>戰力 {fmt(d.battlePower)}</span> : null}
                </div>
                <div className="row" style={{ gap: 6, marginTop: 10 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => setOpenDeck(d)}>查看</button>
                  <button
                    className={`btn btn-sm ${off ? "" : "btn-ghost"}`}
                    title={off ? "解除整隊的符文與神器排除" : "排除整隊已裝備的符文與神器（配符與一鍵配隊不會使用）"}
                    onClick={() => toggleExclusion(eq.runes, eq.artifacts, `第 ${d.seq} 隊`)}
                  >
                    {off ? <RotateCcw size={12} /> : <Ban size={12} />} {off ? "解除排除" : "一鍵排除"}
                  </button>
                  <button className="btn btn-sm btn-ghost btn-icon" title="刪除" style={{ marginLeft: "auto" }} onClick={() => removeDeckFav(d.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
        <div className="card-title row" style={{ gap: 7 }}>
          <Bookmark size={15} className="gold" /> 配裝儲存庫
        </div>
        <span className="tiny dim">在「預設隊」頁按單隻魔靈的「儲存這隻」，或配符結果的「儲存為配裝」加入</span>
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
            const eq = loadoutEquipOf(l);
            const off = allExcluded(eq.runes, eq.artifacts);
            return (
              <div key={l.id} className="card card-pad build-fav">
                <div className="row" style={{ gap: 10 }}>
                  <MonsterIcon id={l.monsterId} size={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{monster?.name ?? l.name}</div>
                    <div className="tiny dim">
                      {new Date(l.updatedAt ?? l.createdAt).toLocaleString("zh-TW")} · {runes.length}/6 符文
                    </div>
                  </div>
                  {off && <span className="chip muted">已排除</span>}
                  <TickBadge spd={l.stats.spd} />
                </div>
                <div className="row wrap tiny" style={{ gap: 8, marginTop: 8, color: "var(--muted)" }}>
                  <span className="mono gold" style={{ fontSize: 16, fontWeight: 800 }} title="遊戲面板速度（不含建築 / 隊長 / 強化）">{l.stats.panelSpd ?? l.stats.spd}</span>
                  <span className="tiny dim">面板速</span>
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
                  <button className="btn btn-sm btn-ghost btn-icon" title="一鍵上符（本機模擬）" onClick={() => equip(l)}><Shirt size={13} /></button>
                  <button
                    className={`btn btn-sm btn-icon ${off ? "" : "btn-ghost"}`}
                    title={off ? "解除這組配裝的符文與神器排除" : "排除這組配裝的符文與神器（配符與一鍵配隊不會使用）"}
                    onClick={() => toggleExclusion(eq.runes, eq.artifacts, `配裝「${monster?.name ?? l.name}」`)}
                  >
                    {off ? <RotateCcw size={13} /> : <Ban size={13} />}
                  </button>
                  <button className="btn btn-sm btn-ghost btn-icon" title="一鍵解鎖" onClick={() => clearLocks(l)}><Unlock size={13} /></button>
                  <button className="btn btn-sm btn-ghost btn-icon" title="一鍵解符（解除排除／包括）" onClick={() => clearRestrictions(l)}><RotateCcw size={13} /></button>
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
            <div className="tiny dim">更新於 {new Date(open.updatedAt ?? open.createdAt).toLocaleString("zh-TW")}</div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-primary" onClick={() => apply(open)}><Wand2 size={12} /> 帶入配符</button>
              <button className="btn btn-sm" onClick={() => equip(open)}><Shirt size={12} /> 一鍵上符</button>
              <button
                className={`btn btn-sm ${openLoadoutExcluded ? "" : "btn-ghost"}`}
                onClick={() => openLoadoutEquip && toggleExclusion(openLoadoutEquip.runes, openLoadoutEquip.artifacts, `配裝「${MONSTER_MAP.get(open.monsterId)?.name ?? open.name}」`)}
                title={openLoadoutExcluded ? "解除這組配裝的符文與神器排除" : "排除這組配裝的符文與神器"}
              >
                {openLoadoutExcluded ? <RotateCcw size={12} /> : <Ban size={12} />}
                {openLoadoutExcluded ? "解除排除" : "一鍵排除"}
              </button>
              <button className="btn btn-sm" onClick={() => clearLocks(open)}><Unlock size={12} /> 一鍵解鎖</button>
              <button className="btn btn-sm" onClick={() => clearRestrictions(open)}><RotateCcw size={12} /> 一鍵解符</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { removeLoadout(open.id); setOpen(null); }}>
                <Trash2 size={12} /> 刪除
              </button>
            </div>
          </div>
          {openMonster && (
            <MonsterPanel
              monster={openMonster}
              base={baseStats(openMonster, openUnit?.stars ?? 6, openUnit?.level ?? 40)}
              stats={open.stats}
              stars={openUnit?.stars ?? 6}
              level={openUnit?.level ?? 40}
              artifacts={(openUnit?.artifacts ?? []).map((id) => artifactMap.get(id)).filter((a): a is Artifact => !!a)}
            />
          )}
          <div className="tiny dim" style={{ marginTop: 8, lineHeight: 1.6 }}>
            「一鍵上符」只會修改本工具的本機資料，把這 6 顆符文標記為裝備在 {MONSTER_MAP.get(open.monsterId)?.name ?? "這隻魔靈"} 身上；
            不會修改遊戲存檔。其他原本穿著這些符文的魔靈會自動失去該符文。
          </div>
          <div className="rune-wheel-head" style={{ marginTop: 14 }}>
            <span className="rune-wheel-title">符文組合</span>
            <span className="tiny dim">{open.runeIds.length}/6</span>
          </div>
          <RuneBoard
            runes={open.runeIds.map((id) => runeMap.get(id)).filter((r): r is Rune => !!r)}
            renderRune={(r) => <RuneCard rune={r} owner={owner.get(r.id)} />}
          />
        </Modal>
      )}

      {openDeck && (
        <Modal title={`${deckTypeLabel(openDeck.type)} · 第 ${openDeck.seq} 隊`} onClose={() => setOpenDeck(null)} width={940}>
          <div className="row between wrap" style={{ gap: 8, marginBottom: 12 }}>
            <span className="tiny dim">
              共 {openDeck.units.length} 隻
              {openDeck.battlePower ? ` · 戰力 ${fmt(openDeck.battlePower)}` : ""} · 更新於 {new Date(openDeck.updatedAt ?? openDeck.createdAt).toLocaleString("zh-TW")}
            </span>
            <div className="row" style={{ gap: 6 }}>
              {openDeckEquip && (
                <button
                  className={`btn btn-sm ${openDeckExcluded ? "" : "btn-ghost"}`}
                  title={openDeckExcluded ? "解除整隊的符文與神器排除" : "排除整隊已裝備的符文與神器"}
                  onClick={() => toggleExclusion(openDeckEquip.runes, openDeckEquip.artifacts, `第 ${openDeck.seq} 隊`)}
                >
                  {openDeckExcluded ? <RotateCcw size={12} /> : <Ban size={12} />}
                  {openDeckExcluded ? "解除整隊排除" : "一鍵排除整隊"}
                </button>
              )}
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  removeDeckFav(openDeck.id);
                  setOpenDeck(null);
                }}
              >
                <Trash2 size={12} /> 刪除這一隊
              </button>
            </div>
          </div>
          <div className="col" style={{ gap: 14 }}>
            {openDeck.units.map((u) => {
              const runes = u.runeIds.map((id) => runeMap.get(id)).filter((r): r is Rune => !!r);
              const artifacts = u.artifactIds.map((id) => artifactMap.get(id)).filter((a): a is Artifact => !!a);
              const eq = unitEquipOf(u.unitId, u.master, u.runeIds, u.artifactIds);
              const off = allExcluded(eq.runes, eq.artifacts);
              return (
                <div key={u.unitId} className="deck-detail">
                  <div className="row between" style={{ gap: 10 }}>
                    <div className="row" style={{ gap: 10, minWidth: 0 }}>
                      <MonsterIcon id={u.master} size={46} />
                      <div style={{ flex: 1 }}>
                        <div className="row wrap" style={{ gap: 6 }}>
                          <b>{monsterLabel(u.master)}</b>
                          <span className="tiny dim">{runes.length}/6 符文 · {artifacts.length}/2 神器</span>
                          {off && <span className="chip muted">已排除</span>}
                        </div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="把這隻魔靈的符文帶到配符頁"
                        onClick={() => applyDeckUnit(u.master, u.runeIds)}
                      >
                        <Wand2 size={12} /> 帶入配符
                      </button>
                      <button
                        className={`btn btn-sm ${off ? "" : "btn-ghost"}`}
                        title={off ? "解除這隻魔靈的符文與神器排除" : "排除這隻魔靈已裝備的符文與神器"}
                        onClick={() => toggleExclusion(eq.runes, eq.artifacts, monsterLabel(u.master))}
                      >
                        {off ? <RotateCcw size={12} /> : <Ban size={12} />} {off ? "解除排除" : "排除這隻"}
                      </button>
                    </div>
                  </div>
                  {runes.length === 0 && artifacts.length === 0 ? (
                    <div className="tiny dim" style={{ padding: "6px 0 0 56px" }}>這隻魔靈在儲存時沒有符文 / 神器配置。</div>
                  ) : (
                    <>
                      {runes.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <RuneBoard
                            runes={runes}
                            renderRune={(r) => <RuneCard rune={r} owner={owner.get(r.id)} />}
                          />
                        </div>
                      )}
                      {artifacts.length > 0 && (
                        <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8, marginTop: 8 }}>
                          {artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={owner.get(a.id)} />)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}
