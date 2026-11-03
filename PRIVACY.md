# Sniff Player Privacy Policy

English · [繁體中文](#繁體中文)

Effective date: 2026-11-03

This policy covers the Sniff Player browser extension, published by V-AX.

## What the extension handles

- **Web history and site content:** the URLs and response headers of the requests your tabs make, and each tab's URL and title. The extension uses them only to recognise HLS playlists and video files, and to name the player tab. It doesn't read the content of the pages you visit.
- **The list of detected videos:** their URLs, qualities, length and size.
- **URLs you paste** into the extension to play.

## Where it is kept

The list of detected videos is kept in the browser's session storage. It isn't written to disk, and it's gone when you close the browser. Nothing else is stored. A video you play opens in a normal tab, so its URL can stay in your browser history like any other page.

## What is sent, and to whom

The extension has no server and no analytics. It sends nothing to V-AX or to anyone else. It only talks to the sites the videos come from:

- It reads each detected playlist once, without cookies, to learn its qualities and length.
- When you press Play, the player requests the video from its own host, with your cookies for that host only.
- If a host refuses a request, the player sends that host the origin of the page where the video was found, once.

## What we don't do

We don't sell your data, transfer it to third parties, use it for anything other than the extension's single purpose, or use it to determine creditworthiness or for lending.

## Changes and contact

If this policy changes, the new version will be published at this address with a new effective date. Questions: support@v-ax.com, or an issue at https://github.com/xxxxDev/sniff-player/issues.

---

## 繁體中文

生效日期：2026-11-03

本政策適用於 V-AX 發布的 Sniff Player 瀏覽器擴充工具。

### 擴充工具會處理的資料

- **網頁記錄與網站內容：** 分頁發出的請求網址與回應標頭，以及每個分頁的網址和標題。只用來辨識 HLS 播放清單和影片檔，以及為播放分頁命名。不讀取你造訪網頁的內容。
- **偵測到的影片清單：** 影片網址、畫質、片長與大小。
- **你貼上** 要播放的網址。

### 存放位置

偵測到的影片清單存在瀏覽器的工作階段儲存空間，不寫入磁碟，關閉瀏覽器就會消失。其他資料都不儲存。你播放的影片會開在一般分頁，所以網址可能和其他網頁一樣留在瀏覽紀錄裡。

### 傳送哪些資料、傳給誰

擴充工具沒有伺服器，也沒有使用分析，不會傳任何資料給 V-AX 或其他人。它只會和影片所在的網站連線：

- 每份偵測到的播放清單會不帶 Cookie 再讀一次，以取得畫質與片長。
- 按下播放時，播放器向影片所在主機請求影片，只帶該主機的 Cookie。
- 如果主機拒絕請求，播放器會把發現影片的網頁來源送給該主機一次。

### 我們不做的事

我們不販售你的資料、不轉移給第三方、不用於擴充工具單一用途以外的目的，也不用於判斷信用或借貸。

### 變更與聯絡

本政策如有變更，新版會公布在同一個網址並更新生效日期。如有問題請寫信到 support@v-ax.com，或在 https://github.com/xxxxDev/sniff-player/issues 提出。
