const usb = require('usb');
const robot = require('robotjs');

// UsbDk バックエンドを使って、Windows でドライバー置換なしでデバイス操作を行う
usb.useUsbDkBackend();

const AOA_VENDOR_ID = 0x18D1;
const MOTOROLA_VID = 0x22b8;
const AOA_PRODUCT_IDS = [0x2D00, 0x2D01];
const ACCESSORY_STRINGS = [
  { index: 0, value: 'JoyTouch' },
  { index: 1, value: 'GamepadAccessory' },
  { index: 2, value: '1.0' },
];

const POLL_INTERVAL_MS = 1000;
const RECONNECT_TIMEOUT_MS = 20000;
const AXIS_DEADZONE = 20;

let pressedKeys = new Set();
let activeEndpoint = null;
let activeInterface = null;
let activeDevice = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function controlTransfer(device, bmRequestType, bRequest, wValue, wIndex, dataOrLength) {
  return new Promise((resolve, reject) => {
    device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, dataOrLength, (error, data) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    });
  });
}

function sendAccessoryString(device, index, text) {
  const buffer = Buffer.from(text + '\0', 'utf8');
  return controlTransfer(device, 0x40, 52, 0, index, buffer);
}

function closeDevice(device) {
  if (!device) return;
  try {
    if (device.interfaces) {
      device.interfaces.forEach((iface) => {
        try {
          if (iface.isKernelDriverActive && iface.isKernelDriverActive()) {
            iface.detachKernelDriver();
          }
          if (iface.claimed) {
            iface.release(true, () => {});
          }
        } catch (e) {
          // ignore
        }
      });
    }
  } catch (e) {
    // ignore
  }
  try {
    device.close();
  } catch (e) {
    // ignore
  }
}

async function performAccessoryHandshake() {
  // Motorola デバイスまたはすでに AOA モードのデバイスを検索
  const candidates = usb
    .getDeviceList()
    .filter((device) => {
      const { idVendor, idProduct } = device.deviceDescriptor;
      // Motorola (0x22b8) またはすでに AOA プレ状態のデバイスを探す
      return idVendor === MOTOROLA_VID || (idVendor === AOA_VENDOR_ID && !AOA_PRODUCT_IDS.includes(idProduct));
    });

  if (candidates.length === 0) {
    throw new Error('Android デバイスが見つかりませんでした。まず Android デバイスを接続してください。');
  }

  const device = candidates[0];
  console.log(`接続先デバイスを選択: VID=0x${device.deviceDescriptor.idVendor.toString(16).padStart(4, '0')}, PID=0x${device.deviceDescriptor.idProduct.toString(16).padStart(4, '0')}`);

  // デバイスをオープン
  try {
    device.open();
  } catch (err) {
    throw new Error(`デバイスオープンエラー: ${err.message || err}`);
  }

  try {
    // AOA プロトコルバージョン情報を取得
    try {
      console.log('\n📋 AOA プロトコルバージョンを問い合わせ中...');
      const protoBuffer = await controlTransfer(device, 0xc0, 51, 0, 0, 2);
      const protocolVersion = protoBuffer.readUInt16LE(0);
      console.log(`✅ AOA プロトコルバージョン: ${protocolVersion}`);
    } catch (err) {
      console.log(`⚠️ AOA プロトコル情報取得失敗: ${err.message || err}`);
      console.log('   → Motorola デバイスが AOA をサポートしていない可能性があります。');
      console.log('   → Android 側の開発者設定を確認してください。');
      throw err;
    }

    // アクセサリ文字列を送信
    console.log('\n📤 アクセサリ文字列を送信中...');
    for (const item of ACCESSORY_STRINGS) {
      console.log(`  [${item.index}] ${item.value}`);
      try {
        await sendAccessoryString(device, item.index, item.value);
        await delay(100); // 文字列間に遅延を入れる
      } catch (err) {
        console.warn(`  ⚠️ 文字列送信エラー: ${err.message || err}`);
      }
    }

    // AOA モード開始を要求
    console.log('\n🔄 AOA モード開始を要求中...');
    try {
      await controlTransfer(device, 0x40, 53, 0, 0, Buffer.alloc(0));
      console.log('✅ AOA モード開始要求を送信しました。');
    } catch (err) {
      console.warn(`⚠️ AOA モード開始要求エラー: ${err.message || err}`);
    }

    console.log('\n⏳ Android デバイスが AOA モード（VID=0x18D1）で再認識されるまで待機中...');
  } finally {
    closeDevice(device);
  }
}

async function waitForAccessoryDevice(timeoutMs = RECONNECT_TIMEOUT_MS) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const device = usb
      .getDeviceList()
      .find((deviceItem) => {
        const { idVendor, idProduct } = deviceItem.deviceDescriptor;
        return idVendor === AOA_VENDOR_ID && AOA_PRODUCT_IDS.includes(idProduct);
      });

    if (device) {
      return device;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error('AOA モードのデバイスを待機中にタイムアウトしました。');
}

