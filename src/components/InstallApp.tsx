import { useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2, Download, MoreVertical, PlusSquare, Share, Smartphone,
} from "lucide-react";
import { Modal } from "./ui";
import { useStore } from "../store";
import { promptInstall, pwaState, subscribePwa } from "../lib/pwa";

/** 側邊欄（完整按鈕）或手機頂部（圖示按鈕）的「安裝成 App」。 */
export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const notify = useStore((s) => s.notify);
  const [state, setState] = useState(pwaState);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => subscribePwa(() => setState(pwaState())), []);

  useEffect(() => {
    if (state.installed) setHelpOpen(false);
  }, [state.installed]);

  if (state.installed) return null;

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      notify("已開始安裝，完成後可從主畫面直接開啟");
      return;
    }
    if (outcome === "dismissed") {
      notify("已取消安裝");
      return;
    }
    setHelpOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className={`btn btn-sm install-btn ${compact ? "install-compact" : ""}`}
        onClick={() => void install()}
        title="安裝成 App"
        aria-label="安裝成 App"
      >
        {compact ? <Smartphone size={14} /> : <Download size={13} />}
        <span>{compact ? "安裝" : "安裝成 App"}</span>
      </button>

      {helpOpen && (
        <Modal title="安裝成 App" onClose={() => setHelpOpen(false)} width={430}>
          <div className="col" style={{ gap: 14 }}>
            <div className="tiny dim" style={{ lineHeight: 1.75 }}>
              {state.ios
                ? "iPhone / iPad 請用 Safari 開啟本頁，再依下列步驟加入主畫面："
                : "把 SW Tick Lab 安裝成獨立 App，之後從主畫面或桌面就能直接開啟："}
            </div>

            {state.ios ? (
              <>
                <HelpStep
                  icon={<Share size={15} />}
                  title="點一下「分享」"
                  desc="Safari 底部或頂端的分享圖示。"
                />
                <HelpStep
                  icon={<PlusSquare size={15} />}
                  title="選擇「加入主畫面」"
                  desc="在分享選單往下滑就會看到。"
                />
                <HelpStep
                  icon={<CheckCircle2 size={15} />}
                  title="按「新增」"
                  desc="之後從主畫面開啟就會是全螢幕 App。"
                />
              </>
            ) : (
              <>
                <HelpStep
                  icon={<MoreVertical size={15} />}
                  title="開啟瀏覽器選單"
                  desc="Chrome / Edge 右上角的 ⋮ 或 …。"
                />
                <HelpStep
                  icon={<Download size={15} />}
                  title="選擇「安裝應用程式」"
                  desc="有些版本顯示「加到主畫面」或「安裝 SW Tick Lab」。"
                />
                <HelpStep
                  icon={<Smartphone size={15} />}
                  title="確認安裝"
                  desc="Android 會加到主畫面，電腦會建立桌面捷徑。"
                />
              </>
            )}

            <div className="tiny dim" style={{ lineHeight: 1.7 }}>
              找不到安裝選項時，請確認使用 Chrome、Edge 或 Safari，並以 https:// 開啟本頁。
            </div>

            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setHelpOpen(false)}>
                知道了
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function HelpStep({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 9,
          display: "grid",
          placeItems: "center",
          flex: "0 0 28px",
          background: "rgba(242, 198, 92, .12)",
          color: "var(--gold)",
          border: "1px solid rgba(242, 198, 92, .28)",
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 12.5 }}>{title}</div>
        <div className="tiny dim" style={{ marginTop: 2, lineHeight: 1.6 }}>{desc}</div>
      </div>
    </div>
  );
}
