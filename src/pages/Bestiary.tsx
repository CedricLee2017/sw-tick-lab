import { useEffect, useMemo, useState } from "react";
import {
  BookOpen, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Crown, Filter, Plus, RotateCcw, Search, SlidersHorizontal, Wand2, X,
} from "lucide-react";
import { MONSTERS, useStore } from "../store";
import { loadSkillData, type Skill, type SkillData } from "../lib/damage";
import { ELEMENTS } from "../lib/constants";
import type { LeaderSkill } from "../lib/types";
import { fmt, Modal, MonsterIcon, NumberInput } from "../components/ui";
import { sortMonsterEntries } from "../components/MonsterPicker";
import {
  buildBestiary, effectGroups, effectOf, EMPTY_LEADER_FILTER, EMPTY_SKILL_FILTER, isLeaderFilterActive,
  isSkillFilterActive, matchedSkills, matchesLeader, matchesSkill, scaleOptions,
  type BestiaryEntry, type LeaderFilter, type SkillFilter,
} from "../lib/bestiary";
import { sendOptimizerDraft } from "../lib/draft";

const PAGE_SIZE = 60;

const EL_RANK: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 };

const ARCH_LABELS: Record<string, string> = {
  Attack: "攻擊型",
  HP: "體力型",
  Defense: "防禦型",
  Support: "輔助型",
  Material: "材料",
};

const AWAKEN_LABELS: Record<number, string> = { 0: "未覺醒", 1: "已覺醒", 2: "二次覺醒" };

const LEADER_ATTR_OPTIONS: [string, string][] = [
  ["HP", "體力"],
  ["Attack Power", "攻擊力"],
  ["Defense", "防禦力"],
  ["Attack Speed", "速度"],
  ["Critical Rate", "暴擊率"],
  ["Critical DMG", "暴擊傷害"],
  ["Resistance", "效果抵抗"],
  ["Accuracy", "效果命中"],
];

const LEADER_AREA_OPTIONS: [string, string][] = [
  ["General", "一般"],
  ["Element", "屬性"],
  ["Guild", "公會"],
  ["Arena", "競技場"],
  ["Dungeon", "地下城"],
];

const LEADER_ATTR_LABELS = Object.fromEntries(LEADER_ATTR_OPTIONS);
const LEADER_AREA_LABELS = Object.fromEntries(LEADER_AREA_OPTIONS);

function leaderText(lead: LeaderSkill): string {
  const attr = LEADER_ATTR_LABELS[lead.attr] ?? lead.attr;
  const area = LEADER_AREA_LABELS[lead.area] ?? lead.area;
  const scope = lead.element ? `（${ELEMENTS[lead.element as 1]?.name ?? `屬性 ${lead.element}`}）` : "";
  return `${attr} +${lead.amount}% · ${area}${scope}`;
}

type SortKey = "default" | "spd" | "hp" | "atk" | "def" | "name";

function archText(m: BestiaryEntry["monster"]): string {
  return ARCH_LABELS[m.arch ?? ""] ?? m.arch ?? "—";
}

function awakenText(m: BestiaryEntry["monster"]): string {
  if (m.a2) return "二次覺醒";
  return AWAKEN_LABELS[m.awk] ?? "—";
}

function activeSkillCount(f: SkillFilter): number {
  let n = 0;
  if (f.q.trim()) n++;
  if (f.slot) n++;
  if (f.kind !== "all") n++;
  if (f.aoe !== "all") n++;
  if (f.effects.length) n += f.effects.length;
  if (f.scale) n++;
  if (f.minHits > 0) n++;
  if (f.maxCool !== null) n++;
  return n;
}

function activeLeaderCount(f: LeaderFilter): number {
  let n = 0;
  if (f.only) n++;
  if (f.attr) n++;
  if (f.area) n++;
  if (f.element !== 0) n++;
  if (f.minAmount > 0) n++;
  return n;
}

function skillSlotText(skill: Skill): string {
  if (skill.passive) return "P";
  return skill.slot > 0 ? `S${skill.slot}` : "—";
}

