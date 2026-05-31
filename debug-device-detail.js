const usb = require('usb');

console.log('USB バックエンド情報:');
console.log('=====================\n');

// UsbDk をデフォルトで試す
try {
  usb.useUsbDkBackend();
  console.log('✅ UsbDk バックエンド を試行中...\n');
} catch (err) {
  console.log('⚠️ UsbDk バックエンド 初期化エラー:', err.message);
}

const devices = usb.getDeviceList();

// Motorola デバイスを探す
const motoDevice = devices.find(d => d.deviceDescriptor.idVendor === 0x22b8);

if (!motoDevice) {
  console.error('❌ Motorola デバイス（VID=0x22b8）が見つかりません');
  process.exit(1);
}

console.log('Motorola デバイスの詳細情報:');
console.log('=============================\n');

const desc = motoDevice.deviceDescriptor;
console.log(`VID: 0x${desc.idVendor.toString(16).padStart(4, '0')}`);
console.log(`PID: 0x${desc.idProduct.toString(16).padStart(4, '0')}`);
console.log(`Device Class: 0x${desc.bDeviceClass.toString(16)}`);
console.log(`Device SubClass: 0x${desc.bDeviceSubClass.toString(16)}`);
console.log(`Device Protocol: 0x${desc.bDeviceProtocol.toString(16)}`);
console.log(`Max Packet Size: ${desc.bMaxPacketSize0}`);
console.log(`Number of Configurations: ${desc.bNumConfigurations}`);

console.log('\n設定情報:');
console.log('=========\n');

try {
  // デバイスをオープンして設定情報にアクセス
  console.log('デバイスをオープン中...');
  motoDevice.open();
  console.log('✅ デバイスオープン成功\n');
  
  const configDesc = motoDevice.configDescriptor;
  console.log(`Number of Interfaces: ${configDesc.bNumInterfaces}`);
  
  console.log('\nインターフェース一覧:');
  motoDevice.interfaces.forEach((iface, idx) => {
    console.log(`\n  [${idx}] インターフェース`);
    console.log(`      Number: ${iface.descriptor.bInterfaceNumber}`);
    console.log(`      Class: 0x${iface.descriptor.bInterfaceClass.toString(16)}`);
    console.log(`      SubClass: 0x${iface.descriptor.bInterfaceSubClass.toString(16)}`);
    console.log(`      Protocol: 0x${iface.descriptor.bInterfaceProtocol.toString(16)}`);
    console.log(`      Number of Endpoints: ${iface.descriptor.bNumEndpoints}`);
    
    if (iface.endpoints) {
      iface.endpoints.forEach((ep, epIdx) => {
        console.log(`        エンドポイント[${epIdx}]:`);
        console.log(`          Address: 0x${ep.descriptor.bEndpointAddress.toString(16)}`);
        console.log(`          Direction: ${ep.direction}`);
        console.log(`          Type: ${ep.descriptor.bmAttributes & 0x03}`);
        console.log(`          Max Packet Size: ${ep.descriptor.wMaxPacketSize}`);
      });
    }
  });
  
  motoDevice.close();
  console.log('\n✅ デバイスクローズ');
} catch (err) {
  console.error('❌ 設定情報取得エラー:', err.message || err);
}

console.log('\n\n試行 2: 標準 libusb バックエンド');
console.log('==================================\n');

// UsbDk をリセットして、標準バックエンドを試す
// Note: これは実際には効果がないかもしれません。ただし情報を表示します
console.log('libusb バックエンドは Windows では制限されています。');
console.log('UsbDk または zadig を使用してドライバを置き換える必要があります。');

console.log('\n\n推奨事項:');
console.log('==========');
console.log('1. UsbDk が正しくインストールされているか確認: https://github.com/daynix/UsbDk');
console.log('2. Motorola デバイスが MTP/ADB モードの場合、AOA に対応していない可能性があります');
console.log('3. zadig を使用して、デバイスドライバを libusb に置き換える');
console.log('   (ただし、この操作はリスクがあるため注意してください)');
