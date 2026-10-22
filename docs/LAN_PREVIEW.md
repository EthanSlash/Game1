# 用手機玩《夜市攤王》（區網預覽）

這份說明讓你不需要懂程式，就能在同一個 Wi-Fi 下，用 Android 手機玩到電腦上的最新版本。

## 事前準備

- 電腦和手機連到**同一個 Wi-Fi**（訪客 Wi-Fi 或公司網路可能會隔離裝置，連不上時請先換成家用 Wi-Fi）。
- 電腦已安裝 Node.js，並在專案資料夾執行過一次 `npm install`。

## 步驟

### 1. 在電腦啟動預覽

在專案資料夾開 PowerShell，執行：

```powershell
npm run preview:lan
```

它會先打包，再開啟伺服器。看到 `Network: http://…:4173/` 就代表成功。**這個視窗不要關**，關掉手機就連不上了。

### 2. 查電腦的 IP

另開一個 PowerShell，執行：

```powershell
ipconfig
```

找到你正在用的網路卡（通常是「無線區域網路介面卡 Wi-Fi」），記下 **IPv4 位址**，例如 `192.168.1.23`。

### 3. 開放 Windows 防火牆 4173 埠（只需做一次）

> ⚠️ 需要**系統管理員權限**：在開始選單搜尋 PowerShell，按右鍵選「以系統管理員身分執行」。

```powershell
New-NetFirewallRule -DisplayName "NightMarketKing LAN Preview 4173" -Direction Inbound -Protocol TCP -LocalPort 4173 -Action Allow -Profile Private,Domain
```

說明：這條規則在「私人網路」和「網域網路」生效（公司網路通常是「網域」）。如果 Windows 把你的 Wi-Fi 判定為「公用網路」，請到 設定 → 網路和網際網路 → Wi-Fi → 內容，把網路設定檔改成「私人」。

> ⚠️ 公司網路可能被群組原則禁止新增防火牆規則，或手機的 Wi-Fi 和電腦不在同一個網段。遇到這兩種情況，請改用電腦開的行動熱點，或手機 USB 連線。

用完想移除規則：

```powershell
Remove-NetFirewallRule -DisplayName "NightMarketKing LAN Preview 4173"
```

### 4. 用手機開啟

手機 Chrome 網址列輸入（把 IP 換成你的）：

```
http://192.168.1.23:4173
```

## 常見問題

**連不上（一直轉圈或 ERR_CONNECTION_TIMED_OUT）**
1. 確認電腦的預覽視窗還在執行。
2. 確認手機和電腦在同一個 Wi-Fi，且 IP 是用 `ipconfig` 查到的 Wi-Fi 那一個。
3. 確認第 3 步的防火牆規則已建立，且網路設定檔是「私人」。
4. 路由器若有「AP 隔離」或「客戶端隔離」，需先關閉。

**畫面空白**
- 在手機 Chrome 重新整理；仍空白就清除該網站資料後再開。
- 確認網址是 `http://`（不是 `https://`），且結尾埠號是 `:4173`。

**存檔沒保留**
- 存檔放在瀏覽器的 localStorage，**以網址為單位**。換 IP（例如電腦重新連 Wi-Fi 後 IP 變了）或換瀏覽器，就會看到全新的存檔。
- 使用無痕分頁、或清除瀏覽資料，存檔也會消失。

**能不能安裝成 App（PWA）？**
- 不行。瀏覽器只允許 `https://` 或 `localhost` 安裝 PWA，區網用的是 `http://IP`，所以只能在 Chrome 分頁裡玩。要安裝成 App 需之後部署到 https 網址。
