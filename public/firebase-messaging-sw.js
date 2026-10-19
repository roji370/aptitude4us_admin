// Firebase Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');
importScripts('/firebase-config.js'); // This will load the config from a public file

// Initialize Firebase using the config loaded from firebase-config.js
firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  // Get notification data
  const notificationType = payload.data?.type || 'general';
  const notificationTitle = payload.notification?.title || 'New Notification';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/vite.svg', // Using available icon
    badge: '/vite.svg',
    data: payload.data,
    tag: getNotificationTag(notificationType),
    renotify: true
  };

  // Get channel_id from the payload
  if (payload.android && payload.android.notification && payload.android.notification.channel_id) {
    console.log(`Using channel_id from payload: ${payload.android.notification.channel_id}`);
    // The channel_id is already set in the Android app
  } else if (notificationType === 'chat' || notificationType === 'community_chat') {
    // Default chat channel
    console.log(`Using default chat_channel for ${notificationType} messages`);
  }

  // Add vibration for chat messages, community messages, and past questions
  if (notificationType === 'chat' || notificationType === 'community_chat' || notificationType === 'past_questions') {
    notificationOptions.vibrate = [200, 100, 200];
  }

  // Special handling for community chat notifications
  if (notificationType === 'community_chat') {
    notificationOptions.icon = '/vite.svg'; // Could use a different icon for community
    notificationOptions.badge = '/vite.svg';
    // Set a specific action to open community chat when clicked
    notificationOptions.data = {
      ...notificationOptions.data,
      openCommunityChat: true
    };
  }

  // Special handling for past questions notifications
  if (notificationType === 'past_questions') {
    notificationOptions.icon = '/vite.svg';
    notificationOptions.badge = '/vite.svg';
    // Set a specific action to open past questions when clicked
    notificationOptions.data = {
      ...notificationOptions.data,
      openPastQuestions: true
    };
  }

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Helper function to get the appropriate notification tag based on type
function getNotificationTag(type) {
  switch (type) {
    case 'chat':
      return 'chat-notification';
    case 'community_chat':
      return 'community-chat-notification';
    case 'past_questions':
      return 'past-questions-notification';
    default:
      return 'general-notification';
  }
}

// Handle notification click
self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification click: ', event);
  
  // Close the notification
  event.notification.close();
  
  // Extract data from the notification
  const notificationType = event.notification.data?.type || 'general';
  const openCommunityChat = event.notification.data?.openCommunityChat || false;
  const openPastQuestions = event.notification.data?.openPastQuestions || false;
  
  // Create the URL to navigate to based on notification type
  let url = '/';
  
  if (notificationType === 'chat') {
    url = '/chat';
  } else if (notificationType === 'community_chat' || openCommunityChat) {
    url = '/chat?mode=community';
  } else if (notificationType === 'past_questions' || openPastQuestions) {
    url = '/chat?mode=pastQuestions';
  }
  
  // Open or focus the appropriate window/tab
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    })
    .then(function(clientList) {
      // If we have a client already open, focus it
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
}); 