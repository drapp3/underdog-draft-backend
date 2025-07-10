document.addEventListener('DOMContentLoaded', () => {
  // Check connection status
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const statusEl = document.getElementById('status');
    
    if (tab.url.includes('underdogfantasy.com/draft/') || 
        tab.url.includes('underdogfantasy.com/active/')) {
      statusEl.className = 'status connected';
      statusEl.textContent = 'Connected to draft';
    } else {
      statusEl.className = 'status disconnected';
      statusEl.textContent = 'Navigate to a draft page';
    }
  });
  
  // Refresh button
  document.getElementById('refresh').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.reload(tabs[0].id);
      window.close();
    });
  });
});