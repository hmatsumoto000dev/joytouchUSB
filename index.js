const path = require('path');
const fs = require('fs');
const readline = require('readline');

if (process.pkg) {
  const usbPath = path.join(path.dirname(process.execPath), 'usb');
  
  // USB フォルダと node.napi.node ファイルが存在するか確認
  const nodePath = path.join(usbPath, 'prebuilds', 'win32-x64', 'node.napi.node');
  if (!fs.existsSync(nodePath)) {
    console.error('❌ エラー: USB ネイティブドライバが見つかりません');
    console.error(`   期待される場所: ${nodePath}`);
    console.error('\n📦 配布時の確認:');
    console.error(`  1. joytouchUSB.exe と同じフォルダに usb/ ディレクトリがあるか確認してください`);
    console.error(`  2. 以下のファイルが存在するか確認してください:`);
    console.error(`     ${usbPath}\\prebuilds\\win32-x64\\node.napi.node`);
    console.error('\n詳細は README_DIST.md を参照してください');
    process.exit(1);
  }
  
  process.env.NODE_USB_PATH = usbPath;
}

const usb = require('usb');
const robot = require('robotjs');

// UsbDk バックエンドを使って、Windows でドライバー置換なしでデバイス操作を行う
usb.useUsbDkBackend();

const AOA_VENDOR_ID = 0x18D1;
const AOA_PRODUCT_IDS = [0x2D00, 0x2D01];
const ACCESSORY_STRINGS = [
   { index: 0, value: 'JoyTouch' },
    { index: 1, value: 'GamepadAccessory' },
     { index: 2, value: 'AOA Controller' },      // Descriptionを追加 
     { index: 3, value: '1.0' }, 
     { index: 4, value: 'https://example.com' }, // URIを追加 
     { index: 5, value: '00000000' }, // Serialを追加 
    ];

// USB VID to Vendor Name Mapping
const VENDOR_NAMES = {
  0x22b8: 'Motorola',
  0x18D1: 'Google',
  0x0BB4: 'HTC',
  0x04E8: 'Samsung',
  0x05AC: 'Apple',
  0x0E8D: 'MediaTek',
  0x1949: 'Lab126 (Amazon)',
  0x0955: 'NVIDIA',
  0x0403: 'FTDI',
  0x10C4: 'Silicon Labs',
};

const POLL_INTERVAL_MS = 1000;
const RECONNECT_TIMEOUT_MS = 20000; // 既定の再認識待機時間（ms）
const HANDSHAKE_RETRIES = 3; // AOA 開始リクエストのリトライ回数
const HANDSHAKE_WAIT_MS = 30000; // 各ハンドシェイク後に待機する最大時間（ms）
const AXIS_DEADZONE = 20;

let pressedKeys = new Set();
let activeEndpoint = null;
let activeInterface = null;
let activeDevice = null;

// Vendor ID から製造元名を取得
function getVendorName(vid) {
  return VENDOR_NAMES[vid] || `Unknown (0x${vid.toString(16).toUpperCase()})`;
}

