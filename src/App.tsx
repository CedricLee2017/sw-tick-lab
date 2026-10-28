import { useEffect, useState, type ReactNode } from "react";
import {
  Upload, LayoutDashboard, Users, Gauge, Wand2, Gem, Settings as SettingsIcon, ShieldCheck, CircleDot, Sparkles, Swords, Bookmark, Calculator, Layers,
} from "lucide-react";
import { useStore } from "./store";
import ImportPage from "./pages/Import";
import OverviewPage from "./pages/Overview";
import MonstersPage from "./pages/Monsters";
import SpeedPage from "./pages/SpeedLab";
import RtaPage from "./pages/Rta";
import BuildsPage from "./pages/Builds";
import ArtifactOptimizerPage from "./pages/ArtifactOptimizer";
import AdCalculatorPage from "./pages/AdCalculator";
import DecksPage from "./pages/Decks";
import OptimizerPage from "./pages/Optimizer";
import RunesPage from "./pages/Runes";
import ArtifactsPage from "./pages/Artifacts";
import SettingsPage from "./pages/Settings";
import { MonsterIcon } from "./components/ui";

type RouteKey = "import" | "overview" | "monsters" | "speed" | "rta" | "optimizer" | "artifact-opt" | "artifact-ad" | "builds" | "decks" | "runes" | "artifacts" | "settings";

const ROUTES: { key: RouteKey; label: string; icon: ReactNode; title: string; sub: string }[] = [
  { key: "import", label: "匯入", icon: <Upload size={17} />, title: "匯入存檔", sub: "上傳 SWEX / SWOP 匯出的 JSON" },
  { key: "overview", label: "總覽", icon: <LayoutDashboard size={17} />, title: "帳號總覽", sub: "魔靈、符文與速度分佈" },
  { key: "speed", label: "速度實驗室", icon: <Gauge size={17} />, title: "速度實驗室", sub: "Tick 反推、速度門檻與出手順序" },
  { key: "rta", label: "RTA", icon: <Swords size={17} />, title: "RTA 世界競技場", sub: "最愛魔靈的 RTA 獨立配裝與速度排行" },
  { key: "optimizer", label: "配符", icon: <Wand2 size={17} />, title: "一鍵配符", sub: "以 Tick 為條件的符文最佳化" },
  { key: "artifact-opt", label: "配神器", icon: <Sparkles size={17} />, title: "配神器", sub: "使用目前魔靈的裝備符文，直接最佳化神器" },
  { key: "artifact-ad", label: "神器追傷", icon: <Calculator size={17} />, title: "神器追傷計算器", sub: "依三圍與段數計算神器追加傷害" },
  { key: "builds", label: "儲存庫", icon: <Bookmark size={17} />, title: "配裝儲存庫", sub: "收藏的符文組合，隨時查看或帶回配符" },
  { key: "decks", label: "預設隊", icon: <Layers size={17} />, title: "預設隊", sub: "遊戲內 deck_list：所有已儲存的隊伍與配置" },
  { key: "monsters", label: "魔靈", icon: <Users size={17} />, title: "魔靈圖鑑", sub: "你的魔靈盒與目前配裝" },
  { key: "runes", label: "符文", icon: <Gem size={17} />, title: "符文倉庫", sub: "效率、套裝與裝備狀態" },
  { key: "artifacts", label: "神器", icon: <Sparkles size={17} />, title: "神器倉庫", sub: "屬性 / 類型神器、主副效果與裝備狀態" },
  { key: "settings", label: "設定", icon: <SettingsIcon size={17} />, title: "設定", sub: "建築、隊長技與進階選項" },
];

function currentRoute(): RouteKey {
  const h = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return (ROUTES.find((r) => r.key === h)?.key ?? "import") as RouteKey;
}

export default function App() {
  const [route, setRoute] = useState<RouteKey>(currentRoute());
  const { hydrate, ready, account, toasts, settings } = useStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (ready && !account && route !== "import" && route !== "settings") {
      window.location.hash = "#/import";
    }
  }, [ready, account, route]);

  const go = (k: RouteKey) => {
    window.location.hash = `#/${k}`;
    setRoute(k);
  };

  const meta = ROUTES.find((r) => r.key === route) ?? ROUTES[0];

  const page = (() => {
    if (!ready) return <div className="empty">載入中…</div>;
    switch (route) {
      case "overview": return <OverviewPage />;
      case "speed": return <SpeedPage />;
      case "rta": return <RtaPage />;
      case "optimizer": return <OptimizerPage />;
      case "artifact-opt": return <ArtifactOptimizerPage />;
      case "artifact-ad": return <AdCalculatorPage />;
      case "builds": return <BuildsPage />;
      case "decks": return <DecksPage />;
      case "monsters": return <MonstersPage />;
      case "runes": return <RunesPage />;
      case "artifacts": return <ArtifactsPage />;
      case "settings": return <SettingsPage />;
      default: return <ImportPage />;
    }
  })();

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
          {ROUTES.slice(1, 12).map((r) => (
            <button key={r.key} className={`nav-item ${route === r.key ? "active" : ""}`} onClick={() => go(r.key)}>
              {r.icon} {r.label}
              {!account && <span className="dim" style={{ marginLeft: "auto", fontSize: 10 }}>—</span>}
            </button>
          ))}
          <div className="nav-label">系統</div>
          {ROUTES.slice(12).map((r) => (
            <button key={r.key} className={`nav-item ${route === r.key ? "active" : ""}`} onClick={() => go(r.key)}>
              {r.icon} {r.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
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
        {ROUTES.filter((r) => ["import", "overview", "speed", "rta", "optimizer", "artifact-opt", "artifact-ad", "builds", "decks", "runes", "artifacts"].includes(r.key)).map((r) => (
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
    </div>
  );
}
