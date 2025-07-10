// Store draft data and player mappings
let draftData = {};
let playerData = {};
let authToken = null;

// Intercept API responses
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Capture auth token
    const authHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'authorization');
    if (authHeader) {
      authToken = authHeader.value;
    }
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["*://api.underdogfantasy.com/*"] },
  ["requestHeaders"]
);

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_DRAFT_DATA') {
    fetchDraftData(request.draftId).then(data => {
      sendResponse(data);
    });
    return true; // Keep channel open for async response
  }
  
  if (request.type === 'GET_PLAYERS') {
    fetchPlayers().then(data => {
      sendResponse(data);
    });
    return true;
  }
});

async function fetchDraftData(draftId) {
  if (!authToken) {
    console.error('No auth token available');
    return null;
  }
  
  try {
    const response = await fetch(`https://api.underdogfantasy.com/v2/drafts/${draftId}`, {
      headers: {
        'Authorization': authToken,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) throw new Error('Failed to fetch draft data');
    
    const data = await response.json();
    draftData[draftId] = data;
    return data;
  } catch (error) {
    console.error('Error fetching draft data:', error);
    return null;
  }
}

async function fetchPlayers() {
  if (!authToken) return null;
  
  try {
    // Fetch picks endpoint for player data
    const response = await fetch('https://api.underdogfantasy.com/v1/picks', {
      headers: {
        'Authorization': authToken,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) throw new Error('Failed to fetch player data');
    
    const data = await response.json();
    
    // Map players by appearance_id
    playerData = {};
    if (data.players) {
      data.players.forEach(player => {
        playerData[player.id] = player;
      });
    }
    
    return playerData;
  } catch (error) {
    console.error('Error fetching player data:', error);
    return null;
  }
}