export default function BestiaryPage() {
  const account = useStore((s) => s.account);
  const addCustomUnit = useStore((s) => s.addCustomUnit);

  const [skillData, setSkillData] = useState<SkillData | null>(null);
  const [skillError, setSkillError] = useState("");
  const [q, setQ] = useState("");
  const [el, setEl] = useState(0);
  const [nat, setNat] = useState(0);
  const [awaken, setAwaken] = useState(0);
  const [arch, setArch] = useState("");
  const [sort, setSort] = useState<SortKey>("default");
  const [skillFilter, setSkillFilter] = useState<SkillFilter>(EMPTY_SKILL_FILTER);
  const [skillOpen, setSkillOpen] = useState(false);
  const [leaderFilter, setLeaderFilter] = useState<LeaderFilter>(EMPTY_LEADER_FILTER);
  const [leaderOpen, setLeaderOpen] = useState(false);
  const [effectSearch, setEffectSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    loadSkillData()
      .then((data) => {
        if (alive) setSkillData(data);
      })
      .catch((err) => {
        if (alive) setSkillError(err instanceof Error ? err.message : "技能資料載入失敗");
      });
    return () => {
      alive = false;
    };
  }, []);

  const entries = useMemo(() => buildBestiary(skillData, MONSTERS), [skillData]);
  const groups = useMemo(() => effectGroups(skillData, MONSTERS), [skillData]);
  const scales = useMemo(() => scaleOptions(skillData), [skillData]);
  const activeSkill = isSkillFilterActive(skillFilter);
  const activeLeader = isLeaderFilterActive(leaderFilter);

  /** 帳號內每種魔靈的數量（給卡片上的「已擁有」標記） */
  const owned = useMemo(() => {
    const map = new Map<number, number>();
    for (const unit of account?.units ?? []) map.set(unit.master, (map.get(unit.master) ?? 0) + 1);
    return map;
  }, [account]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      const m = entry.monster;
      if (term && !m.name.toLowerCase().includes(term)) return false;
      if (el && m.el !== el) return false;
      if (nat && m.nat !== nat) return false;
      if (awaken === 1 && m.awk !== 0) return false;
      if (awaken === 2 && m.awk < 1) return false;
      if (awaken === 3 && !m.a2) return false;
      if (arch && (m.arch ?? "") !== arch) return false;
      if (activeLeader && !matchesLeader(m.lead, leaderFilter)) return false;
      if (activeSkill && !entry.skills.some((skill) => matchesSkill(skill, skillFilter))) return false;
      return true;
    });

    if (sort === "default") return sortMonsterEntries(filtered);
    return filtered.slice().sort((a, b) => {
      const x = a.monster;
      const y = b.monster;
      if (sort === "name") return x.name.localeCompare(y.name);
      if (sort === "spd") return y.spd - x.spd || x.name.localeCompare(y.name);
      if (sort === "hp") return y.hp - x.hp || x.name.localeCompare(y.name);
      if (sort === "atk") return y.atk - x.atk || x.name.localeCompare(y.name);
      if (sort === "def") return y.def - x.def || x.name.localeCompare(y.name);
      return EL_RANK[x.el] - EL_RANK[y.el] || y.nat - x.nat || x.name.localeCompare(y.name);
    });
  }, [entries, q, el, nat, awaken, arch, sort, activeSkill, skillFilter, activeLeader, leaderFilter]);

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageList = list.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const goPage = (next: number) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const detail = detailId === null ? undefined : entries.find((e) => e.monster.id === detailId);
  const detailOwned = detail ? owned.get(detail.monster.id) ?? 0 : 0;

  const patchSkill = (patch: Partial<SkillFilter>) => {
    setSkillFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const patchLeader = (patch: Partial<LeaderFilter>) => {
    setLeaderFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const resetAll = () => {
    setQ("");
    setEl(0);
    setNat(0);
    setAwaken(0);
    setArch("");
    setSort("default");
    setSkillFilter(EMPTY_SKILL_FILTER);
    setLeaderFilter(EMPTY_LEADER_FILTER);
    setEffectSearch("");
    setPage(1);
  };

  const toggleEffect = (id: number) => {
    patchSkill({
      effects: skillFilter.effects.includes(id)
        ? skillFilter.effects.filter((x) => x !== id)
        : [...skillFilter.effects, id],
    });
  };

  const selectedEffects = skillFilter.effects.map((id) => effectOf(skillData, id));
  const effectTerm = effectSearch.trim().toLowerCase();
  const skillFilterCount = activeSkillCount(skillFilter);
  const leaderFilterCount = activeLeaderCount(leaderFilter);

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 12 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div className="row wrap filter-row" style={{ gap: 8 }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
              <input
                className="input"
                style={{ width: 220, paddingLeft: 28 }}
                placeholder="搜尋魔靈名稱（英文）…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="row wrap" style={{ gap: 5 }}>
              <button type="button" className={`mp-chip ${el === 0 ? "on" : ""}`} onClick={() => { setEl(0); setPage(1); }}>
                全部
              </button>
              {[1, 2, 3, 4, 5].map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`mp-chip ${el === id ? "on" : ""}`}
                  onClick={() => { setEl(id); setPage(1); }}
                >
                  <i className={`mp-dot el-${id}`} />
                  {ELEMENTS[id as 1].name}
                </button>
              ))}
            </div>
          </div>
          <div className="row wrap" style={{ gap: 7 }}>
            <select className="select" style={{ width: 118 }} value={nat} onChange={(e) => { setNat(Number(e.target.value)); setPage(1); }}>
              <option value={0}>原生星級</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}★</option>)}
            </select>
            <select className="select" style={{ width: 118 }} value={awaken} onChange={(e) => { setAwaken(Number(e.target.value)); setPage(1); }}>
              <option value={0}>覺醒狀態</option>
              <option value={1}>未覺醒</option>
              <option value={2}>已覺醒</option>
              <option value={3}>二次覺醒</option>
            </select>
            <select className="select" style={{ width: 112 }} value={arch} onChange={(e) => { setArch(e.target.value); setPage(1); }}>
              <option value="">類型</option>
              {Object.entries(ARCH_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select className="select" style={{ width: 116 }} value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setPage(1); }}>
              <option value="default">屬性 / 星級</option>
              <option value="spd">速度</option>
              <option value="hp">體力</option>
              <option value="atk">攻擊力</option>
              <option value="def">防禦力</option>
              <option value="name">名稱</option>
            </select>
            <button type="button" className="btn btn-sm btn-ghost" onClick={resetAll} title="清除所有篩選">
              <RotateCcw size={13} /> 重設
            </button>
          </div>
        </div>
      </div>

      <div className="card bestiary-skill-filter" style={{ marginBottom: 12 }}>
        <button type="button" className="bestiary-skill-head" onClick={() => setSkillOpen((v) => !v)}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ gap: 7 }}>
              <SlidersHorizontal size={15} style={{ color: "var(--gold)" }} />
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>技能篩選</span>
              {skillFilterCount > 0 && <span className="chip gold">{skillFilterCount} 個條件</span>}
              {activeSkill && <span className="chip">{list.length} 隻符合</span>}
            </div>
            <div className="tiny dim" style={{ marginTop: 3 }}>
              用技能名稱、位置、段數、冷卻或效果（暈眩、破防、拉條、免疫…）找出有該技能的魔靈
            </div>
          </div>
          {skillOpen ? <ChevronUp size={17} className="dim" /> : <ChevronDown size={17} className="dim" />}
        </button>

        {skillOpen && (
          <div className="bestiary-skill-body">
            <div className="bestiary-skill-row">
              <div className="field" style={{ flex: "1 1 230px", minWidth: 190 }}>
                <label>技能名稱 / 說明</label>
                <div style={{ position: "relative" }}>
                  <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: "var(--muted-2)" }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 28 }}
                    placeholder="例如 stun、attack bar、heal…"
                    value={skillFilter.q}
                    onChange={(e) => patchSkill({ q: e.target.value })}
                  />
                </div>
              </div>

              <div className="field">
                <label>技能位置</label>
                <div className="row wrap" style={{ gap: 5 }}>
                  <button type="button" className={`mp-chip ${skillFilter.slot === 0 ? "on" : ""}`} onClick={() => patchSkill({ slot: 0 })}>全部</button>
                  {[1, 2, 3, 4].map((slot) => (
                    <button key={slot} type="button" className={`mp-chip ${skillFilter.slot === slot ? "on" : ""}`} onClick={() => patchSkill({ slot })}>
                      S{slot}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>技能類型</label>
                <div className="row wrap" style={{ gap: 5 }}>
                  {([["all", "全部"], ["active", "主動"], ["passive", "被動"]] as const).map(([key, label]) => (
                    <button key={key} type="button" className={`mp-chip ${skillFilter.kind === key ? "on" : ""}`} onClick={() => patchSkill({ kind: key })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>範圍</label>
                <div className="row wrap" style={{ gap: 5 }}>
                  {([["all", "全部"], ["yes", "全體"], ["no", "單體"]] as const).map(([key, label]) => (
                    <button key={key} type="button" className={`mp-chip ${skillFilter.aoe === key ? "on" : ""}`} onClick={() => patchSkill({ aoe: key })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="bestiary-skill-row">
              <div className="field">
                <label>成長屬性</label>
                <select className="select" style={{ width: 160 }} value={skillFilter.scale} onChange={(e) => patchSkill({ scale: e.target.value })}>
                  <option value="">不限</option>
                  {scales.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
                </select>
              </div>

              <div className="field">
                <label>段數下限</label>
                <NumberInput
                  className="input mono"
                  style={{ width: 100 }}
                  min={0}
                  max={20}
                  value={skillFilter.minHits}
                  onChange={(v) => patchSkill({ minHits: v })}
                />
              </div>

              <div className="field">
                <label>冷卻上限</label>
                <select
                  className="select"
                  style={{ width: 120 }}
                  value={skillFilter.maxCool === null ? "any" : String(skillFilter.maxCool)}
                  onChange={(e) => patchSkill({ maxCool: e.target.value === "any" ? null : Number(e.target.value) })}
                >
                  <option value="any">不限</option>
                  <option value="0">0（無冷卻）</option>
                  <option value="2">≤ 2</option>
                  <option value="3">≤ 3</option>
                  <option value="4">≤ 4</option>
                  <option value="5">≤ 5</option>
                  <option value="6">≤ 6</option>
                  <option value="8">≤ 8</option>
                  <option value="10">≤ 10</option>
                  <option value="13">≤ 13</option>
                </select>
              </div>

              {skillFilter.effects.length > 1 && (
                <div className="field">
                  <label>多個效果條件</label>
                  <select
                    className="select"
                    style={{ width: 190 }}
                    value={skillFilter.effectMode}
                    onChange={(e) => patchSkill({ effectMode: e.target.value as "any" | "all" })}
                  >
                    <option value="any">符合任一所選效果</option>
                    <option value="all">同一招同時具備全部</option>
                  </select>
                </div>
              )}

              <div className="field" style={{ flex: 1 }}>
                <label>已選效果</label>
                <div className="row wrap" style={{ gap: 5, minHeight: 30 }}>
                  {selectedEffects.length === 0 && <span className="tiny dim">尚未選擇（可複選）</span>}
                  {selectedEffects.map((effect) => (
                    <button
                      key={effect.id}
                      type="button"
                      className={`bestiary-effect selected ${effect.type}`}
                      onClick={() => toggleEffect(effect.id)}
                      title="點擊移除"
                    >
                      {effect.name} <X size={10} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="bestiary-effect-box">
              <div className="row between wrap" style={{ gap: 8 }}>
                <div className="card-title" style={{ fontSize: 12.5 }}>
                  <Filter size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                  技能效果
                  <span className="tiny dim" style={{ fontWeight: 500, marginLeft: 6 }}>點擊可複選</span>
                </div>
                <input
                  className="input"
                  style={{ width: 190 }}
                  placeholder="搜尋效果名稱…"
                  value={effectSearch}
                  onChange={(e) => setEffectSearch(e.target.value)}
                />
              </div>

              <div className="bestiary-effect-groups">
                {groups.map((group) => {
                  const items = group.items.filter((item) => !effectTerm || item.name.toLowerCase().includes(effectTerm));
                  if (items.length === 0) return null;
                  return (
                    <div key={group.type} className="bestiary-effect-group">
                      <div className="bestiary-effect-group-title">
                        {group.label}
                        <span className="tiny dim">{group.items.length}</span>
                      </div>
                      <div className="bestiary-effect-list">
                        {items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`bestiary-effect ${group.type} ${skillFilter.effects.includes(item.id) ? "on" : ""}`}
                            title={`${item.name} · ${item.count} 隻魔靈`}
                            onClick={() => toggleEffect(item.id)}
                          >
                            {item.name}
                            <span className="n">{item.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {groups.length === 0 && <div className="tiny dim">技能資料載入後即可選擇效果。</div>}
                {groups.length > 0 && effectTerm && groups.every((g) => g.items.every((item) => !item.name.toLowerCase().includes(effectTerm))) && (
                  <div className="tiny dim">找不到符合「{effectSearch}」的效果。</div>
                )}
              </div>
            </div>

            <div className="row between wrap" style={{ gap: 8, marginTop: 10 }}>
              <span className="tiny dim">多選效果時，預設只要符合任一所選效果；切換成「同一招同時具備全部」時，必須有單一技能包含所有選取效果。</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setSkillFilter(EMPTY_SKILL_FILTER); setPage(1); }}>
                <RotateCcw size={12} /> 清除技能條件
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card bestiary-skill-filter" style={{ marginBottom: 12 }}>
        <button type="button" className="bestiary-skill-head" onClick={() => setLeaderOpen((v) => !v)}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ gap: 7 }}>
              <Crown size={15} style={{ color: "var(--gold)" }} />
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>隊長技篩選</span>
              {leaderFilterCount > 0 && <span className="chip gold">{leaderFilterCount} 個條件</span>}
              {activeLeader && <span className="chip">{list.length} 隻符合</span>}
            </div>
            <div className="tiny dim" style={{ marginTop: 3 }}>
              依隊長技類型、適用範圍、屬性限制與數值下限篩選（例如：速度 +24% 競技場）
            </div>
          </div>
          {leaderOpen ? <ChevronUp size={17} className="dim" /> : <ChevronDown size={17} className="dim" />}
        </button>

        {leaderOpen && (
          <div className="bestiary-skill-body">
            <div className="bestiary-skill-row">
              <div className="field">
                <label>隊長技類型</label>
                <select className="select" style={{ width: 150 }} value={leaderFilter.attr} onChange={(e) => patchLeader({ attr: e.target.value })}>
                  <option value="">不限</option>
                  {LEADER_ATTR_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>

              <div className="field">
                <label>適用範圍</label>
                <select className="select" style={{ width: 130 }} value={leaderFilter.area} onChange={(e) => patchLeader({ area: e.target.value })}>
                  <option value="">不限</option>
                  {LEADER_AREA_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>

              <div className="field">
                <label>屬性限制</label>
                <select className="select" style={{ width: 150 }} value={leaderFilter.element} onChange={(e) => patchLeader({ element: Number(e.target.value) })}>
                  <option value={0}>不限</option>
                  <option value={-1}>不限屬性（通用）</option>
                  {[1, 2, 3, 4, 5].map((id) => <option key={id} value={id}>{ELEMENTS[id as 1].name}屬性</option>)}
                </select>
              </div>

              <div className="field">
                <label>數值下限</label>
                <div className="row" style={{ gap: 5 }}>
                  <NumberInput
                    className="input mono"
                    style={{ width: 90 }}
                    min={0}
                    max={100}
                    value={leaderFilter.minAmount}
                    onChange={(v) => patchLeader({ minAmount: v })}
                  />
                  <span className="tiny dim">%</span>
                </div>
              </div>

              <label className="row tiny" style={{ gap: 6, cursor: "pointer", paddingBottom: 8 }}>
                <input type="checkbox" checked={leaderFilter.only} onChange={(e) => patchLeader({ only: e.target.checked })} />
                只看有隊長技
              </label>

              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => { setLeaderFilter(EMPTY_LEADER_FILTER); setPage(1); }}
              >
                <RotateCcw size={12} /> 清除隊長技條件
              </button>
            </div>

            <div className="tiny dim" style={{ marginTop: 8 }}>
              例如：類型選「速度」、範圍選「競技場」，就能找到競技場速度隊長；勾選「只看有隊長技」則列出所有擁有隊長技的魔靈。
            </div>
          </div>
        )}
      </div>

      {skillError && <div className="card card-pad" style={{ marginBottom: 12, color: "var(--red)" }}>{skillError}</div>}
      {!skillData && !skillError && <div className="tiny dim" style={{ marginBottom: 8 }}>技能資料載入中…（魔靈列表可先瀏覽）</div>}

      <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
        <span className="tiny dim">
          共 {list.length} 隻魔靈
          {activeSkill ? ` · 技能條件：${skillFilterCount} 項` : ""}
          {list.length > 0 ? ` · 第 ${pageSafe} / ${totalPages} 頁` : ""}
        </span>
        {totalPages > 1 && (
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm btn-ghost" disabled={pageSafe <= 1} onClick={() => goPage(pageSafe - 1)}>
              <ChevronLeft size={14} /> 上一頁
            </button>
            <span className="tiny dim mono">{pageSafe} / {totalPages}</span>
            <button type="button" className="btn btn-sm btn-ghost" disabled={pageSafe >= totalPages} onClick={() => goPage(pageSafe + 1)}>
              下一頁 <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {pageList.length === 0 ? (
        <div className="empty">
          <BookOpen size={40} />
          <div>找不到符合條件的魔靈</div>
          <div className="tiny" style={{ marginTop: 4 }}>試著放寬技能效果，或按「重設」清除全部篩選。</div>
        </div>
      ) : (
        <div className="bestiary-grid">
          {pageList.map((entry) => {
            const m = entry.monster;
            const skills = matchedSkills(entry, skillFilter);
            const ownedCount = owned.get(m.id) ?? 0;
            return (
              <button
                key={m.id}
                type="button"
                className="card bestiary-card"
                onClick={() => setDetailId(m.id)}
              >
                <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                  <MonsterIcon id={m.id} size={54} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="bestiary-name">{m.name}</div>
                    <div className="tiny dim" style={{ marginTop: 2 }}>
                      {ELEMENTS[m.el as 1]?.name ?? "—"} · {m.nat}★ · {archText(m)}
                    </div>
                    <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                      <span className={`chip ${m.a2 ? "gold" : "muted"}`} style={{ padding: "0 6px", fontSize: 9.5 }}>
                        {awakenText(m)}
                      </span>
                      {ownedCount > 0 && (
                        <span className="chip green" style={{ padding: "0 6px", fontSize: 9.5 }}>
                          已擁有 {ownedCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                    <div className="mono gold" style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.1 }}>{m.spd}</div>
                    <div className="tiny dim">SPD</div>
                  </div>
                </div>

                <div className="bestiary-stats">
                  <span>HP <b>{fmt(m.hp)}</b></span>
                  <span>攻 <b>{fmt(m.atk)}</b></span>
                  <span>防 <b>{fmt(m.def)}</b></span>
                  <span>暴 <b>{m.cr}%</b></span>
                </div>

                {m.lead && (
                  <div className="bestiary-leader" title={leaderText(m.lead)}>
                    <Crown size={10} />
                    <span>{leaderText(m.lead)}</span>
                  </div>
                )}

                <div className="bestiary-skill-chips">
                  {skills.slice(0, 3).map((skill) => (
                    <span
                      key={skill.id}
                      className={`bestiary-skill-chip ${activeSkill ? "match" : ""}`}
                      title={`${skill.n}\n\n${skill.d}`}
                    >
                      <b>{skillSlotText(skill)}</b> {skill.n}
                    </span>
                  ))}
                  {skills.length === 0 && <span className="tiny dim">沒有技能資料</span>}
                  {skills.length > 3 && <span className="tiny dim">+{skills.length - 3} 招</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="row between wrap bestiary-pager" style={{ gap: 8 }}>
          <span className="tiny dim">第 {pageSafe} / {totalPages} 頁 · 共 {list.length} 隻</span>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm btn-ghost" disabled={pageSafe <= 1} onClick={() => goPage(pageSafe - 1)}>
              <ChevronLeft size={14} /> 上一頁
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={pageSafe >= totalPages} onClick={() => goPage(pageSafe + 1)}>
              下一頁 <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {detail && (
        <Modal title={detail.monster.name} width={880} onClose={() => setDetailId(null)}>
          <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
            <MonsterIcon id={detail.monster.id} size={88} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="chip gold">{ELEMENTS[detail.monster.el as 1]?.name ?? "—"}</span>
                <span className="chip">{detail.monster.nat}★ 原生</span>
                <span className="chip muted">{archText(detail.monster)}</span>
                <span className="chip muted">{awakenText(detail.monster)}</span>
                {detailOwned > 0 && <span className="chip green">已擁有 {detailOwned} 隻</span>}
              </div>
              <div className="bestiary-detail-stats">
                {[
                  ["體力", fmt(detail.monster.hp)],
                  ["攻擊力", fmt(detail.monster.atk)],
                  ["防禦力", fmt(detail.monster.def)],
                  ["速度", String(detail.monster.spd)],
                  ["暴擊率", `${detail.monster.cr}%`],
                  ["暴擊傷害", `${detail.monster.cd}%`],
                  ["效果抵抗", `${detail.monster.res}%`],
                  ["效果命中", `${detail.monster.acc}%`],
                ].map(([label, value]) => (
                  <div key={label} className="bestiary-detail-stat">
                    <span>{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bestiary-leader-box">
            <div className="row between wrap" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 6 }}>
                <Crown size={14} style={{ color: "var(--gold)" }} />
                <b style={{ fontSize: 12.5 }}>隊長技</b>
              </div>
              {detail.monster.lead ? (
                <span className="chip gold">{leaderText(detail.monster.lead)}</span>
              ) : (
                <span className="tiny dim">這隻魔靈沒有隊長技</span>
              )}
            </div>
          </div>

          <div className="row between wrap" style={{ gap: 8, margin: "18px 0 8px" }}>
            <div className="card-title">技能</div>
            <span className="tiny dim">數值為 6★ / 40 等基礎值（不含符文）</span>
          </div>

          <div className="bestiary-skill-list">
            {detail.skills.length === 0 && <div className="empty" style={{ padding: "24px 12px" }}>技能資料載入中…</div>}
            {detail.skills.map((skill) => {
              const isMatch = activeSkill && matchesSkill(skill, skillFilter);
              return (
                <div key={skill.id} className={`bestiary-skill ${isMatch ? "match" : ""}`}>
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <div className="row wrap" style={{ gap: 6 }}>
                      <span className="bestiary-slot">{skillSlotText(skill)}</span>
                      <b style={{ fontSize: 13 }}>{skill.n}</b>
                      {skill.passive && <span className="chip muted">被動</span>}
                      {skill.aoe && <span className="chip">全體</span>}
                      {!skill.passive && skill.hits > 0 && <span className="chip muted">{skill.hits} 段</span>}
                      {skill.cool > 0 && <span className="chip muted">CD {skill.cool}</span>}
                      {isMatch && <span className="chip gold">符合條件</span>}
                    </div>
                    {skill.f && <span className="mono tiny gold">{skill.f}</span>}
                  </div>
                  <div className="tiny" style={{ color: "var(--muted)", lineHeight: 1.7, marginTop: 5 }}>
                    {skill.d || "—"}
                  </div>
                  {skill.e.length > 0 && (
                    <div className="row wrap" style={{ gap: 4, marginTop: 7 }}>
                      {skill.e.map((id) => {
                        const effect = effectOf(skillData, id);
                        return (
                          <span key={id} className={`bestiary-effect ${effect.type}`} title={effect.name}>
                            {effect.name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="row between wrap" style={{ gap: 8, marginTop: 16 }}>
            <span className="tiny dim">
              {account
                ? detailOwned > 0
                  ? "這隻魔靈已在你的帳號中，可以直接帶入配符；也能再加入一隻，名稱會自動加上數字。"
                  : "可以加入成自訂魔靈，再進行配符或一鍵配隊。"
                : "匯入存檔後，就能把這隻魔靈加入自己的魔靈盒。"}
            </span>
            <div className="row" style={{ gap: 8 }}>
              {account && detailOwned > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    sendOptimizerDraft({ monsterId: detail.monster.id });
                    window.location.hash = "#/optimizer";
                    setDetailId(null);
                  }}
                >
                  <Wand2 size={14} /> 帶入配符
                </button>
              )}
              {account && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => addCustomUnit(detail.monster.id, 6, 40)}
                >
                  <Plus size={14} /> {detailOwned > 0 ? "再加入一隻" : "加入我的魔靈"}
                </button>
              )}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDetailId(null)}>關閉</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