function toggleKey(key, active) {
  if (!key) return;
  const isPressed = pressedKeys.has(key);
  if (active && !isPressed) {
    robot.keyToggle(key, 'down');
    pressedKeys.add(key);
  } else if (!active && isPressed) {
    robot.keyToggle(key, 'up');
    pressedKeys.delete(key);
  }
}

function updateButtons(buttonFlags) {
  // ボタンビットごとの割り当て例
  toggleKey('z', Boolean(buttonFlags & 0x01)); // bit0: 攻撃ボタン
  toggleKey('x', Boolean(buttonFlags & 0x02)); // bit1: ジャンプボタン
  toggleKey('c', Boolean(buttonFlags & 0x04)); // bit2: 特殊ボタン
  toggleKey('v', Boolean(buttonFlags & 0x08)); // bit3: アイテムボタン
}

function updateAxes(x, y) {
  toggleKey('a', x < -AXIS_DEADZONE);
  toggleKey('d', x > AXIS_DEADZONE);
  toggleKey('w', y < -AXIS_DEADZONE);
  toggleKey('s', y > AXIS_DEADZONE);

  // マウス移動に変換したい場合はここに追加できます。
  // 例: robot.moveMouseRelative(x, y);
}
function processReport(report) {
  // 受信したレポートを詳細にログ出力して解析する（日本語コメント）
  const ts = new Date().toISOString();

  // 生データを 16 進で表示
  const rawHex = Array.from(report || []).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`[${ts}] 受信バッファ (${report.length} bytes): ${rawHex}`);

  if (report.length < 3) {
    console.warn(`[${ts}] 不正なレポート受信:`, report);
    return;
  }

  // レポートのパース
  const buttonFlags = report.readUInt8(0);
  const xAxis = report.readInt8(1);
  const yAxis = report.readInt8(2);

  // 解析結果をログ出力
  console.log(`[${ts}] 解析結果: buttons=0x${buttonFlags.toString(16)}, x=${xAxis}, y=${yAxis}`);

  // 詳細ビット表示（VERBOSE_LOG=1 で有効）
  const VERBOSE_LOG = process.env.VERBOSE_LOG === '1' || process.env.DEBUG === '1';
  if (VERBOSE_LOG) {
    console.log(`[${ts}] ボタンビット詳細: ${buttonFlags.toString(2).padStart(8, '0')}`);
  }

  // 実際のキー操作へ伝搬
  updateButtons(buttonFlags);
  updateAxes(xAxis, yAxis);
}

function startInputLoop(endpoint) {
  if (!endpoint) {
    throw new Error('入力エンドポイントが見つかりませんでした。');
  }

  console.log('データ受信を開始します。');
  endpoint.startPoll(1, 8);

  endpoint.on('data', (data) => {
    processReport(data);
  });

  endpoint.on('error', (error) => {
    console.error('エンドポイント読み取り中にエラーが発生しました:', error.message || error);
    cleanupAndExit();
  });
}

function cleanupAndExit() {
  if (activeEndpoint) {
    try {
      activeEndpoint.stopPoll(() => {});
    } catch (e) {
      // ignore
    }
  }

  if (activeInterface) {
    try {
      activeInterface.release(true, () => {});
    } catch (e) {
      // ignore
    }
  }

  if (activeDevice) {
    closeDevice(activeDevice);
  }

  pressedKeys.forEach((key) => {
    try {
      robot.keyToggle(key, 'up');
    } catch (e) {
      // ignore
    }
  });
  pressedKeys.clear();

  process.exit(0);
}

async function connectAccessoryDevice(device) {
  activeDevice = device;
  try {
    device.open();
    const iface = device.interfaces[0];
    activeInterface = iface;

    if (iface.isKernelDriverActive && iface.isKernelDriverActive()) {
      try {
        iface.detachKernelDriver();
      } catch (err) {
        console.warn('カーネルドライバの切り離しに失敗しました:', err.message || err);
      }
    }

    iface.claim();

    const endpoint = iface.endpoints.find((ep) => ep.direction === 'in');
    if (!endpoint) {
      throw new Error('入力エンドポイントが見つかりません。');
    }
    activeEndpoint = endpoint;
    startInputLoop(endpoint);
  } catch (error) {
    closeDevice(device);
    throw error;
  }
}

async function main() {
  console.log('AOA キーボード/マウス変換プログラムを開始します');

  process.on('SIGINT', cleanupAndExit);
  process.on('SIGTERM', cleanupAndExit);

  try {
    await performAccessoryHandshake();
    const aoaDevice = await waitForAccessoryDevice();
    console.log(`AOA デバイス接続完了: VID=0x${aoaDevice.deviceDescriptor.idVendor.toString(16)}, PID=0x${aoaDevice.deviceDescriptor.idProduct.toString(16)}`);
    await connectAccessoryDevice(aoaDevice);
  } catch (error) {
    console.error('エラーが発生しました:', error.message || error);
    process.exit(1);
  }
}

main();
