// This runs in the page context to capture Pusher events
(function() {
  console.log('🏈 Draft Assistant: Injecting Pusher interceptor...');
  
  // Capture user ID from page
  const checkForUserId = setInterval(() => {
    // Try to find user ID from various sources
    const userIdElement = document.querySelector('[data-user-id]');
    const userScript = Array.from(document.scripts).find(s => 
      s.textContent.includes('user_id') || s.textContent.includes('userId')
    );
    
    if (window.UD_USER_ID || window.currentUserId) {
      window.postMessage({
        type: 'UNDERDOG_USER_ID',
        userId: window.UD_USER_ID || window.currentUserId
      }, '*');
      clearInterval(checkForUserId);
    }
  }, 100);
  
  // Intercept Pusher
  const originalPusher = window.Pusher;
  if (originalPusher) {
    window.Pusher = function(...args) {
      console.log('Pusher initialized with:', args);
      const pusherInstance = new originalPusher(...args);
      
      // Override subscribe to capture auth
      const originalSubscribe = pusherInstance.subscribe;
      pusherInstance.subscribe = function(channelName, options) {
        console.log('Subscribing to channel:', channelName);
        
        const channel = originalSubscribe.call(this, channelName, options);
        
        // Capture auth for private channels
        if (channelName.startsWith('private-') || channelName.startsWith('presence-')) {
          window.postMessage({
            type: 'PUSHER_AUTH',
            channel: channelName,
            auth: options?.auth
          }, '*');
        }
        
        // Override bind to capture events
        const originalBind = channel.bind;
        channel.bind = function(eventName, callback) {
          console.log('Binding to event:', eventName, 'on channel:', channelName);
          
          const wrappedCallback = function(data) {
            // Forward event to content script
            window.postMessage({
              type: 'PUSHER_EVENT',
              channel: channelName,
              event: eventName,
              data: data
            }, '*');
            
            // Call original callback
            return callback.call(this, data);
          };
          
          return originalBind.call(this, eventName, wrappedCallback);
        };
        
        return channel;
      };
      
      return pusherInstance;
    };
    
    // Copy prototype
    window.Pusher.prototype = originalPusher.prototype;
  }
})();