// ユーザーに対話的にデバイスを選択させる
function askQuestion(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function selectAndroidDevice() {
  // すべての USB デバイスを取得
  const allDevices = usb.getDeviceList();
  
  // Android 互換デバイスをフィルター（Motorola, Google, HTC, Samsung など）
  const androidDevices = allDevices.filter((device) => {
    const { idVendor } = device.deviceDescriptor;
    // AOA をサポートしそうなベンダーか、または AOA モード機
    const isKnownAndroidVendor = Object.keys(VENDOR_NAMES).map(k => parseInt(k, 10)).includes(idVendor);
    const isAoaMode = idVendor === AOA_VENDOR_ID;
    return isKnownAndroidVendor || isAoaMode;
  });

  if (androidDevices.length === 0) {
    throw new Error('Android/AOA 互換デバイスが見つかりませんでした。USB デバイスを接続してください。');
  }

  if (androidDevices.length === 1) {
    // デバイスが 1 個だけならそれを選択
    return androidDevices[0];
  }

  // 複数デバイスの場合、ユーザーに選択させる
  console.log('\n複数の USB デバイスが見つかりました:\n');
  for (let i = 0; i < androidDevices.length; i++) {
    const dev = androidDevices[i];
    const vendor = getVendorName(dev.deviceDescriptor.idVendor);
    const pid = dev.deviceDescriptor.idProduct.toString(16).padStart(4, '0');
    const vid = dev.deviceDescriptor.idVendor.toString(16).padStart(4, '0');
    console.log(`  [${i + 1}] ${vendor} (VID=0x${vid}, PID=0x${pid})`);
  }

  while (true) {
    const answer = await askQuestion('\n接続するデバイスを選択 (1-' + androidDevices.length + '): ');
    const index = parseInt(answer, 10) - 1;
    if (index >= 0 && index < androidDevices.length) {
      const selected = androidDevices[index];
      const vendor = getVendorName(selected.deviceDescriptor.idVendor);
      console.log(`\n✓ 選択: ${vendor} (VID=0x${selected.deviceDescriptor.idVendor.toString(16).padStart(4, '0')})\n`);
      return selected;
    }
    console.log('無効な選択です。もう一度入力してください。');
  }
}

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

async function performAccessoryHandshake(device) {
  // 引数で指定されたデバイスでハンドシェイクを実行
  const vendor = getVendorName(device.deviceDescriptor.idVendor);
  console.log(`接続先デバイスを選択: ${vendor} (VID=0x${device.deviceDescriptor.idVendor.toString(16).padStart(4, '0')}, PID=0x${device.deviceDescriptor.idProduct.toString(16).padStart(4, '0')})`);


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

function findDeviceByVidPid(vid, pid) {
  return usb
    .getDeviceList()
    .find((deviceItem) => {
      const { idVendor, idProduct } = deviceItem.deviceDescriptor;
      return idVendor === vid && idProduct === pid;
    });
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
  // ボタンビットごとの割り当て
  toggleKey('j', Boolean(buttonFlags & 0x01)); // bit0
  toggleKey('k', Boolean(buttonFlags & 0x02)); // bit1
  toggleKey('l', Boolean(buttonFlags & 0x04)); // bit2
  toggleKey(';', Boolean(buttonFlags & 0x08)); // bit3
  toggleKey('u', Boolean(buttonFlags & 0x10)); // bit4
  toggleKey('i', Boolean(buttonFlags & 0x20)); // bit5
  toggleKey('o', Boolean(buttonFlags & 0x40)); // bit6
  toggleKey('p', Boolean(buttonFlags & 0x80)); // bit7
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
    // 再認識直後は少し待つ（OS側の準備時間を確保）
    await delay(500);

    const maxOpenAttempts = 6;
    const openDelayMs = 500;
    let openError = null;
    for (let attempt = 1; attempt <= maxOpenAttempts; attempt += 1) {
      console.log(`▶ device.open() を実行します... (attempt ${attempt}/${maxOpenAttempts})`);
      try {
        device.open();
        console.log('✅ device.open() 成功');
        openError = null;
        break;
      } catch (err) {
        openError = err;
        console.warn(`⚠️ device.open() に失敗しました: ${err.message || err}`);
        if (attempt < maxOpenAttempts) {
          console.log(`  ${openDelayMs}ms 待機して再試行します...`);
          await delay(openDelayMs);
        }
      }
    }
    if (openError) {
      throw openError;
    }

    console.log(`  接続デバイス: VID=0x${device.deviceDescriptor.idVendor.toString(16).padStart(4, '0')}, PID=0x${device.deviceDescriptor.idProduct.toString(16).padStart(4, '0')}`);
    console.log(`  設定数: ${device.deviceDescriptor.bNumConfigurations}`);

    // USB構成を明示的にセットする
    // これにより Android 側の 'configured' が true になり、ポップアップが出るトリガーになります
    try {
      console.log('▶ device.setConfiguration(1) を実行します...');
      await new Promise((resolve, reject) => {
        device.setConfiguration(1, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log('✅ USB構成（Configuration 1）をセットしました');
    } catch (err) {
      console.warn('⚠️ USB構成セット中にエラー（無視して続行します）:', err.message || err);
    }

    if (!device.interfaces || device.interfaces.length === 0) {
      throw new Error('デバイスのインターフェースが見つかりません。device.interfaces が空です。');
    }

    console.log(`  インターフェース数: ${device.interfaces.length}`);
    const iface = device.interfaces[0];
    activeInterface = iface;

    console.log(`▶ interface #${iface.descriptor.bInterfaceNumber} を取得します`);
    // isKernelDriverActive は Windows ではサポートされないことがあるため安全に呼び出す
    try {
      if (typeof iface.isKernelDriverActive === 'function') {
        let kernelActive = false;
        try {
          kernelActive = iface.isKernelDriverActive();
        } catch (e) {
          console.log('  isKernelDriverActive() はサポートされていません。カーネルドライバチェックをスキップします。', e.message || e);
        }
        if (kernelActive) {
          try {
            console.log('  カーネルドライバを切り離します...');
            iface.detachKernelDriver();
            console.log('✅ カーネルドライバ切り離し成功');
          } catch (err) {
            console.warn('⚠️ カーネルドライバの切り離しに失敗しました:', err.message || err);
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ カーネルドライバチェック中に例外が発生しました:', e.message || e);
    }

    console.log('▶ iface.claim() を実行します...');
    try {
      iface.claim();
      console.log('✅ インターフェースを占有（Claim）しました');
    } catch (err) {
      console.error('❌ iface.claim() でエラーが発生しました:', err.message || err);
      if (err && err.stack) console.error(err.stack);
      throw err;
    }

    const endpoint = iface.endpoints.find((ep) => ep.direction === 'in');
    console.log(`  エンドポイント数: ${iface.endpoints.length}`);
    if (!endpoint) {
      throw new Error('入力エンドポイントが見つかりません。');
    }
    activeEndpoint = endpoint;
    console.log(`✅ 受信エンドポイントが選択されました: address=0x${endpoint.descriptor.bEndpointAddress.toString(16)}`);
    startInputLoop(endpoint);
  } catch (error) {
    console.error('❌ 接続プロセス中にエラーが発生しました:', error.message || error);
    closeDevice(device);
    throw error;
  }
}

async function main() {
  console.log('AOA キーボード/マウス変換プログラムを開始します\n');

  process.on('SIGINT', cleanupAndExit);
  process.on('SIGTERM', cleanupAndExit);

  try {
    // ユーザーに接続するデバイスを選択させる
    const selectedDevice = await selectAndroidDevice();
    
    let aoaDevice = null;
    for (let attempt = 1; attempt <= HANDSHAKE_RETRIES; attempt += 1) {
      console.log(`
--- ハンドシェイク試行 ${attempt}/${HANDSHAKE_RETRIES} ---`);
      try {
        await performAccessoryHandshake(selectedDevice);
      } catch (err) {
        console.warn('ハンドシェイク送信中に警告が発生しました（続行します）:', err.message || err);
      }

      try {
        aoaDevice = await waitForAccessoryDevice(HANDSHAKE_WAIT_MS);
        console.log(`AOA デバイス接続完了: VID=0x${aoaDevice.deviceDescriptor.idVendor.toString(16)}, PID=0x${aoaDevice.deviceDescriptor.idProduct.toString(16)}`);
        break;
      } catch (err) {
        console.warn(`ハンドシェイク後の再認識待機がタイムアウトしました（${attempt}回目）。`);
        if (attempt < HANDSHAKE_RETRIES) {
          console.log('数秒待ってから再試行します...');
          await delay(2000);
          continue;
        }
        // 最終試行でも失敗
        throw new Error('AOA モードへの切り替えがタイムアウトしました。Zadig/UsbDk のドライバ設定や adb を確認してください（例: adb kill-server）。');
      }
    }

    if (!aoaDevice) {
      throw new Error('AOA デバイスが見つかりませんでした。');
    }

    // 少し待ってからデバイスを再取得
    await delay(2000);
    const freshDevice = findDeviceByVidPid(aoaDevice.deviceDescriptor.idVendor, aoaDevice.deviceDescriptor.idProduct);
    if (!freshDevice) {
      throw new Error('再認識後に AOA デバイスが取得できませんでした。');
    }
    console.log('🔄 再取得した AOA デバイスで接続処理を続行します');
    await connectAccessoryDevice(freshDevice);
  } catch (error) {
    console.error('エラーが発生しました:', error.message || error);
    process.exit(1);
  }
}

main();
