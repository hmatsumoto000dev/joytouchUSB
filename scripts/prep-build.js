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

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
mkdirp(distDir);

const usbPrebuildSrc = path.join(repoRoot, 'node_modules', 'usb', 'prebuilds', 'win32-x64');
const usbPrebuildTarget = path.join(distDir, 'usb', 'prebuilds', 'win32-x64');

if (!fs.existsSync(usbPrebuildSrc)) {
  throw new Error(`USB prebuilds not found: ${usbPrebuildSrc}`);
}

mkdirp(usbPrebuildTarget);

for (const file of fs.readdirSync(usbPrebuildSrc)) {
  const srcFile = path.join(usbPrebuildSrc, file);
  const destFile = path.join(usbPrebuildTarget, file);
  copyFile(srcFile, destFile);
}

console.log('Copied usb native prebuilds to', usbPrebuildTarget);
