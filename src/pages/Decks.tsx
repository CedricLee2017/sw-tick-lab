import { useMemo, useState } from "react";
import { Layers, Search } from "lucide-react";
import { MONSTER_MAP, monsterLabel, useStore } from "../store";
import { ELEMENTS } from "../lib/constants";
import { ArtifactCard, Modal, MonsterIcon, RuneCard, fmt } from "../components/ui";
import type { Artifact, Deck, DeckEquip, Rune } from "../lib/types";

type DeckWithEquip = Deck;

const DECK_TYPE_LABELS: Record<number, string> = {
  1: "競技場",
  2: "公會戰（進攻）",
  3: "異界（三頭）",
  4: "迷宮（一般）",
  5: "救援",
  6: "試練之塔",
  7: "迷宮（限速）",
  8: "迷宮（限時）",
  10: "迷宮（炸彈）",
  11: "迷宮（首領）",
  12: "水之塔",
  13: "火之塔",
  14: "風之塔",
  15: "光之塔",
  16: "暗之塔",
  17: "天空之塔",
  19: "次元團戰（1P）",
  20: "次元團戰（2P）",
  21: "次元團戰（3P）",
  22: "據點戰（進攻）",
  23: "混沌",
  24: "卡伊洛斯",
  25: "異界（單頭）",
  26: "次元",
  27: "討伐戰",
  100: "競技場防守（本機）",
  101: "競技場防守（伺服器）",
  102: "據點戰防守",
};

const deckTypeLabel = (type: number) => DECK_TYPE_LABELS[type] ?? `類型 ${type}`;
/** 遊戲 deck_type 1–27，加上內部使用的防守隊代碼 100–102 */
const DECK_TYPE_NUMBERS = [...Array.from({ length: 27 }, (_, i) => i + 1), 100, 101, 102];

export default function DecksPage() {
  const account = useStore((s) => s.account);
  const runeMap = useStore((s) => s.runeMap);
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
                    <button key={`${d.type}-${d.seq}`} type="button" className="card card-pad deck-card" onClick={() => setOpen(d)}>
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
                    </button>
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
            <span className="tiny dim">預設隊快照（符文 / 神器配置）</span>
          </div>
          <div className="col" style={{ gap: 14 }}>
            {open.units.map((uid) => {
              const master = unitMaster(uid);
              const monster = MONSTER_MAP.get(master);
              const eq = openEquip.get(uid);
              const runes = (eq?.runes ?? []).map((id: number) => runeMap.get(id)).filter((r): r is Rune => !!r);
              const artifacts = (eq?.artifacts ?? []).map((id: number) => account.artifacts.find((a) => a.id === id)).filter((a): a is Artifact => !!a);
              return (
                <div key={uid} className="deck-detail">
                  <div className="row" style={{ gap: 10 }}>
                    <MonsterIcon id={master} size={46} />
                    <div style={{ flex: 1 }}>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <b>{unitName(uid)}</b>
                        {monster && <span className={`el-${monster.el}`} style={{ fontSize: 11 }}>{ELEMENTS[monster.el as 1]?.name}</span>}
                        {uid === open.leader && <span className="chip gold">隊長</span>}
                        <span className="tiny dim">{runes.length}/6 符文 · {artifacts.length}/2 神器</span>
                      </div>
                    </div>
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
