// MV3 forbids inline scripts, hence this file.
const manifest = chrome.runtime.getManifest();
document.getElementById('name').textContent = manifest.name;
document.getElementById('version').textContent = manifest.version;
