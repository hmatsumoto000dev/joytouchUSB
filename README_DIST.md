# joytouchUSB - AOA キーボード/マウス変換プログラム

## 配布ファイル

このプログラムは、Android デバイスを USB Over AOA (Android Open Accessory) で接続し、デバイスからの入力（ボタン・アナログスティック）を Windows のキーボード・マウス操作に変換します。

## 必要な環境

- Windows 10 以上（64-bit）
- USB デバイスドライバ：Zadig でインストール
  - ドライバ種別: `libusbK` または `WinUSB` または `UsbDk`
- Android デバイス（AOA サポート）

## 配布ファイル構成

```
joytouch_20260604_2/
├── joytouchUSB.exe          （メイン実行ファイル）
└── usb/                     （USB ネイティブドライバ）
    └── prebuilds/
        └── win32-x64/
            └── node.napi.node
```

**重要**: `usb` フォルダと `joytouchUSB.exe` は**同じフォルダに置いて**ください。

## 使い方

1. **USB ドライバを Windows にインストール**
   - Zadig (https://zadig.akeo.ie/) をダウンロード
   - Android デバイスを USB で接続
   - Zadig を実行
   - デバイスを選択
   - ドライバを `libusbK` / `WinUSB` / `UsbDk` からいずれかを選択
   - 「Install Driver」をクリック

2. **プログラム実行**
   - コマンドプロンプト/PowerShell で、`joytouchUSB.exe` と同じフォルダに移動
   - `joytouchUSB.exe` を実行
   ```powershell
   .\joytouchUSB.exe
   ```

3. **デバイス選択**
   - 接続されている USB デバイスが表示されます
   - 番号を入力して Android デバイスを選択

4. **AOA 接続確認**
   - ハンドシェイク完了後、データ受信が開始されます
   - `[yyyy-mm-ddThh:mm:ss] 受信バッファ...` というログが出たら成功

5. **終了**
   - `Ctrl+C` で終了

## トラブルシューティング

### 「No native build was found...」エラー
- `usb` フォルダが `joytouchUSB.exe` と**同じフォルダ**に存在するか確認
- `usb/prebuilds/win32-x64/node.napi.node` が存在するか確認

### 「デバイスが見つかりません」エラー
- Android デバイスを USB で接続
- デバイスマネージャーで認識されているか確認
- Zadig でドライバを再インストール

### AOA 切り替えがタイムアウトする
- Android 側で開発者向けオプション → USB デバッグを有効化
- `adb` が起動している場合は `adb kill-server` で停止
- USB ケーブルを交換して再試行

## ボタン・軸割当（カスタマイズ）

`index.js` の `updateButtons()` と `updateAxes()` 関数で割当を変更できます：

```javascript
function updateButtons(buttonFlags) {
  toggleKey('z', Boolean(buttonFlags & 0x01)); // bit0
  toggleKey('x', Boolean(buttonFlags & 0x02)); // bit1
  toggleKey('c', Boolean(buttonFlags & 0x04)); // bit2
  toggleKey('v', Boolean(buttonFlags & 0x08)); // bit3
}

function updateAxes(x, y) {
  toggleKey('a', x < -AXIS_DEADZONE);  // 左
  toggleKey('d', x > AXIS_DEADZONE);   // 右
  toggleKey('w', y < -AXIS_DEADZONE);  // 上
  toggleKey('s', y > AXIS_DEADZONE);   // 下
}
```

好きなキーに変更して保存し、`joytouchUSB.exe` を再実行してください。
