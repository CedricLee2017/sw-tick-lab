import { useMemo, useState } from "react";
import { Layers, Save, Search } from "lucide-react";
import { MONSTER_MAP, monsterLabel, useStore } from "../store";
import { ELEMENTS } from "../lib/constants";
import { baseStats, statsForRunes } from "../lib/stats";
import { DECK_TYPE_NUMBERS, deckTypeLabel } from "../lib/deckTypes";
import { ArtifactCard, Modal, MonsterIcon, RuneCard, TickBadge, fmt } from "../components/ui";
import type { Artifact, Deck, DeckEquip, Rune } from "../lib/types";

type DeckWithEquip = Deck;

export default function DecksPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
  const bonus = useStore((s) => s.settings.bonus);
  const rta = useStore((s) => s.settings.rta);
  const saveDeckFav = useStore((s) => s.saveDeckFav);
  const saveLoadout = useStore((s) => s.saveLoadout);
  const notify = useStore((s) => s.notify);
  const deckFavs = useStore((s) => s.deckFavs);
  const [q, setQ] = useState("");
  const [type, setType] = useState(0);
  const [open, setOpen] = useState<DeckWithEquip | null>(null);

  const decks = account?.decks ?? [];
  const defenseDecks = account?.defenseDecks ?? [];
  const allDecks = useMemo(() => [...decks, ...defenseDecks], [decks, defenseDecks]);

  const unitName = (id: number) => {
    const u = account?.units.find((x) => x.id === id);
    return u ? monsterLabel(u.master) : `#${id}`;
  };
  const unitMaster = (id: number) => account?.units.find((x) => x.id === id)?.master ?? 0;

  /** 是否已存過這一隊（同類型、同序號、同隊員） */
  const isSaved = (d: Deck) =>
    deckFavs.some(
      (f) =>
        f.type === d.type &&
        f.seq === d.seq &&
        f.units.length === d.units.length &&
        f.units.every((u, i) => u.unitId === d.units[i]),
    );

  /** 儲存整隊到預設隊儲存庫 */
  const saveWholeDeck = (d: Deck) => {
    const eq = new Map(d.equip.map((e) => [e.unit, e]));
    saveDeckFav({
      name: `${deckTypeLabel(d.type)} · 第 ${d.seq} 隊`,
      type: d.type,
      seq: d.seq,
      units: d.units.map((uid) => ({
        unitId: uid,
        master: unitMaster(uid),
        runeIds: eq.get(uid)?.runes ?? [],
        artifactIds: eq.get(uid)?.artifacts ?? [],
      })),
      battlePower: d.battlePower,
    });
  };

  /** 只把預設隊中的一隻魔靈存進配裝儲存庫 */
  const saveSingleUnit = (d: Deck, uid: number) => {
    const u = account?.units.find((x) => x.id === uid);
    const master = u?.master ?? unitMaster(uid);
    const monster = MONSTER_MAP.get(master);
    const eq = d.equip.find((e) => e.unit === uid);
    const runeIds = eq?.runes ?? [];
    if (runeIds.length === 0) {
      notify("這隻魔靈在此預設隊沒有符文配置，無法儲存配裝", "err");
      return;
    }
    if (!u || !monster) {
      notify("找不到這隻魔靈的存檔資料", "err");
      return;
    }
    const runes = runeIds.map((id) => runeMap.get(id)).filter((r): r is Rune => !!r);
    const arts = (eq?.artifacts ?? []).map((id) => account?.artifacts.find((a) => a.id === id)).filter((a): a is Artifact => !!a);
    const stats = statsForRunes(baseStats(monster, u.stars, u.level), runes, bonus, rta, false, arts);
    saveLoadout({
      name: `${monsterLabel(master)} · ${deckTypeLabel(d.type)} 第 ${d.seq} 隊`,
      monsterId: master,
      unitId: uid,
      runeIds,
      stats,
    });
  };

  const ownerOfRune = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const rid of u.runes) m.set(rid, monsterLabel(u.master));
    return m;
  }, [account]);
  const ownerOfArtifact = useMemo(() => {
    const m = new Map<number, string>();
    if (!account) return m;
    for (const u of account.units) for (const aid of u.artifacts) m.set(aid, monsterLabel(u.master));
    return m;
  }, [account]);

  const types = useMemo(() => {
    const counts = new Map<number, number>();
    for (const d of allDecks) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
    return DECK_TYPE_NUMBERS.map((t) => [t, counts.get(t) ?? 0] as [number, number]);
  }, [allDecks]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return allDecks
      .filter((d) => !type || d.type === type)
      .filter((d) => {
        if (!term) return true;
        return d.units.some((id) => {
          const u = account?.units.find((x) => x.id === id);
          const name = u ? MONSTER_MAP.get(u.master)?.name ?? "" : "";
          return `${name} ${deckTypeLabel(d.type)} ${d.type} ${d.seq} ${id}`.toLowerCase().includes(term);
        });
      })
      .sort((a, b) => a.type - b.type || a.seq - b.seq);
  }, [allDecks, type, q, account]);

  const grouped = useMemo(() => {
    const m = new Map<number, Deck[]>();
    for (const d of filtered) {
      const arr = m.get(d.type) ?? [];
      arr.push(d);
      m.set(d.type, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  /** 依這組預設隊的符文 / 神器快照，算出每隻魔靈的速度、Tick 與速度順序 */
  const speedInfo = useMemo(() => {
    const m = new Map<number, { spd: number; tick: number; rank: number }>();
    if (!open || !account) return m;
    const rows = open.units.map((uid) => {
      const u = account.units.find((x) => x.id === uid);
      const monster = u ? MONSTER_MAP.get(u.master) : undefined;
      const eq = open.equip.find((e) => e.unit === uid);
      if (!u || !monster) return { uid, spd: 0, tick: 0 };
      const runes = (eq?.runes ?? []).map((id) => runeMap.get(id)).filter((r): r is Rune => !!r);
      const arts = (eq?.artifacts ?? []).map((id) => account.artifacts.find((a) => a.id === id)).filter((a): a is Artifact => !!a);
      const s = statsForRunes(baseStats(monster, u.stars, u.level), runes, bonus, rta, false, arts);
      return { uid, spd: s.spd, tick: s.tick };
    });
    const sorted = [...rows].sort((a, b) => b.spd - a.spd);
    const ranks = new Map<number, number>();
    sorted.forEach((r, i) => {
      const prev = sorted[i - 1];
      ranks.set(r.uid, prev && prev.spd === r.spd ? ranks.get(prev.uid) ?? i + 1 : i + 1);
    });
    for (const r of rows) m.set(r.uid, { spd: r.spd, tick: r.tick, rank: ranks.get(r.uid) ?? 0 });
    return m;
  }, [open, account, runeMap, bonus, rta]);

  if (!account) return <div className="empty"><Layers size={40} /><div>尚未匯入存檔</div></div>;

  const openEquip = open ? new Map<number, DeckEquip>(open.equip.map((e) => [e.unit, e])) : new Map<number, DeckEquip>();

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <div>
          <div className="card-title row" style={{ gap: 7 }}>
            <Layers size={15} className="gold" /> 預設隊
          </div>
          <div className="card-sub">
            deck_list {fmt(decks.length)} 組
            {defenseDecks.length > 0 && <> ＋ 防守隊 {fmt(defenseDecks.length)} 組</>}
            ；已命名類型顯示名稱，尚未命名的類型以「類型 N」列出。
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
            <input className="input" style={{ width: 210, paddingLeft: 28 }} placeholder="搜尋魔靈 / 類型 / 序號" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ width: 200 }} value={type} onChange={(e) => setType(Number(e.target.value))}>
            <option value={0}>全部類型（{allDecks.length}）</option>
            {types.map(([t, n]) => (
              <option key={t} value={t}>{deckTypeLabel(t)}{n > 0 ? `（${n} 隊）` : "（尚無預設隊）"}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 7 }}>
            <span className="focus-title">類型總覽</span>
            <span className="tiny dim">尚未命名的類型以編號列出</span>
          </div>
          <span className="tiny dim">類型 1–27 ＋ 防守隊</span>
        </div>
        <div className="row wrap" style={{ gap: 5, marginTop: 8 }}>
          {types.map(([t, n]) => (
            <button
              key={t}
              type="button"
              className={`chip ${type === t ? "gold" : "muted"}`}
              style={{ cursor: "pointer", opacity: n > 0 ? 1 : .55 }}
              onClick={() => setType(type === t ? 0 : t)}
              title={n > 0 ? `${n} 組預設隊` : "目前沒有預設隊"}
            >
              {deckTypeLabel(t)} · {n}
            </button>
          ))}
        </div>
      </div>

      {allDecks.length === 0 ? (
        <div className="empty" style={{ padding: "60px 20px" }}>
          <Layers size={40} style={{ opacity: .3, marginBottom: 10 }} />
          <div style={{ fontWeight: 600, color: "var(--text)" }}>這份存檔沒有預設隊資料</div>
          <div className="tiny" style={{ marginTop: 4 }}>請確認匯出的 JSON 包含 <span className="mono">deck_list</span> 或防守隊欄位。</div>
        </div>
      ) : (
        <div className="col" style={{ gap: 16 }}>
          {grouped.map(([t, list]) => (
            <div key={t}>
              <div className="row between" style={{ gap: 8, marginBottom: 7 }}>
                <div className="card-title">{deckTypeLabel(t)} <span className="dim tiny" style={{ fontWeight: 400 }}>類型 {t} · {list.length} 隊</span></div>
                <span className="tiny dim">
                  {[...new Set(list.map((d) => d.units.length))].sort((a, b) => a - b).map((n) => `${n} 人`).join(" / ")}隊
                </span>
              </div>
              <div className="grid g3" style={{ gap: 10 }}>
                {list.map((d) => {
                  const leader = d.leader ? unitMaster(d.leader) : 0;
                  return (
                    <div
                      key={`${d.type}-${d.seq}`}
                      className="card card-pad deck-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpen(d)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpen(d);
                        }
                      }}
                    >
                      <div className="row between" style={{ gap: 6 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="chip gold">{deckTypeLabel(d.type)}</span>
                          <span className="tiny dim">類型 {d.type} · 第 {d.seq} 隊</span>
                        </div>
                        <span className="tiny dim">{d.units.length} 人</span>
                      </div>
                      <div className="deck-units">
                        {d.units.map((uid) => {
                          const m = unitMaster(uid);
                          return (
                            <span key={uid} className={`deck-unit ${leader === m ? "leader" : ""}`} title={unitName(uid)}>
                              <MonsterIcon id={m} size={34} />
                              <span className="tiny">{unitName(uid)}</span>
                            </span>
                          );
                        })}
                      </div>
                      <div className="row between tiny dim" style={{ marginTop: 6 }}>
                        <span>{d.equip.reduce((s, e) => s + e.runes.length, 0)} 顆符文</span>
                        <span>{d.equip.reduce((s, e) => s + e.artifacts.length, 0)} 件神器</span>
                      </div>
                      {d.battlePower ? <div className="tiny dim">戰力 {fmt(d.battlePower)}</div> : null}
                      <div className="row" style={{ gap: 6, marginTop: 8 }}>
                        <button
                          type="button"
                          className={`btn btn-sm ${isSaved(d) ? "" : "btn-ghost"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            saveWholeDeck(d);
                          }}
                          title="把整隊存到預設隊儲存庫"
                        >
                          <Save size={12} /> {isSaved(d) ? "已儲存" : "儲存整隊"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="empty">沒有符合條件的預設隊</div>}
        </div>
      )}

      {open && (
        <Modal title={`${deckTypeLabel(open.type)} · 第 ${open.seq} 隊`} onClose={() => setOpen(null)} width={940}>
          <div className="row between wrap" style={{ gap: 8, marginBottom: 12 }}>
            <span className="tiny dim">共 {open.units.length} 隻{open.leader ? ` · 隊長 ${unitName(open.leader)}` : ""}{open.battlePower ? ` · 戰力 ${fmt(open.battlePower)}` : ""}</span>
            <div className="row" style={{ gap: 6 }}>
              <span className="tiny dim">預設隊快照（符文 / 神器配置）</span>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => saveWholeDeck(open)}>
                <Save size={12} /> 儲存整隊
              </button>
            </div>
          </div>

          <div className="deck-speedbar">
            <div className="row between wrap" style={{ gap: 6, marginBottom: 6 }}>
              <span className="tiny dim">速度順序（依此預設隊的符文配置計算）</span>
              <span className="tiny dim">Speed Tick</span>
            </div>
            <div className="row wrap" style={{ gap: 5 }}>
              {[...open.units]
                .map((uid) => ({ uid, info: speedInfo.get(uid) }))
                .sort((a, b) => (a.info?.rank ?? 99) - (b.info?.rank ?? 99))
                .map(({ uid, info }) => (
                  <span key={uid} className="chip muted" title={`SPD ${info?.spd ?? 0} · Tick ${info?.tick ?? 0}`}>
                    <b className="gold">{info?.rank ?? "-"}</b>
                    <span style={{ margin: "0 4px" }}>{unitName(uid)}</span>
                    <span className="mono">{info?.spd ?? 0}</span>
                    <span style={{ marginLeft: 4 }}>T{info?.tick ?? "-"}</span>
                  </span>
                ))}
            </div>
          </div>

          <div className="col" style={{ gap: 14 }}>
            {open.units.map((uid) => {
              const master = unitMaster(uid);
              const monster = MONSTER_MAP.get(master);
              const eq = openEquip.get(uid);
              const runes = (eq?.runes ?? []).map((id: number) => runeMap.get(id)).filter((r): r is Rune => !!r);
              const artifacts = (eq?.artifacts ?? []).map((id: number) => account.artifacts.find((a) => a.id === id)).filter((a): a is Artifact => !!a);
              const info = speedInfo.get(uid);
              return (
                <div key={uid} className="deck-detail">
                  <div className="row between" style={{ gap: 10 }}>
                    <div className="row" style={{ gap: 10, minWidth: 0 }}>
                      <MonsterIcon id={master} size={46} />
                      <div style={{ flex: 1 }}>
                        <div className="row wrap" style={{ gap: 6 }}>
                          <b>{unitName(uid)}</b>
                          {monster && <span className={`el-${monster.el}`} style={{ fontSize: 11 }}>{ELEMENTS[monster.el as 1]?.name}</span>}
                          {uid === open.leader && <span className="chip gold">隊長</span>}
                          {info && info.spd > 0 && (
                            <>
                              <span className="chip">第 {info.rank} 速</span>
                              <span className="chip mono">SPD {info.spd}</span>
                              <TickBadge spd={info.spd} rta={rta} />
                            </>
                          )}
                          <span className="tiny dim">{runes.length}/6 符文 · {artifacts.length}/2 神器</span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => saveSingleUnit(open, uid)}
                      title="只把這隻魔靈存到配裝儲存庫"
                    >
                      <Save size={12} /> 儲存這隻
                    </button>
                  </div>
                  {runes.length === 0 && artifacts.length === 0 ? (
                    <div className="tiny dim" style={{ padding: "6px 0 0 56px" }}>此預設隊沒有這隻魔靈的符文 / 神器配置。</div>
                  ) : (
                    <>
                      {runes.length > 0 && (
                        <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 8 }}>
                          {runes.map((r) => <RuneCard key={r.id} rune={r} compact owner={ownerOfRune.get(r.id)} />)}
                        </div>
                      )}
                      {artifacts.length > 0 && (
                        <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8, marginTop: 8 }}>
                          {artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} owner={ownerOfArtifact.get(a.id)} />)}
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
