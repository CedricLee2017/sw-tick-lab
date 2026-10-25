# SW Tick Lab — 魔靈召喚 天空之役 符文配裝實驗室

以 **Speed Tick（出手順位）** 為核心的符文配裝工具。上傳 SWEX / SWOP 匯出的 JSON，就能分析帳號、比較魔靈，並用分支定界演算法在幾百毫秒內找出「剛好達到指定 Tick」的最佳配裝。

**線上使用：<https://sw-tick-lab.pages.dev>**

> 所有運算都在你的瀏覽器完成，帳號資料不會上傳到任何伺服器。

## 功能

- **匯入存檔**：支援 SWEX / SWOP JSON，自動偵測魔靈、符文、建築等級與已裝備狀態。可先載入內建的示範帳號試玩。
- **帳號總覽**：魔靈數量、符文數量、Speed Tick 分布、一速排名、套裝統計。
- **速度實驗室**：Tick ↔ 速度雙向換算、各 Tick 門檻表、建築與隊長技加成試算、隊伍出手順序模擬。
- **一鍵配符**：指定魔靈與 Tick（或面板速度），自動計算符文速度需求，回傳多組最佳配裝。
  - 以分支定界 + Web Worker 執行，預設每位置 18 顆候選、節點上限 400 萬。
  - 支援 4 件套 + 2 件套、套裝件數驗證、套裝速度加成（迅速）；可開啟「允許破套」只強制主套 4 件。
  - 可指定 #2 / #4 / #6 主屬性（速度、暴率、暴傷、HP%、攻擊%、防禦%、命中、抵抗）。
  - 可設定 HP / 攻擊 / 防禦 / 速度 / 暴率 / 暴傷 / 命中 / 抵抗 / EHP 下限。
  - 目標可選綜合評分、速度、EHP、傷害或命中。
  - 配符前先顯示「目前符文上限」；若目標 Tick 不可能達成會直接提示，不會空等。
  - Worker 載入失敗、逾時或網站更新造成舊頁面失效時，會顯示可重新整理的錯誤訊息。
- **符文管理**：依位置、套裝、星數、稀有度、副屬性搜尋與排序，快速找出可替換的符文。
- **魔靈圖鑑**：1987 隻魔靈基礎數值、覺醒狀態、現有配裝與速度。
- **設定**：建築等級覆寫、隊長技 / Buff 預設、RTA 模式、磨石與候選數、配裝紀錄、匯出 / 清除本機存檔。

## Tick 公式

```
Tick = ceil(10000 / (速度 × 7))
所需速度 = ceil(10000 / (Tick × 7))
```

- RTA 模式下每 Tick 為 1.5%，係數改為 `10000 / (速度 × 10)`。
- 例：滿等速度圖騰 +15%、隊長技 +28%、迅速套裝 +25%，要達到 **Tick 5（286 速）**，工具會自動回推需要的符文速度。
- 面板速度計算：`base + ceil(base × 百分比加成 / 100) + 固定值`；迅速套裝為 `ceil(base × 25 / 100)`。
- EHP：`HP × (1140 + 3.5 × 防禦) / 1000`。

## 配符沒有結果？

1. 先看配符頁的 **「目前符文上限」**：如果它低於目標速度，代表即使全選最高速符文也達不到。可降低 Tick、清除套裝限制、放寬 #2/#4/#6 主屬性，或勾選「允許破套」。
2. 若「開始配符」一直停在運算中，或出現「運算模組載入失敗」，請按 **Ctrl + F5**（Mac：Cmd + Shift + R）重新整理。網站更新後，舊分頁可能找不到新的 Worker 檔案。
3. 匯入後如果有「未知套裝 / 未知魔靈」警告，可在匯入頁按 **「複製診斷」**，把複製到的數量與格式資訊回報，不需要提供完整符文內容。

## 本機開發

需求：Node.js 20+。

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # TypeScript 檢查
npm run build      # 產出 dist/
npm run preview    # 預覽 production build
npm test           # Tick 公式與配符引擎測試（20 項）
```

其他指令：

```bash
npm run data   # 由 SWARFARM API 重新產生 src/data/monsters.json
npm run demo   # 重新產生 public/demo-account.json 示範存檔
```

## 部署（Cloudflare Pages）

```bash
npm run deploy
# 或
npm run build
npx wrangler pages deploy dist --project-name sw-tick-lab
```

`vite.config.ts` 已設定 `base: "./"`，可直接部署到任何靜態託管（GitHub Pages、Netlify、Cloudflare Pages）。

## 技術結構

```
src/
  lib/
    constants.ts        套裝、建築、符文數值表
    stats.ts            基礎值換算、套裝加成、Tick 計算
    parse.ts            SWEX / SWOP 解析
    optimizer.ts        分支定界配符引擎、回合模擬
    optimizer.worker.ts Web Worker 入口
    accountStats.ts     帳號統計
  components/ui.tsx     共用 UI（魔靈選擇器、符文卡、Tick 徽章）
  pages/                匯入、總覽、速度實驗室、配符、符文、魔靈、設定
  store.ts              zustand + IndexedDB 本機儲存
scripts/                資料產生與引擎測試
```

前端：Vite + React + TypeScript + zustand，無後端。

## 資料來源與聲明

- 魔靈基礎資料來自 [SWARFARM](https://swarfarm.com/) 公開 API，魔靈圖示為 SWARFARM 外部連結。
- 本專案為玩家自製工具，與 Com2uS 無任何關聯；《魔靈召喚：天空之役》及相關素材版權屬於原權利人。
- 建議僅上傳自己的存檔，並自行保管 JSON 檔。
