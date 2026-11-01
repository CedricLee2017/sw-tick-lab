import { useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useStore } from "../store";

/** QR code 要編碼的網址：目前網站的根路徑（換網域或預覽部署也能用） */
export function siteUrl(): string {
  if (typeof window === "undefined") return "";
  return new URL(import.meta.env.BASE_URL || "/", window.location.origin).href;
}

/** 純 QR code（白底黑碼，掃描最穩定） */
export function SiteQr({ size = 132, title }: { size?: number; title?: string }) {
  const url = siteUrl();
  return (
    <div className="qr-box" style={{ width: size + 12 }}>
      <QRCodeSVG
        value={url}
        size={size}
        level="M"
        marginSize={2}
        bgColor="#ffffff"
        fgColor="#0b1120"
        title={title ?? `掃描前往 ${url}`}
      />
    </div>
  );
}

/** 複製文字：先試 Clipboard API，失敗時退回舊的 execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 例如沒有使用者手勢或瀏覽器封鎖，改用下面的方法 */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 首頁的「用手機或平板開啟」卡片（手機版隱藏，因為已經在手機上了） */
export function SiteQrCard() {
  const notify = useStore((s) => s.notify);
  const [copied, setCopied] = useState(false);
  const url = siteUrl();

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true);
      notify("已複製網址");
      setTimeout(() => setCopied(false), 1600);
    } else {
      notify("瀏覽器不允許複製，請長按或選取網址", "err");
    }
  };

  return (
    <section className="card qr-card">
      <div className="qr-card-body">
        <SiteQr size={132} />
        <div className="qr-copy">
          <div className="card-title row" style={{ gap: 7 }}>
            <Smartphone size={15} /> 用手機或平板開啟
          </div>
          <div className="tiny dim" style={{ lineHeight: 1.7 }}>
            用相機或 QR code App 掃描，即可在手機／平板開啟同一個網站。
            登入後會自動還原你的存檔與儲存庫，換裝置也能直接接續。
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
            <code className="qr-url" title={url}>{url}</code>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copy()}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "已複製" : "複製網址"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
