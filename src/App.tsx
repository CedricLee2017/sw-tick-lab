import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Upload, LayoutDashboard, Users, Gauge, Wand2, Gem, Settings as SettingsIcon, ShieldCheck, CircleDot, Sparkles, Swords, Bookmark, Calculator, Layers, Timer, ScrollText, Zap, LogIn, LogOut, LayoutGrid, X, Hammer, ArrowLeftRight,
} from "lucide-react";
import { ensureOwner, useStore } from "./store";
import { useAuth } from "./lib/auth";
import { Modal } from "./components/ui";
import LoginPage, { LoginForm } from "./pages/Login";
import ImportPage from "./pages/Import";
import OverviewPage from "./pages/Overview";
import MonstersPage from "./pages/Monsters";
import SummonLogPage from "./pages/SummonLog";
import SpeedPage from "./pages/SpeedLab";
import RtaPage from "./pages/Rta";
import BuildsPage from "./pages/Builds";
import ArtifactOptimizerPage from "./pages/ArtifactOptimizer";
import AdCalculatorPage from "./pages/AdCalculator";
import DamageComparePage from "./pages/DamageCompare";
import DecksPage from "./pages/Decks";
import SpeedTickPage from "./pages/SpeedTick";
import OptimizerPage from "./pages/Optimizer";
import TeamOptimizerPage from "./pages/TeamOptimizer";
import AdminPage from "./pages/Admin";
import RunesPage from "./pages/Runes";
import GrindPage from "./pages/Grind";
import ArtifactsPage from "./pages/Artifacts";
import SettingsPage from "./pages/Settings";
import { MonsterIcon } from "./components/ui";
import { InstallAppButton } from "./components/InstallApp";
import { formatCloudTime, loadLatestSave } from "./lib/cloudSave";

type RouteKey = "import" | "overview" | "monsters" | "summonlog" | "speed" | "speedtick" | "rta" | "optimizer" | "team-opt" | "artifact-opt" | "artifact-ad" | "damage-compare" | "builds" | "decks" | "runes" | "grind" | "artifacts" | "admin" | "settings";

const ROUTES: { key: RouteKey; label: string; icon: ReactNode; title: string; sub: string }[] = [
  { key: "import", label: "匯入", icon: <Upload size={17} />, title: "匯入存檔", sub: "上傳 SWEX / SWOP 匯出的 JSON" },
  { key: "overview", label: "總覽", icon: <LayoutDashboard size={17} />, title: "帳號總覽", sub: "魔靈、符文與速度分佈" },
  { key: "speed", label: "速度實驗室", icon: <Gauge size={17} />, title: "速度實驗室", sub: "Tick 反推、速度門檻與出手順序" },
  { key: "speedtick", label: "Speed Tick", icon: <Timer size={17} />, title: "Speed Tick 計算器", sub: "攻擊條、速度、出手順序與 Tick 門檻" },
  { key: "rta", label: "RTA", icon: <Swords size={17} />, title: "RTA 世界競技場", sub: "最愛魔靈的 RTA 獨立配裝與速度排行" },
  { key: "optimizer", label: "配符", icon: <Wand2 size={17} />, title: "一鍵配符", sub: "以 Tick 為條件的符文最佳化" },
  { key: "team-opt", label: "一鍵配隊", icon: <Zap size={17} />, title: "配置預設隊", sub: "最多 3 隊、15 隻魔靈一次配好，符文不重複" },
  { key: "artifact-opt", label: "配神器", icon: <Sparkles size={17} />, title: "配神器", sub: "使用目前魔靈的裝備符文，直接最佳化神器" },
  { key: "artifact-ad", label: "神器追傷", icon: <Calculator size={17} />, title: "神器追傷計算器", sub: "依三圍與段數計算神器追加傷害" },
  { key: "damage-compare", label: "傷害比較", icon: <ArrowLeftRight size={17} />, title: "傷害比較", sub: "比較兩套配裝在同一技能與神器追傷下的傷害" },
  { key: "builds", label: "儲存庫", icon: <Bookmark size={17} />, title: "儲存庫", sub: "預設隊與配裝收藏，隨時查看或帶回配符" },
  { key: "decks", label: "預設隊", icon: <Layers size={17} />, title: "預設隊", sub: "遊戲內 deck_list：所有已儲存的隊伍與配置" },
  { key: "monsters", label: "魔靈", icon: <Users size={17} />, title: "魔靈圖鑑", sub: "你的魔靈盒與目前配裝" },
  { key: "summonlog", label: "魔靈召喚記錄", icon: <ScrollText size={17} />, title: "魔靈召喚記錄", sub: "原4 / 原5 魔靈的取得時間軸" },
  { key: "runes", label: "符文", icon: <Gem size={17} />, title: "符文倉庫", sub: "效率、套裝與裝備狀態" },
  { key: "grind", label: "精煉建議", icon: <Hammer size={17} />, title: "精煉建議", sub: "依符文素質、套裝與裝備對象排出精煉順序" },
  { key: "artifacts", label: "神器", icon: <Sparkles size={17} />, title: "神器倉庫", sub: "屬性 / 類型神器、主副效果與裝備狀態" },
  { key: "admin", label: "後台", icon: <ShieldCheck size={17} />, title: "管理後台", sub: "會員、上傳紀錄與容量" },
  { key: "settings", label: "設定", icon: <SettingsIcon size={17} />, title: "設定", sub: "建築、隊長技與進階選項" },
];

