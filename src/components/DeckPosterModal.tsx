import { Download, Copy, ExternalLink } from "lucide-react";
import { Modal } from "./ui";
import { useStore } from "../store";

export interface PosterResult {
  url: string;
  blob: Blob;
  title: string;
  count: number;
}

/** 一鍵生圖的預覽：可下載 PNG 或直接複製到剪貼簿貼給隊友。 */
export function DeckPosterModal({ poster, onClose }: { poster: PosterResult; onClose: () => void }) {
  const notify = useStore((s) => s.notify);
  const fileName = `${poster.title}-${poster.count}隊.png`.replace(/[\\/:*?"<>|]/g, "-");

  const download = () => {
    const a = document.createElement("a");
    a.href = poster.url;
    a.download = fileName;
    a.click();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": poster.blob })]);
      notify("已複製圖片，可以直接貼到聊天室");
    } catch {
      notify("這個瀏覽器不支援複製圖片，請改用下載", "err");
    }
  };

  return (
    <Modal title={`${poster.title} · ${poster.count} 隊`} onClose={onClose} width={900}>
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        <button type="button" className="btn btn-sm btn-primary" onClick={download}>
          <Download size={12} /> 下載 PNG
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copy()}>
          <Copy size={12} /> 複製圖片
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => window.open(poster.url, "_blank")}>
          <ExternalLink size={12} /> 另開大圖
        </button>
        <span className="tiny dim" style={{ marginLeft: "auto" }}>共 {poster.count} 隊 · 下載或複製後直接貼給隊友</span>
      </div>
      <div
        className="scroll-y"
        style={{ maxHeight: "72vh", borderRadius: 12, border: "1px solid var(--line-soft)", background: "#0a1120" }}
      >
        <img src={poster.url} alt={`${poster.title}一鍵生圖`} style={{ display: "block", width: "100%" }} />
      </div>
    </Modal>
  );
}
