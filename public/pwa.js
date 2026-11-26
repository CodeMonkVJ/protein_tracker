const installButton = document.getElementById('installApp');
let installPrompt;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = undefined;
  installButton.hidden = true;
  try {
    await prompt.prompt();
  } catch (error) {
    console.debug('The install prompt is no longer available.', error);
  }
});

window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  installButton.hidden = true;
});

const offlineStatus = document.getElementById('offlineStatus');
function updateConnectionStatus() {
  offlineStatus.hidden = navigator.onLine;
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((error) => {
    console.debug('Offline app setup was unavailable.', error);
  });
}
