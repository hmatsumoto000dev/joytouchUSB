const usb = require('usb');
usb.useUsbDkBackend();

console.log('接続されているすべての USB デバイス:');
console.log('=====================================\n');

const devices = usb.getDeviceList();
console.log(`総デバイス数: ${devices.length}\n`);

for (let i = 0; i < devices.length; i++) {
  const device = devices[i];
  const desc = device.deviceDescriptor;
  
  console.log(`[${i}] VID=0x${desc.idVendor.toString(16).padStart(4, '0')}, PID=0x${desc.idProduct.toString(16).padStart(4, '0')}`);
  console.log(`    Device Class: 0x${desc.bDeviceClass.toString(16)}`);
  console.log(`    Device SubClass: 0x${desc.bDeviceSubClass.toString(16)}`);
  
  // Motorola デバイスを識別
  if (desc.idVendor === 0x22b8) {
    console.log('    ✅ → これが Motorola デバイスです');
  }
  
  // AOA モード確認
  if (desc.idVendor === 0x18d1 && (desc.idProduct === 0x2d00 || desc.idProduct === 0x2d01)) {
    console.log('    🎮 → これは AOA モードのデバイスです');
  }
  
  console.log('');
}

console.log('=====================================');
console.log('以下のコマンドでハンドシェイクを開始します:');
console.log('npm start');

