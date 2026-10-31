import { useRef, useState } from "react";
import {
  UploadCloud, FileJson, Gauge, Wand2, ShieldCheck, Sparkles, BookOpen, ClipboardPaste, Trash2, Zap,
} from "lucide-react";
import { monsterOf, useStore } from "../store";
import { useSummary } from "../lib/accountStats";
import { useAuth } from "../lib/auth";
import { uploadSave } from "../lib/upload";
import { Modal, fmt } from "../components/ui";
import { buildingPct } from "../lib/stats";

export default function ImportPage() {
  const { account, importText, notify, clearAccount } = useStore();
  const summary = useSummary();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async (text: string, name: string) => {
    setBusy(true);
    const res = importText(text, name);
    setBusy(false);
    setWarnings(res.warnings ?? []);
    setError(res.ok ? null : (res.error ?? "匯入失敗"));
    if (!res.ok) {
      notify(res.error ?? "匯入失敗", "err");
      return;
    }

    // 登入後自動把原始存檔備份到 Google Drive（示範帳號除外）；不影響解析流程
    const acc = useStore.getState().account;
    const loggedIn = Boolean(useAuth.getState().user);
    if (acc && loggedIn && !name.startsWith("demo-account")) {
      void uploadSave(text, name, { wizard: acc.wizard, monsters: acc.units.length, runes: acc.runes.length })
        .then(() => notify("已自動備份存檔到 Google Drive"))
        .catch((err) => notify(`存檔備份失敗：${err instanceof Error ? err.message : "未知錯誤"}`, "err"));
    }
  };

  const copyDiagnostics = async () => {
    if (!account) return;
    const slots: Record<string, number> = {};
    const sets: Record<string, number> = {};
    for (const r of account.runes) {
      slots[r.slot] = (slots[r.slot] ?? 0) + 1;
      sets[r.set] = (sets[r.set] ?? 0) + 1;
    }
    const info = {
      fileName: account.fileName,
      version: account.version,
      units: account.units.length,
      runes: account.runes.length,
      artifacts: account.artifacts.length,
      buildings: account.buildings.length,
      speedTowerLevel: account.buildings.find((b) => b.id === 7)?.level ?? null,
      unknownMasters: [...new Set(account.units.filter((u) => !monsterOf(u.master)).map((u) => u.master))].slice(0, 20),
      slots,
      sets,
      warnings,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
      notify("已複製診斷資訊，可貼給我檢查");
    } catch {
      notify("瀏覽器不允許複製，請手動截圖", "err");
    }
  };

  const handleFiles = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (f.size > 60 * 1024 * 1024) return notify("檔案超過 60MB，請確認是純 JSON 存檔", "err");
    try {
      await load(await f.text(), f.name);
    } catch {
      notify("讀取檔案失敗", "err");
    }
  };

  const loadDemo = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}demo-account.json`);
      if (!res.ok) throw new Error();
      await load(await res.text(), "demo-account.json");
      notify("已載入示範帳號，可開始試算");
    } catch {
      notify("找不到示範資料，請先執行 npm run demo", "err");
    } finally {
      setBusy(false);
    }
  };

  const fastest = summary?.topSpeed[0];

  return (
    <>
      <section className="hero">
        <div>
          <span className="chip gold" style={{ marginBottom: 12 }}>
            <Sparkles size={12} /> Speed Tick 先行計算
          </span>
          <h2>
            配符，不只看面板速度<br />
            而是<span>第幾 Tick 出手</span>
          </h2>
          <p style={{ marginTop: 12 }}>
            上傳 SWEX / SWOP 匯出的 JSON，立即分析魔靈、符文與速度分佈。
            配符時直接輸入「我要 Tick 5」，系統會自動把建築、速度隊長技、速度強化與套裝換算成符文速度需求，
            再從你的符文庫找出最佳組合。
          </p>
          <div className="row wrap" style={{ marginTop: 18, gap: 8 }}>
            <span className="chip">速度圖騰 15%</span>
            <span className="chip">隊長技 28%</span>
            <span className="chip">速度強化 30%</span>
            <span className="chip">Tick 5 = 286 速</span>
          </div>
        </div>

        <div className="card card-pad">
          <div
            className={`dropzone ${drag ? "hover" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void handleFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            style={{ cursor: "pointer", padding: "28px 18px" }}
          >
            <div className="dz-icon"><UploadCloud size={26} /></div>
            <div style={{ fontWeight: 700 }}>{busy ? "解析中…" : "拖放 JSON 到這裡"}</div>
            <div className="tiny dim">或點擊選擇檔案 · SWEX / SWOP / sw-tick-lab 格式</div>
            <input ref={inputRef} type="file" accept=".json,application/json" hidden onChange={(e) => void handleFiles(e.target.files)} />
          </div>

          <div className="row between" style={{ marginTop: 12 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste size={13} /> 貼上 JSON
            </button>
            <button className="btn btn-sm" onClick={() => void loadDemo()}>
              <Zap size={13} /> 載入示範帳號
            </button>
          </div>

          <div className="row tiny dim" style={{ marginTop: 12, gap: 6 }}>
            <ShieldCheck size={13} /> 解析與計算都在你的瀏覽器完成；登入後匯入的存檔會自動備份一份到 Google Drive。
          </div>
        </div>
      </section>

      {error && (
        <div className="alert err" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700 }}>匯入失敗</div>
          <div className="tiny" style={{ marginTop: 4 }}>{error}</div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="alert warn" style={{ marginTop: 14 }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {account && (() => {
        const unknown = account.units.filter((u) => !monsterOf(u.master));
        if (unknown.length === 0) return null;
        const ids = [...new Set(unknown.map((u) => u.master))].slice(0, 8);
        return (
          <div className="alert warn" style={{ marginTop: 14 }}>
            有 {unknown.length} 隻魔靈不在內建圖鑑中（master id：{ids.join("、")}）。
            配符仍可使用，但這些魔靈不會顯示名稱與圖示；如果是新魔靈，請通知我更新圖鑑。
          </div>
        );
      })()}

      {account && (
        <section style={{ marginTop: 22 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">目前載入的存檔</div>
                <div className="card-sub">{account.fileName} · {new Date(account.importedAt).toLocaleString("zh-TW")}</div>
              </div>
              <div className="row">
                <span className="chip green"><ShieldCheck size={12} /> 本機解析</span>
                <button className="btn btn-sm btn-ghost" onClick={() => void copyDiagnostics()} title="只複製數量與格式資訊，不含符文內容">
                  <ClipboardPaste size={13} /> 複製診斷
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => { if (confirm("確定要清除已載入的存檔？")) { void clearAccount(); notify("已清除存檔"); } }}>
                  <Trash2 size={13} /> 清除
                </button>
              </div>
            </div>
            <div className="card-pad">
              <div className="grid g4">
                <Stat k="魔靈數量" v={fmt(account.units.length)} />
                <Stat k="符文數量" v={fmt(account.runes.length)} />
                <Stat k="六星魔靈" v={fmt(account.units.filter((u) => u.stars === 6).length)} />
                <Stat k="速度圖騰" v={(() => {
                  const b = account.buildings.find((x) => x.id === 7);
                  return b ? `${buildingPct(7, b.level)}%` : "未偵測";
                })()} />
              </div>

              <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
                <a className="btn btn-primary" href="#/speed"><Gauge size={15} /> 前往速度實驗室</a>
                <a className="btn" href="#/optimizer"><Wand2 size={15} /> 開始配符</a>
                <a className="btn btn-ghost" href="#/monsters"><BookOpen size={15} /> 查看魔靈</a>
                <span className="dim tiny" style={{ marginLeft: "auto" }}>
                  {fastest ? `目前最快：${fastest.monster.name} ${fastest.stats.spd} 速（Tick ${fastest.stats.tick}）` : "尚無配符資料"}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      <section style={{ marginTop: 22 }}>
        <div className="grid g3">
          <Feature
            icon={<Gauge size={20} />}
            title="Tick 反推計算"
            desc="選擇魔靈、填入建築與隊長技，輸入目標 Tick，直接算出「符文需要多少速度」。也支援 RTA Tick。"
          />
          <Feature
            icon={<Wand2 size={20} />}
            title="以 Tick 為條件的配符"
            desc="不像其他工具只能設定面板速度。直接指定 Tick 目標 + 體力/命中下限，系統自動換算並找出最佳六件套。"
          />
          <Feature
            icon={<FileJson size={20} />}
            title="完整存檔分析"
            desc="魔靈盒、符文效率、套裝分佈、每隻魔靈的實際速度與 Tick，一鍵匯出配裝清單。"
          />
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><div className="card-title">如何使用</div><span className="chip muted">3 步完成</span></div>
        <div className="card-pad grid g3">
          <Step n={1} title="用 SWEX 匯出 JSON" desc="在遊戲內使用 Summoner's War Exporter 攔截資料，匯出成 .json 檔。SWOP 的存檔格式同樣支援。" />
          <Step n={2} title="拖放到上方" desc="解析在瀏覽器完成；登入後會自動備份一份原始 JSON 到 Google Drive。載入後可隨時切換頁面分析。" />
          <Step n={3} title="設定 Tick 目標配符" desc="在配符頁輸入 Tick 5，系統會算出需要 286 總速，並找出能達標的最佳符文組合。" />
        </div>
      </section>

      <p className="tiny dim" style={{ marginTop: 18, textAlign: "center" }}>
        魔靈圖示、基礎數值與技能資料來源：SWARFARM 公開資料 · 本工具與 Com2uS 無關
      </p>

      {pasteOpen && (
        <Modal title="貼上 JSON" onClose={() => setPasteOpen(false)}>
          <textarea
            className="input"
            style={{ minHeight: 240, fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}
            placeholder='{"unit_list": [...], "runes": [...]}'
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={() => setPasteOpen(false)}>取消</button>
            <button
              className="btn btn-primary"
              disabled={!pasteText.trim()}
              onClick={() => { void load(pasteText, "pasted.json"); setPasteOpen(false); setPasteText(""); }}
            >
              解析
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat-tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="card card-pad">
      <div style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(242,198,92,.1)", color: "var(--gold)", marginBottom: 10 }}>
        {icon}
      </div>
      <div style={{ fontWeight: 700, marginBottom: 5 }}>{title}</div>
      <div className="tiny muted" style={{ lineHeight: 1.7 }}>{desc}</div>
    </div>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
      <div style={{ width: 24, height: 24, borderRadius: 8, background: "rgba(88,166,255,.12)", color: "var(--blue)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12, flex: "0 0 24px" }}>{n}</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 12.5 }}>{title}</div>
        <div className="tiny muted" style={{ marginTop: 2 }}>{desc}</div>
      </div>
    </div>
  );
}