/** 手機底部主選單：只放最常用的頁面，其餘收進「更多」面板。 */
const MOBILE_PRIMARY: RouteKey[] = ["overview", "speedtick", "optimizer", "team-opt"];
const MOBILE_SHORT_LABEL: Partial<Record<RouteKey, string>> = {
  speedtick: "Speed Tick",
};

function currentRoute(): RouteKey {
  const h = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return (ROUTES.find((r) => r.key === h)?.key ?? "import") as RouteKey;
}

const PAGE_COMPONENTS: Record<RouteKey, ComponentType> = {
  import: ImportPage,
  overview: OverviewPage,
  speed: SpeedPage,
  speedtick: SpeedTickPage,
  rta: RtaPage,
  optimizer: OptimizerPage,
  "team-opt": TeamOptimizerPage,
  "artifact-opt": ArtifactOptimizerPage,
  "artifact-ad": AdCalculatorPage,
  "damage-compare": DamageComparePage,
  builds: BuildsPage,
  decks: DecksPage,
  monsters: MonstersPage,
  summonlog: SummonLogPage,
  runes: RunesPage,
  grind: GrindPage,
  artifacts: ArtifactsPage,
  admin: AdminPage,
  settings: SettingsPage,
};

export default function App() {
  const [route, setRoute] = useState<RouteKey>(currentRoute());
  /** 已經開過的頁面：切換頁籤時只隱藏、不卸載，設定才不會消失 */
  const [visited, setVisited] = useState<Set<RouteKey>>(() => new Set([currentRoute()]));
  const { hydrate, ready, account, toasts, settings, importText, notify, syncLibrary } = useStore();
  const { ready: authReady, user, config, init: initAuth, signOut } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  /** 手機「更多」面板 */
  const [moreOpen, setMoreOpen] = useState(false);
  /** 自動還原雲端存檔只嘗試一次，避免每次重新渲染都重打 API */
  const cloudTried = useRef(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  // 登入且本機沒有任何存檔時，自動把上次上傳到雲端的 JSON 載回來。
  // 本機已有存檔就不覆蓋，避免蓋掉剛上符的符文配置。
  useEffect(() => {
    if (!ready || !authReady || !user || !config?.uploads) return;
    if (cloudTried.current) return;
    cloudTried.current = true;

    void (async () => {
      try {
        const switched = await ensureOwner(user.id);
        if (switched) notify("偵測到不同帳號登入，已清除這台裝置的舊資料，改從雲端還原");
        // 本機已有存檔就不覆蓋（換帳號時上面已經清空）
        if (useStore.getState().account) return;

        const save = await loadLatestSave();
        if (!save) return;
        // 期間可能已登出或手動匯入，這時不要再覆蓋
        if (!useAuth.getState().user || useStore.getState().account) return;
        const res = importText(save.text, save.fileName);
        if (res.ok) {
          notify(`已自動載入雲端存檔：${save.fileName}（${formatCloudTime(save.createdAt)}）`);
        }
      } catch (err) {
        console.warn("雲端存檔還原失敗", err);
      }
    })();
  }, [ready, authReady, user, config?.uploads, account, importText, notify]);

  // 登入後合併本機與雲端的儲存庫（配裝 / 預設隊）。
  useEffect(() => {
    if (!ready || !authReady || !user || !config?.uploads) return;
    void syncLibrary();
  }, [ready, authReady, user, config?.uploads, syncLibrary]);

  // 從手機改完儲存庫後，電腦切回分頁 / 每分鐘自動拉一次，不必重新整理。
  useEffect(() => {
    if (!ready || !authReady || !user || !config?.uploads) return;
    let last = 0;
    let disposed = false;
    const run = () => {
      if (disposed || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - last < 15_000) return;
      last = now;
      void syncLibrary();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(run, 60_000);
    return () => {
      disposed = true;
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [ready, authReady, user, config?.uploads, syncLibrary]);

  useEffect(() => {
    if (user) setLoginOpen(false);
  }, [user]);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    setVisited((prev) => (prev.has(route) ? prev : new Set(prev).add(route)));
  }, [route]);

  // 切換頁面時回到頂端，並關閉「更多」選單。
  useEffect(() => {
    window.scrollTo(0, 0);
    setMoreOpen(false);
  }, [route]);

  // 選單開啟時鎖住背景捲動，並支援 Esc 關閉。
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (ready && !account && route !== "import" && route !== "settings" && route !== "speedtick" && route !== "admin") {
      window.location.hash = "#/import";
    }
  }, [ready, account, route]);

  const go = (k: RouteKey) => {
    window.location.hash = `#/${k}`;
    setRoute(k);
  };

  const meta = ROUTES.find((r) => r.key === route) ?? ROUTES[0];

  const page = !ready ? (
    <div className="empty">載入中…</div>
  ) : (
    <>
      {ROUTES.map((r) => {
        if (!visited.has(r.key)) return null;
        const Comp = PAGE_COMPONENTS[r.key];
        return (
          <div key={r.key} hidden={route !== r.key}>
            <Comp />
          </div>
        );
      })}
    </>
  );

  // 等登入狀態確認後才決定要不要顯示登入牆，避免閃一下內容
  if (!authReady) return <div className="boot-screen">載入中…</div>;
  if (config?.forceLogin && !user) return <LoginPage />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-title">SW Tick Lab</div>
            <div className="brand-sub">Rune &amp; Speed Lab</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-label">工作區</div>
          {ROUTES.slice(0, 1).map((r) => (
            <button key={r.key} className={`nav-item ${route === r.key ? "active" : ""}`} onClick={() => go(r.key)}>
              {r.icon} {r.label}
            </button>
          ))}
          <div className="nav-label">分析</div>
          {ROUTES.slice(1, -1).filter((r) => r.key !== "admin" || user?.isAdmin).map((r) => (
            <button key={r.key} className={`nav-item ${route === r.key ? "active" : ""}`} onClick={() => go(r.key)}>
              {r.icon} {r.label}
              {!account && <span className="dim" style={{ marginLeft: "auto", fontSize: 10 }}>—</span>}
            </button>
          ))}
          <div className="nav-label">系統</div>
          {ROUTES.slice(-1).map((r) => (
            <button key={r.key} className={`nav-item ${route === r.key ? "active" : ""}`} onClick={() => go(r.key)}>
              {r.icon} {r.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          {user ? (
            <div className="account-row">
              {user.picture ? (
                <img className="account-avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="account-avatar account-avatar-fallback">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="account-name">{user.name || user.email}</div>
                <div className="account-mail">{user.email}</div>
              </div>
              <button type="button" className="rune-flag" title="登出" onClick={() => void signOut()}>
                <LogOut size={12} />
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-sm" style={{ width: "100%" }} onClick={() => setLoginOpen(true)}>
              <LogIn size={13} /> 使用 Google 登入
            </button>
          )}
          <InstallAppButton />
          {account ? (
            <div className="card" style={{ padding: 11 }}>
              <div className="row" style={{ gap: 8 }}>
                <MonsterIcon id={account.units[0]?.master ?? 0} size={30} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {account.wizard || "我的帳號"}
                  </div>
                  <div className="tiny dim">{account.units.length} 魔靈 · {account.runes.length} 符文 · {account.artifacts.length} 神器</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="tiny dim" style={{ padding: "0 8px" }}>尚未匯入存檔</div>
          )}
          <div className="row tiny dim" style={{ padding: "0 8px", gap: 6 }}>
            <ShieldCheck size={13} /> 資料只在你的瀏覽器運算
          </div>
          <div className="row tiny dim" style={{ padding: "0 8px", gap: 6 }}>
            <CircleDot size={12} /> {settings.rta ? "RTA Tick 模式" : "一般 Tick 模式"}
          </div>
          <div className="tiny dim" style={{ padding: "0 8px", opacity: 0.65 }}>
            版本 {__BUILD_TIME__.replace(/-/g, ".")}
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{meta.title}</h1>
            <div className="sub">{meta.sub}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <InstallAppButton compact />
            {account && (
              <span className="chip green">
                <ShieldCheck size={12} /> 已載入
              </span>
            )}
            {!account && (
              <button className="btn btn-primary btn-sm" onClick={() => go("import")}>
                <Upload size={14} /> 匯入 JSON
              </button>
            )}
          </div>
        </header>

        <main className="content">{page}</main>
      </div>

      <nav className="mobile-nav">
        {MOBILE_PRIMARY.map((key) => {
          const r = ROUTES.find((x) => x.key === key)!;
          return (
            <button key={r.key} className={route === r.key ? "active" : ""} onClick={() => go(r.key)}>
              {r.icon}
              <span>{MOBILE_SHORT_LABEL[r.key] ?? r.label}</span>
            </button>
          );
        })}
        <button
          className={!MOBILE_PRIMARY.includes(route) ? "active" : ""}
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          <LayoutGrid size={17} />
          <span>更多</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-back" onClick={() => setMoreOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="所有功能"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-grab" />
            <div className="sheet-head">
              <div>
                <div className="sheet-title">所有功能</div>
                <div className="tiny dim">選擇頁面，或管理帳號與安裝 App</div>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMoreOpen(false)} aria-label="關閉">
                <X size={16} />
              </button>
            </div>

            <div className="sheet-grid">
              {ROUTES.filter((r) => r.key !== "admin" || user?.isAdmin).map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={`sheet-item ${route === r.key ? "active" : ""}`}
                  onClick={() => {
                    go(r.key);
                    setMoreOpen(false);
                  }}
                >
                  {r.icon}
                  <span>{r.label}</span>
                </button>
              ))}
            </div>

            <div className="sheet-foot">
              <InstallAppButton />
              {user ? (
                <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
                  <LogOut size={14} /> 登出
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setMoreOpen(false);
                    setLoginOpen(true);
                  }}
                >
                  <LogIn size={14} /> 登入
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className="toast" style={{ borderColor: t.kind === "err" ? "rgba(255,107,107,.4)" : undefined }}>
            {t.msg}
          </div>
        ))}
      </div>

      {loginOpen && !user && (
        <Modal title="使用 Google 登入" onClose={() => setLoginOpen(false)} width={400}>
          <LoginForm />
        </Modal>
      )}
    </div>
  );
}
