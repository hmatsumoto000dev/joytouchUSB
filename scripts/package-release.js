const fs = require('fs');
const path = require('path');

function mkdirp(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDirRecursive(src, dest) {
  mkdirp(dest);
  for (const file of fs.readdirSync(src)) {
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);
    if (fs.statSync(srcFile).isDirectory()) {
      copyDirRecursive(srcFile, destFile);
    } else {
      copyFile(srcFile, destFile);
    }
  }
}

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const releaseDir = path.join(repoRoot, 'release');

console.log('📦 配布用パッケージを作成中...\n');

// release ディレクトリを初期化
if (fs.existsSync(releaseDir)) {
  fs.rmSync(releaseDir, { recursive: true });
}
mkdirp(releaseDir);

// EXE をコピー
const exePath = path.join(distDir, 'joytouchUSB.exe');
if (!fs.existsSync(exePath)) {
  console.error(`❌ エラー: ${exePath} が見つかりません`);
  console.error('   まず npm run build を実行してください');
  process.exit(1);
}
copyFile(exePath, path.join(releaseDir, 'joytouchUSB.exe'));
console.log('✓ joytouchUSB.exe をコピーしました');

// usb フォルダをコピー
const usbSrc = path.join(distDir, 'usb');
const usbDest = path.join(releaseDir, 'usb');
if (!fs.existsSync(usbSrc)) {
  console.error(`❌ エラー: ${usbSrc} フォルダが見つかりません`);
  console.error('   まず npm run build を実行してください');
  process.exit(1);
}
copyDirRecursive(usbSrc, usbDest);
console.log('✓ usb/ フォルダをコピーしました');

// README_DIST.md をコピー
const readmeSrc = path.join(repoRoot, 'README_DIST.md');
if (fs.existsSync(readmeSrc)) {
  copyFile(readmeSrc, path.join(releaseDir, 'README.md'));
  console.log('✓ README.md をコピーしました');
}

// 検証
const nodePath = path.join(usbDest, 'prebuilds', 'win32-x64', 'node.napi.node');
if (!fs.existsSync(nodePath)) {
  console.error(`\n❌ エラー: ${nodePath} が見つかりません`);
  process.exit(1);
}

console.log(`\n✅ 配布用パッケージを作成しました: ${releaseDir}\n`);
console.log('📂 フォルダ構成:');
console.log('release/');
console.log('├── joytouchUSB.exe');
console.log('├── README.md');
console.log('└── usb/');
console.log('    └── prebuilds/');
console.log('        └── win32-x64/');
console.log('            └── node.napi.node');
console.log('\n📦 このフォルダ全体をユーザーに配布してください。\n');
