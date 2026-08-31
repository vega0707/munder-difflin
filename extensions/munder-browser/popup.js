const DEFAULT_PORT = 9777;

const portInput = document.getElementById('port');
const tokenInput = document.getElementById('token');
const saveBtn = document.getElementById('save');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function updateStatus(status, detail) {
  statusDot.className = 'dot ' + (status || 'disconnected');
  const labels = {
    connected: 'Connected',
    connecting: 'Connecting…',
    disconnected: 'Disconnected'
  };
  let text = labels[status] || 'Disconnected';
  if (detail) text += ' — ' + detail;
  statusText.textContent = text;
}

function loadSettings() {
  chrome.storage.local.get(['bridgePort', 'bridgeToken', 'bridgeStatus', 'bridgeStatusDetail'], (data) => {
    portInput.value = data.bridgePort ?? DEFAULT_PORT;
    tokenInput.value = data.bridgeToken ?? '';
    updateStatus(data.bridgeStatus, data.bridgeStatusDetail);
  });
}

saveBtn.addEventListener('click', () => {
  const port = Number(portInput.value) || DEFAULT_PORT;
  const token = tokenInput.value.trim();
  chrome.storage.local.set({ bridgePort: port, bridgeToken: token }, () => {
    updateStatus('connecting');
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.bridgeStatus || changes.bridgeStatusDetail) {
    chrome.storage.local.get(['bridgeStatus', 'bridgeStatusDetail'], (data) => {
      updateStatus(data.bridgeStatus, data.bridgeStatusDetail);
    });
  }
});

loadSettings();
