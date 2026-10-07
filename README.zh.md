# dsh-hrinfo-boot

HRINFO 開機動畫與解鎖閘門，DSH Web GUI 用的插件。

片頭以純向量 **Hrinfo** 字標（`i` 上的點是紅色）疊在往下流的字元雨上，
並以 4 格密碼面板鎖住介面，輸入正確密碼才放行。
不連網、不讀外部檔案，除了 `$DSH_HOME` 之外不寫任何位置。

## 安裝

```bash
# 從 GitHub 安裝（推薦；lib/ 已預先建置，pnpm 不需要跑任何建置腳本）
dsh plugin --profile web add github:jiadonghan83-cmd/dsh-hrinfo-boot
# 鎖定發行版本
dsh plugin --profile web add github:jiadonghan83-cmd/dsh-hrinfo-boot#v0.1.2
```

Windows 上還有一個「一鍵安裝」：`install.cmd` 與 `dsh-hrinfo-boot-0.1.4.tgz` 就在本倉庫根目錄，
把兩者放在同一個資料夾（或直接 clone 本倉庫）後執行：

```bat
install.cmd 7k2p
```

> 這裡的 `7k2p` 只是本文件沿用的**範例碼**——**本插件沒有任何預設密碼**。
> 不給參數時 `install.cmd` 會問你要不要設；加 `--no-code` 則保持關卡關閉。
> 詳見下一節「解鎖密碼」。

設定解鎖密碼，然後重啟 DSH——這裡的 `7k2p` 只是範例，請換成你自己的 4 位碼：

```bash
node "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-hrinfo-boot\src\set-code.mjs" 7k2p
```

```bash
dsh --profile web
```

插件**已預先建置**。`dsh plugin add` 底層是 pnpm，而 pnpm 會阻擋 git 來源套件的
`prepare` 腳本直到使用者允許，所以「安裝時才建置」的插件對大多數人會失敗。
因此 `lib/` 直接隨套件附上。

### 從目錄或 tarball 安裝

```bash
dsh plugin --profile web add /path/to/dsh-hrinfo-boot
dsh plugin --profile web add /path/to/dsh-hrinfo-boot-0.1.4.tgz
```

## 解鎖密碼

**沒有預設密碼，也沒有「萬用碼」。** 下文出現的 `7k2p` 只是沿用的範例，請自己設一組。 未設定密碼時閘門是關閉的，片頭直接播完——
這是刻意的，確保全新安裝不可能把人鎖在外面。

密碼為 4 個字元，只能使用 `[0-9A-Za-z]`。**不存明文**：host 端寫入
PBKDF2-SHA512 記錄（210,000 次迭代、64 bytes 金鑰、每次安裝隨機 salt）到
`$DSH_HOME/hrinfo-boot.json`，比對使用 constant-time。

### 一鍵安裝完成後，去哪裡改密碼

腳本在已安裝的插件裡，位於你的 DSH home（預設 `%USERPROFILE%\.dsh`）之下：

```bat
:: 絕對路徑：在任何目錄都能跑
node "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-hrinfo-boot\src\set-code.mjs" 7k2p

:: 或用安裝包裡的包裝腳本（它會自己拼出上面的路徑）
D:\SOFT\DSH\set-code.cmd 7k2p
```

DSH 的 home 不在預設位置時，明確指定：

```bat
node "...\profiles\web\node_modules\dsh-hrinfo-boot\src\set-code.mjs" 7k2p --home "D:\某處\.dsh"
D:\SOFT\DSH\set-code.cmd 7k2p --home "D:\某處\.dsh"
```

改完**重新整理頁面**即可（host 每次請求都重讀碼檔），或按 **Ctrl+Shift+L** 立刻重新上鎖。

```bash
node src/set-code.mjs 7k2p        # 設定或變更密碼
node src/set-code.mjs --status    # 查詢是否已設密碼
node src/set-code.mjs --clear     # 關閉閘門
node src/set-code.mjs 7k2p --home /custom/dsh/home
```

連續 5 次錯誤會啟動 30 秒鎖定，之後每次失敗加倍，上限 5 分鐘。
計數器存在記憶體，所以重啟 DSH 會清除——這是為了避免每次猜錯都寫硬碟。

### 不重啟就重新鎖定

按 **Ctrl+Shift+L** 即可重新鎖定。片頭不會重播，面板直接蓋回執行中的介面。

