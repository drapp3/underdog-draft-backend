class UnderdogDraftAssistant {
  constructor() {
  // CHANGE THIS TO YOUR RAILWAY URL AFTER DEPLOYMENT
  this.API_BASE = 'http://localhost:5000'; // Will change to https://your-app.railway.app later
  this.draftId = null;
  this.draftData = null;
  this.playerData = null;
  this.myUserId = localStorage.getItem('uda_user_id') || this.generateUserId();
  this.myEntryId = null;
  this.myPosition = null;
  this.pusherClient = null;
  this.pusherAuth = null;
  
  this.init();
}
  generateUserId() {
  const id = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('uda_user_id', id);
  return id;
}

async recordPick(pick) {
  if (pick.draft_entry_id !== this.myEntryId) return; // Only record YOUR picks
  
  try {
    await fetch(`${this.API_BASE}/api/draft-pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft_id: this.draftId,
        user_id: this.myUserId,
        player_appearance_id: pick.appearance_id,
        pick_number: pick.number
      })
    });
  } catch (error) {
    console.error('Failed to record pick:', error);
  }
}

async getRecommendations() {
  const draftedIds = this.draftData?.picks?.map(p => p.appearance_id) || [];
  const myTeam = this.draftData?.picks
    ?.filter(p => p.draft_entry_id === this.myEntryId)
    ?.map(p => this.playerData[p.appearance_id])
    ?.filter(Boolean) || [];
  
  try {
    const response = await fetch(`${this.API_BASE}/api/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drafted_ids: draftedIds,
        user_id: this.myUserId,
        my_team: myTeam
      })
    });
    
    return await response.json();
  } catch (error) {
    console.error('Failed to get recommendations:', error);
    return [];
  }
}
  async init() {
    console.log('🏈 Underdog Draft Assistant Pro - Initializing...');
    
    // Get draft ID from URL
    this.draftId = this.getDraftIdFromUrl();
    if (!this.draftId) {
      console.log('Not on a draft page');
      return;
    }
    
    console.log('Draft ID:', this.draftId);
    
    // Inject script to capture Pusher auth
    this.injectScript();
    
    // Wait for page to load
    await this.waitForPageLoad();
    
    // Load draft and player data
    await this.loadDraftData();
    await this.loadPlayerData();
    
    // Create UI
    this.createSidebar();
    
    // Start monitoring
    this.setupPusherListener();
    
    console.log('✅ Draft Assistant initialized!');
  }
  
  getDraftIdFromUrl() {
    const match = window.location.pathname.match(/\/(draft|active)\/([a-f0-9-]+)/);
    return match ? match[2] : null;
  }
  
  injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }
  
  async waitForPageLoad() {
    return new Promise(resolve => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', resolve);
      }
    });
  }
  
  async loadDraftData() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'GET_DRAFT_DATA', draftId: this.draftId },
        (response) => {
          if (response && response.draft) {
            this.draftData = response.draft;
            this.findMyEntry();
            console.log('Draft data loaded:', this.draftData);
          }
          resolve();
        }
      );
    });
  }
  
  async loadPlayerData() {
    try {
        const response = await fetch(`${this.API_BASE}/api/players`);
        const players = await response.json();
        
        this.playerData = {};
        players.forEach(player => {
        this.playerData[player.appearance_id] = player;
        });
        
        console.log('Loaded', Object.keys(this.playerData).length, 'players from API');
    } catch (error) {
        console.error('Failed to load players:', error);
        this.playerData = {};
    }
    }
  
  findMyEntry() {
    // Get user ID from auth token or page
    // For now, we'll look for the user's entry by matching with page data
    window.addEventListener('message', (event) => {
      if (event.data.type === 'UNDERDOG_USER_ID') {
        this.myUserId = event.data.userId;
        
        const myEntry = this.draftData.draft_entries.find(
          entry => entry.user_id === this.myUserId
        );
        
        if (myEntry) {
          this.myEntryId = myEntry.id;
          this.myPosition = myEntry.pick_order;
          console.log(`You are pick #${this.myPosition}`);
        }
      }
    });
  }
  
  setupPusherListener() {
    // Listen for Pusher events from injected script
    window.addEventListener('message', (event) => {
      if (event.data.type === 'PUSHER_AUTH') {
        this.pusherAuth = event.data.auth;
      }
      
      if (event.data.type === 'PUSHER_EVENT' && event.data.event === 'pick_made') {
        this.handleNewPick(event.data.data);
      }
    });
  }
  
  handleNewPick(pickData) {
    console.log('New pick:', pickData);
    
    // Update draft data
    if (this.draftData && pickData.pick) {
        this.draftData.picks.push(pickData.pick);
        
        // Record pick for exposure tracking
        this.recordPick(pickData.pick);
    }
    
    // Update UI
    this.updateSidebar();
    this.showNotification(pickData);
    }
  
  createSidebar() {
    // Remove existing sidebar
    const existing = document.getElementById('uda-sidebar');
    if (existing) existing.remove();
    
    const sidebar = document.createElement('div');
    sidebar.id = 'uda-sidebar';
    sidebar.innerHTML = `
      <div class="uda-header">
        <h3>🏈 Draft Assistant Pro</h3>
        <div class="uda-info">
          <span>Pick ${this.myPosition || '?'}/12</span>
          <span>•</span>
          <span id="uda-pick-count">Pick ${this.draftData?.picks?.length || 0}</span>
        </div>
      </div>
      
      <div class="uda-tabs">
        <button class="uda-tab active" data-tab="available">Available</button>
        <button class="uda-tab" data-tab="picks">All Picks</button>
        <button class="uda-tab" data-tab="team">My Team</button>
      </div>
      
      <div class="uda-content">
        <div id="uda-available" class="uda-panel active">
          <div class="uda-search">
            <input type="text" id="uda-search" placeholder="Search players...">
          </div>
          <div id="uda-player-list"></div>
        </div>
        
        <div id="uda-picks" class="uda-panel">
          <div id="uda-picks-list"></div>
        </div>
        
        <div id="uda-team" class="uda-panel">
          <div id="uda-team-list"></div>
        </div>
      </div>
    `;
    
    document.body.appendChild(sidebar);
    
    // Setup event listeners
    this.setupSidebarEvents();
    
    // Initial update
    this.updateSidebar();
  }
  
  setupSidebarEvents() {
    // Tab switching
    document.querySelectorAll('.uda-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.uda-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.uda-panel').forEach(p => p.classList.remove('active'));
        
        e.target.classList.add('active');
        const panelId = `uda-${e.target.dataset.tab}`;
        document.getElementById(panelId).classList.add('active');
      });
    });
    
    // Search
    document.getElementById('uda-search').addEventListener('input', (e) => {
      this.filterPlayers(e.target.value);
    });
  }
  
  updateSidebar() {
    // Update pick count
    const pickCount = this.draftData?.picks?.length || 0;
    document.getElementById('uda-pick-count').textContent = `Pick ${pickCount}`;
    
    // Update available players
    this.updateAvailablePlayers();
    
    // Update picks list
    this.updatePicksList();
    
    // Update my team
    this.updateMyTeam();
  }
  
  updateAvailablePlayers() {
    const container = document.getElementById('uda-player-list');
    if (!container || !this.playerData) return;
    
    // Get drafted player IDs
    const draftedIds = new Set(
        this.draftData?.picks?.map(p => p.appearance_id) || []
    );
    
    // Filter available players
    const available = Object.values(this.playerData)
        .filter(player => !draftedIds.has(player.appearance_id))
        .sort((a, b) => (a.rank || 999) - (b.rank || 999))
        .slice(0, 50);
    
    container.innerHTML = available.map(player => `
        <div class="uda-player" data-id="${player.appearance_id}">
        <span class="uda-rank">${player.rank}</span>
        <span class="uda-name">${player.name}</span>
        <span class="uda-pos">${player.position}</span>
        <span class="uda-team">${player.team}</span>
        <span class="uda-proj">${player.projection.toFixed(1)}</span>
        <button class="uda-queue-btn" data-name="${player.name}">
            Queue
        </button>
        </div>
    `).join('');
    
    // Add queue button listeners
    container.querySelectorAll('.uda-queue-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
        this.queuePlayer(e.target.dataset.name);
        });
    });
    }
  
  updatePicksList() {
    const container = document.getElementById('uda-picks-list');
    if (!container || !this.draftData) return;
    
    const picks = [...(this.draftData.picks || [])]
        .sort((a, b) => a.number - b.number);
    
    container.innerHTML = picks.map(pick => {
        const player = this.playerData?.[pick.appearance_id];
        const entry = this.draftData.draft_entries.find(e => e.id === pick.draft_entry_id);
        
        return `
        <div class="uda-pick">
            <span class="uda-pick-num">${pick.number}</span>
            <span class="uda-pick-team">Team ${entry?.pick_order || '?'}</span>
            <span class="uda-pick-player">
            ${player ? player.name : 'Unknown'}
            </span>
        </div>
        `;
    }).join('');
    }
  
  updateMyTeam() {
    const container = document.getElementById('uda-team-list');
    if (!container || !this.myEntryId) return;
    
    const myPicks = this.draftData?.picks?.filter(
      pick => pick.draft_entry_id === this.myEntryId
    ) || [];
    
    container.innerHTML = myPicks.map(pick => {
      const player = this.playerData?.[pick.appearance_id];
      return `
        <div class="uda-team-player">
          <span class="uda-pick-round">R${Math.ceil(pick.number / 12)}</span>
          <span class="uda-player-info">
            ${player ? `${player.first_name} ${player.last_name} (${player.position})` : 'Unknown'}
          </span>
        </div>
      `;
    }).join('');
    
    if (myPicks.length === 0) {
      container.innerHTML = '<div class="uda-empty">No picks yet</div>';
    }
  }
  
  queuePlayer(playerName) {
    // Find search input on page and fill it
    const searchInputs = document.querySelectorAll('input[type="text"], input[type="search"]');
    searchInputs.forEach(input => {
      if (input.placeholder?.toLowerCase().includes('search')) {
        input.value = playerName;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
    });
    
    this.showNotification({ message: `Queued: ${playerName}` });
  }
  
  filterPlayers(searchTerm) {
    const players = document.querySelectorAll('.uda-player');
    const term = searchTerm.toLowerCase();
    
    players.forEach(player => {
      const name = player.querySelector('.uda-name').textContent.toLowerCase();
      player.style.display = name.includes(term) ? 'flex' : 'none';
    });
  }
  
  showNotification(data) {
    const notification = document.createElement('div');
    notification.className = 'uda-notification';
    notification.textContent = data.message || `Pick #${data.pick?.number}: ${data.pick?.appearance_id}`;
    
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 3000);
  }
}

// Initialize
new UnderdogDraftAssistant();