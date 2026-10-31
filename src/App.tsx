import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Upload, LayoutDashboard, Users, Gauge, Wand2, Gem, Settings as SettingsIcon, ShieldCheck, CircleDot, Sparkles, Swords, Bookmark, Calculator, Layers, Timer, ScrollText, Zap, LogIn, LogOut,
} from "lucide-react";
import { useStore } from "./store";
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
import DecksPage from "./pages/Decks";
import SpeedTickPage from "./pages/SpeedTick";
import OptimizerPage from "./pages/Optimizer";
import TeamOptimizerPage from "./pages/TeamOptimizer";
import RunesPage from "./pages/Runes";
import ArtifactsPage from "./pages/Artifacts";
import SettingsPage from "./pages/Settings";
import { MonsterIcon } from "./components/ui";

type RouteKey = "import" | "overview" | "monsters" | "summonlog" | "speed" | "speedtick" | "rta" | "optimizer" | "team-opt" | "artifact-opt" | "artifact-ad" | "builds" | "decks" | "runes" | "artifacts" | "settings";

const ROUTES: { key: RouteKey; label: string; icon: ReactNode; title: string; sub: string }[] = [
  { key: "import", label: "匯入", icon: <Upload size={17} />, title: "匯入存檔", sub: "上傳 SWEX / SWOP 匯出的 JSON" },
  { key: "overview", label: "總覽", icon: <LayoutDashboard size={17} />, title: "帳號總覽", sub: "魔靈、符文與速度分佈" },
  { key: "speed", label: "速度實驗室", icon: <Gauge size={17} />, title: "速度實驗室", sub: "Tick 反推、速度門檻與出手順序" },
  { key: "speedtick", label: "Speed Tick", icon: <Timer size={17} />, title: "Speed Tick 計算器", sub: "攻擊條、速度、出手順序與 Tick 門檻" },
  { key: "rta", label: "RTA", icon: <Swords size={17} />, title: "RTA 世界競技場", sub: "最愛魔靈的 RTA 獨立配裝與速度排行" },
  { key: "optimizer", label: "配符", icon: <Wand2 size={17} />, title: "一鍵配符", sub: "以 Tick 為條件的符文最佳化" },
  { key: "team-opt", label: "一鍵配隊", icon: <Zap size={17} />, title: "配置預設隊", sub: "3／4／5 隻魔靈一次配好，符文不重複" },
  { key: "artifact-opt", label: "配神器", icon: <Sparkles size={17} />, title: "配神器", sub: "使用目前魔靈的裝備符文，直接最佳化神器" },
  { key: "artifact-ad", label: "神器追傷", icon: <Calculator size={17} />, title: "神器追傷計算器", sub: "依三圍與段數計算神器追加傷害" },
  { key: "builds", label: "儲存庫", icon: <Bookmark size={17} />, title: "儲存庫", sub: "預設隊與配裝收藏，隨時查看或帶回配符" },
  { key: "decks", label: "預設隊", icon: <Layers size={17} />, title: "預設隊", sub: "遊戲內 deck_list：所有已儲存的隊伍與配置" },
  { key: "monsters", label: "魔靈", icon: <Users size={17} />, title: "魔靈圖鑑", sub: "你的魔靈盒與目前配裝" },
  { key: "summonlog", label: "魔靈召喚記錄", icon: <ScrollText size={17} />, title: "魔靈召喚記錄", sub: "原4 / 原5 魔靈的取得時間軸" },
  { key: "runes", label: "符文", icon: <Gem size={17} />, title: "符文倉庫", sub: "效率、套裝與裝備狀態" },
  { key: "artifacts", label: "神器", icon: <Sparkles size={17} />, title: "神器倉庫", sub: "屬性 / 類型神器、主副效果與裝備狀態" },
  { key: "settings", label: "設定", icon: <SettingsIcon size={17} />, title: "設定", sub: "建築、隊長技與進階選項" },
];

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
  builds: BuildsPage,
  decks: DecksPage,
  monsters: MonstersPage,
  summonlog: SummonLogPage,
  runes: RunesPage,
  artifacts: ArtifactsPage,
  settings: SettingsPage,
};

export default function App() {
  const [route, setRoute] = useState<RouteKey>(currentRoute());
  /** 已經開過的頁面：切換頁籤時只隱藏、不卸載，設定才不會消失 */
  const [visited, setVisited] = useState<Set<RouteKey>>(() => new Set([currentRoute()]));
  const { hydrate, ready, account, toasts, settings } = useStore();
  const { ready: authReady, user, config, init: initAuth, signOut } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

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

  useEffect(() => {
    if (ready && !account && route !== "import" && route !== "settings" && route !== "speedtick") {
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
          {ROUTES.slice(1, -1).map((r) => (
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
        {ROUTES.filter((r) => ["import", "overview", "speed", "speedtick", "rta", "optimizer", "team-opt", "artifact-opt", "artifact-ad", "builds", "decks", "summonlog", "runes", "artifacts"].includes(r.key)).map((r) => (
          <button key={r.key} className={route === r.key ? "active" : ""} onClick={() => go(r.key)}>
            {r.icon}
            <span>{r.label}</span>
          </button>
        ))}
      </nav>

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