### 忘記密碼的救援

```bash
node src/set-code.mjs --clear
```

或直接刪除 `$DSH_HOME/hrinfo-boot.json` 後重啟。

## 這不是什麼

**這個閘門不是安全邊界。** DSH 自己的 `/api/*` 路由屬於 `dsh-client-connection`
服務，插件無法搶在它前面註冊，所以持有 DSH token 的人不需要看到這個鎖就能存取 API。
請把它當成「離開座位時的螢幕鎖」，而不是存取控制。DSH 預設只綁 `127.0.0.1`，
那才是真正有意義的邊界。

## 運作原理

片頭掛在 DSH 自己的擴充點上。host 半部在 `webserver/index-inject` 註冊一列——
這與 DSH 的 theme、client-module 服務用的是同一套機制——所以第一帧在文件還在解析時
就畫出來了，DSH 自己的開機卡片不會出現。client 半部接著在同一個 task 內把 stage
掛進 shadow root，覆蓋掉那一層。

有幾個細節是**關鍵且容易在修改時弄壞的**：

- **雨的 canvas 掛在 `document.body`，不在 overlay 內。** 實測同一個 canvas：
  從 body 合成 **1,024,000 像素**，從 overlay 的 shadow root 內只合成 **618 像素**，
  而兩者祖先鏈都沒有任何裁切。**overlay 子樹會抑制 canvas 合成**；同子樹的 SVG 文字
  不受影響，這就是為何字標一直正常、只有雨消失。
- **canvas 必須明確設定 CSS `width`/`height`。** canvas 是 replaced element：
  沒有 CSS 尺寸就退回屬性尺寸 300×150，無論怎麼定位——於是「被合成的元素」
  不再是「被量測的元素」。
- **canvas 必須帶內聯 `z-index`。** positioned 元素若 `z-index:auto` 等同 0，
  會被任何有實際 z-index 的 positioned 兄弟元素壓在下面——此處是 overlay 的 `2147483000`。
- **overlay 的 `:host{background}` 要在 shadow sheet 內覆蓋。** `--bg` 宣告在 `:host` 上，
  而 shadow host 宣告會被提升到外層樹，所以文件層級的覆蓋再具體也贏不了。
- **字標用 `!important` 壓過 `.boot-stage svg{width:min(680px,90vw)}`**；
  那條移植來的規則優先級高於單一 class 選擇器，否則字標會被釘在左邊。
- **密碼面板的聚焦是排程的，不是呼叫一次。** 片頭轉場期間 `focus()` 可能被靜默拒絕
  （overlay 還是 `pointer-events:none`），而且沒有任何機制會重試。

## 重新建置

`lib/` 是從 [`dsh-550c-boot`](https://github.com/yannicksong0106/dsh-550c-boot) 0.3.3
打補丁產生的，所以上游 tarball 隨套件附在 `vendor/550c.tgz`：

```bash
node build.mjs           # 重新產生 lib/
node build.mjs --check   # lib/ 與全新建置不一致就失敗
npm run verify           # 語法檢查 + 建置可重現性
```

`build.mjs` 拒絕複製無法解析的產生物，`--check` 則逐位元組比對全新建置。

## 目錄結構

```
lib/           建置產物 — host 半部、client bundle、閘門、CLI
src/           補丁注入的原始碼
scripts/       補丁程式與字標建置器
assets/        補丁內嵌的字標 SVG
vendor/        550c.tgz，未修改的上游套件
```

## 致謝與授權

MIT，見 `LICENSE`。

片頭衍生自 [`dsh-550c-boot`](https://github.com/yannicksong0106/dsh-550c-boot) 0.3.3
（作者 Ziyang Song），其 MIT 授權聲明原文保留於 `LICENSE-550c-boot`。
該專案另致謝 [Voidpoket](https://github.com/Voidpoket) 提供 550C 片頭動畫的 HTML 原始碼。

字元雨是**獨立實作**，技術學習自 [`glyph-rain`](https://github.com/Toskan4134/glyph-rain)
（MIT）：以螢幕比例計算尾跡長度與速度、每條 lane 多個 drop 以 gap 間隔、連續繪製尾跡、
整格字元陣列搭配每格 churn 時間，以及字標顯影遮罩。**未複製其任何程式碼。**
