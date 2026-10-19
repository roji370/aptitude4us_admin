const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const fetch = require('node-fetch');

// Send push notification when a new message is created
// Updated: Added CPU limits and appType filter for iOS notifications
exports.sendChatNotification = onDocumentCreated({
  document: "messages/{messageId}",
  cpu: 0.5,
  memory: "256MiB"
}, async (event) => {
  try {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the event");
      return null;
    }

    const messageData = snapshot.data();
    const { text, senderId, senderName, receiverId, isGroup, isBroadcast } = messageData;

    // Create payload with BOTH notification and data fields for iOS compatibility
    const payload = {
      notification: {
        title: `New message from ${senderName || 'Someone'}`,
        body: text && text.length > 100 ? `${text.substring(0, 97)}...` : (text || 'New message')
      },
      data: {
        type: "chat",
        messageId: event.params.messageId,
        senderId: senderId || "",
        senderName: senderName || "",
        click_action: "FLUTTER_NOTIFICATION_CLICK"
      },
      android: {
        priority: "high",
        notification: {
          channel_id: "chat_channel"
        }
      },
      apns: {
        headers: {
          "apns-priority": "10"
        },
        payload: {
          aps: {
            badge: 1,
            sound: "default",
            category: "CHAT_MESSAGE"
          }
        }
      }
    };

    // Log the payload for debugging
    console.log("Sending chat notification with payload:", JSON.stringify(payload));

    // Determine how to send the notification
    if (receiverId) {
      console.log(`Processing message with receiverId: ${JSON.stringify(receiverId)}`);

      // Handle different recipient formats
      if (receiverId === 'ADMIN') {
        // Get admin users to send to each one individually
        try {
          console.log('Finding admin users to send notifications to');
          const adminUsersSnapshot = await admin.firestore()
            .collection('users')
            .where('role', '==', 'admin')
            .get();

          if (adminUsersSnapshot.empty) {
            console.log('No admin users found');
            return null;
          }

          // Send to each admin
          for (const adminDoc of adminUsersSnapshot.docs) {
            const adminId = adminDoc.id;
            console.log(`Sending notification to admin: ${adminId}`);

            try {
              // Get admin FCM tokens (with appType filter for admin app)
              const adminTokensSnapshot = await admin.firestore()
                .collection('user_tokens')
                .where('userId', '==', adminId)
                .where('isActive', '==', true)
                .where('appType', '==', 'admin')
                .get();

              if (adminTokensSnapshot.empty) {
                console.log(`No FCM tokens found for admin ${adminId}`);
                continue;
              }

              // Get the first token
              const tokenDoc = adminTokensSnapshot.docs[0];
              const token = tokenDoc.data().token;

              // Send to the token using the Admin SDK with full payload
              await admin.messaging().send({
                token: token,
                ...payload
              });
              console.log(`Successfully sent notification to admin ${adminId}`);
            } catch (err) {
              console.error(`Error sending to admin ${adminId}:`, err.message);
            }
          }

          // Also send to admin topic as backup
          await admin.messaging().send({
            topic: "admin_chat",
            ...payload
          });
          console.log('Successfully sent notification to admin_chat topic');
        } catch (err) {
          console.error('Error processing admin messages:', err.message);
        }
        return null;
      }

      // Handle broadcast messages to ALL students
      else if (receiverId === 'ALL' || isBroadcast === true) {
        console.log('\n=== Broadcast Chat Message Debug ===');
        console.log(`Sender: ${senderName}`);
        console.log(`Message: ${text ? text.substring(0, 50) : 'N/A'}...`);

        try {
          // Send ONLY to individual student tokens to avoid duplicate notifications
          // (Previously sent to topics AND individual tokens, causing duplicates)
          console.log('Querying for all student users...');
          const studentUsersSnapshot = await admin.firestore()
            .collection('users')
            .where('role', '==', 'student')
            .get();

          if (studentUsersSnapshot.empty) {
            console.log('❌ No student users found');
            console.log('=== End Broadcast Chat Message Debug ===\n');
            return null;
          }

          console.log(`Found ${studentUsersSnapshot.size} student users`);

          // Collect all student tokens with platform deduplication
          console.log('Collecting student tokens...');
          const platformTokensMap = new Map(); // userId -> { platform -> token }
          const tokenPromises = [];

          for (const studentDoc of studentUsersSnapshot.docs) {
            const studentId = studentDoc.id;
            tokenPromises.push(
              admin.firestore()
                .collection('user_tokens')
                .where('userId', '==', studentId)
                .where('isActive', '==', true)
                .where('appType', '==', 'student')
                .get()
                .then(snapshot => {
                  if (!snapshot.empty) {
                    const userPlatforms = {};
                    snapshot.forEach(doc => {
                      const tokenData = doc.data();
                      const platform = tokenData.platform || 'unknown';
                      const lastUsed = tokenData.lastUsed?.toDate?.() || tokenData.createdAt?.toDate?.() || new Date(0);

                      // Keep only the most recent token per platform per user
                      if (!userPlatforms[platform] || lastUsed > userPlatforms[platform].lastUsed) {
                        userPlatforms[platform] = {
                          token: tokenData.token,
                          lastUsed: lastUsed
                        };
                      }
                    });

                    // Add deduplicated tokens to map
                    Object.entries(userPlatforms).forEach(([platform, data]) => {
                      const key = `${studentId}_${platform}`;
                      platformTokensMap.set(key, data.token);
                    });
                  }
                })
                .catch(err => {
                  console.error(`Error getting tokens for student ${studentId}:`, err.message);
                })
            );
          }

          // Wait for all token queries to complete
          await Promise.all(tokenPromises);

          const allTokens = Array.from(platformTokensMap.values());
          console.log(`Collected ${allTokens.length} deduplicated student tokens`);

          // Send to all tokens with error tracking
          if (allTokens.length > 0) {
            let successCount = 0;
            let failCount = 0;
            let iosCount = 0;
            let androidCount = 0;

            // Send in batches of 10 to avoid overwhelming the function
            const batchSize = 10;
            for (let i = 0; i < allTokens.length; i += batchSize) {
              const batch = allTokens.slice(i, i + batchSize);
              const batchPromises = batch.map(async token => {
                try {
                  await admin.messaging().send({
                    token: token,
                    ...payload
                  });
                  successCount++;
                  // Track platform if token indicates it (rough estimate)
                  if (token.includes('iOS') || token.includes('APNS')) {
                    iosCount++;
                  } else {
                    androidCount++;
                  }
                } catch (err) {
                  failCount++;
                  console.error(`Error sending to token ${token.substring(0, 10)}...:`, err.message);

                  if (err.code === 'messaging/third-party-auth-error') {
                    console.error(`   ⚠️ APNS authentication error for token ${token.substring(0, 10)}...`);
                  }
                }
              });

              await Promise.all(batchPromises);
              console.log(`Sent batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allTokens.length / batchSize)}`);
            }

            console.log(`\n📊 Broadcast Send Summary:`);
            console.log(`   Total tokens: ${allTokens.length}`);
            console.log(`   ✅ Successful: ${successCount}`);
            console.log(`   ❌ Failed: ${failCount}`);
          }

          console.log('=== End Broadcast Chat Message Debug ===\n');
        } catch (err) {
          console.error('Error processing broadcast messages:', err.message);
          console.error(err);
        }
        return null;
      }

      // Handle group messages (array of recipients)
      if (isGroup && Array.isArray(receiverId)) {
        console.log(`\n=== Group Chat Message Debug ===`);
        console.log(`Sender: ${senderName}`);
        console.log(`Recipients: ${receiverId.length}`);
        console.log(`Message: ${text ? text.substring(0, 50) : 'N/A'}...`);

        // Process each recipient
        for (const recipId of receiverId) {
          try {
            console.log(`\nProcessing recipient: ${recipId}`);

            // Query the user_tokens collection for this user's tokens
            const userTokensSnapshot = await admin.firestore()
              .collection('user_tokens')
              .where('userId', '==', recipId)
              .where('isActive', '==', true)
              .where('appType', '==', 'student')
              .get();

            if (userTokensSnapshot.empty) {
              console.log(`  ❌ No FCM tokens found for user ${recipId}`);
              continue;
            }

            console.log(`  Found ${userTokensSnapshot.size} tokens`);

            // Deduplicate by platform
            const platformTokens = {};
            userTokensSnapshot.forEach(doc => {
              const tokenData = doc.data();
              const platform = tokenData.platform || 'unknown';
              const lastUsed = tokenData.lastUsed?.toDate?.() || tokenData.createdAt?.toDate?.() || new Date(0);

              if (!platformTokens[platform] || lastUsed > platformTokens[platform].lastUsed) {
                platformTokens[platform] = {
                  token: tokenData.token,
                  lastUsed: lastUsed
                };
              }
            });

            // Send to each platform
            for (const [platform, tokenData] of Object.entries(platformTokens)) {
              const token = tokenData.token;

              try {
                await admin.messaging().send({
                  token: token,
                  ...payload
                });
                console.log(`  ✅ Sent to ${platform}: ${token.substring(0, 20)}...`);
              } catch (err) {
                console.error(`  ❌ Failed to send to ${platform}:`, err.message);

                // Check if the token is invalid
                if (err.code === 'messaging/invalid-registration-token' ||
                  err.code === 'messaging/registration-token-not-registered') {
                  try {
                    const tokenDocs = await admin.firestore()
                      .collection('user_tokens')
                      .where('token', '==', token)
                      .get();

                    for (const doc of tokenDocs.docs) {
                      await doc.ref.update({
                        isActive: false,
                        deletedAt: admin.firestore.FieldValue.serverTimestamp()
                      });
                    }
                    console.log(`  ✓ Marked token as inactive`);
                  } catch (updateErr) {
                    console.error(`  ✗ Error updating token status:`, updateErr.message);
                  }
                } else if (err.code === 'messaging/third-party-auth-error') {
                  console.error(`  ⚠️ APNS authentication error`);
                }
              }
            }
          } catch (err) {
            console.error(`Error processing user ${recipId}:`, err.message);
          }
        }
        console.log(`\n=== End Group Chat Message Debug ===\n`);
      }
      // Handle direct messages (single recipient string)
      else if (typeof receiverId === 'string' && receiverId !== 'ADMIN') {
        // This is a direct message to a specific user
        try {
          console.log(`\n=== Direct Chat Message Debug ===`);
          console.log(`Receiver ID: ${receiverId}`);
          console.log(`Sender: ${senderName}`);
          console.log(`Message: ${text ? text.substring(0, 50) : 'N/A'}...`);

          // Query the user_tokens collection for this user's tokens
          const userTokensSnapshot = await admin.firestore()
            .collection('user_tokens')
            .where('userId', '==', receiverId)
            .where('isActive', '==', true)
            .where('appType', '==', 'student')
            .get();

          console.log(`Found ${userTokensSnapshot.size} student tokens`);

          if (userTokensSnapshot.empty) {
            console.log(`❌ No FCM tokens found for user ${receiverId}`);
            console.log(`=== End Direct Chat Message Debug ===\n`);
            return null;
          }

          // Log token details
          console.log(`\nToken Details:`);
          userTokensSnapshot.forEach((doc, index) => {
            const tokenData = doc.data();
            console.log(`  Token ${index + 1}:`);
            console.log(`    - Platform: ${tokenData.platform || 'unknown'}`);
            console.log(`    - Token: ${tokenData.token ? tokenData.token.substring(0, 40) + '...' : 'MISSING'}`);
            console.log(`    - appType: ${tokenData.appType || 'MISSING'}`);
          });

          // Deduplicate tokens by platform (one notification per device type)
          const platformTokens = {};
          userTokensSnapshot.forEach(doc => {
            const tokenData = doc.data();
            const platform = tokenData.platform || 'unknown';
            const lastUsed = tokenData.lastUsed?.toDate?.() || tokenData.createdAt?.toDate?.() || new Date(0);

            if (!platformTokens[platform] || lastUsed > platformTokens[platform].lastUsed) {
              platformTokens[platform] = {
                token: tokenData.token,
                lastUsed: lastUsed
              };
            }
          });

          console.log(`\nDeduplicated tokens by platform:`);
          Object.keys(platformTokens).forEach(platform => {
            console.log(`  - ${platform}: ${platformTokens[platform].token.substring(0, 40)}...`);
          });

          // Send to each platform
          const sendResults = [];
          for (const [platform, tokenData] of Object.entries(platformTokens)) {
            const token = tokenData.token;

            try {
              console.log(`\n📤 Sending to ${platform} token: ${token.substring(0, 40)}...`);

              const response = await admin.messaging().send({
                token: token,
                ...payload
              });

              console.log(`✅ ${platform} chat notification sent successfully:`, {
                messageId: response,
                platform: platform
              });

              sendResults.push({ platform, success: true, response });
            } catch (err) {
              console.error(`\n❌ ${platform} chat notification FAILED:`, {
                platform: platform,
                error: err.message,
                code: err.code,
                tokenPreview: token.substring(0, 40) + '...'
              });

              // Check if the token is invalid
              if (err.code === 'messaging/invalid-registration-token' ||
                err.code === 'messaging/registration-token-not-registered') {
                console.error(`   ⚠️ Token is invalid/expired - marking as inactive`);
                try {
                  // Find the token document and mark as inactive
                  const tokenDocs = await admin.firestore()
                    .collection('user_tokens')
                    .where('token', '==', token)
                    .get();

                  for (const doc of tokenDocs.docs) {
                    await doc.ref.update({
                      isActive: false,
                      deletedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                  }
                  console.log(`   ✓ Marked token as inactive`);
                } catch (updateErr) {
                  console.error(`   ✗ Error updating token status:`, updateErr.message);
                }
              } else if (err.code === 'messaging/third-party-auth-error') {
                console.error(`   ⚠️ APNS authentication error - check Firebase APNS configuration`);
              }

              sendResults.push({ platform, success: false, error: err.message, code: err.code });
            }
          }

          const successCount = sendResults.filter(r => r.success).length;
          const failCount = sendResults.filter(r => !r.success).length;

          console.log(`\n📊 Direct Chat Send Summary:`);
          console.log(`   Total platforms: ${sendResults.length}`);
          console.log(`   ✅ Successful: ${successCount}`);
          console.log(`   ❌ Failed: ${failCount}`);

          if (failCount > 0) {
            console.log(`\n   Failed platforms:`);
            sendResults.filter(r => !r.success).forEach(result => {
              console.log(`     - ${result.platform}: ${result.error} (${result.code})`);
            });
          }

          console.log(`=== End Direct Chat Message Debug ===\n`);
        } catch (err) {
          console.error(`Error processing direct message to user ${receiverId}:`, err.message);
          console.error(err);
        }
      }
    } else {
      console.error('Message has no receiverId - cannot deliver notification');
    }

    return null;
  } catch (error) {
    console.error("Error sending chat notification:", error.message);
    return null;
  }
});

// Send push notification when a new notification is created
exports.sendPushNotification = onDocumentCreated({
  document: "notifications/{notificationId}",
  cpu: 0.5,
  memory: "256MiB"
}, async (event) => {
  try {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the event");
      return null;
    }

    const notificationData = snapshot.data();
    const { title, body, type, recipients, sender, courseId, link, timestamp } = notificationData;

    // Skip content update types — FCM is sent directly by contentUpdates.js via sendFcmToUsers()
    // to avoid double push notifications. The notification doc is kept for in-app display only.
    if (type === 'content_update' || type === 'content_item_update') {
      console.log(`Skipping FCM for ${type} notification ${event.params.notificationId} — handled by contentUpdates.js`);
      return null;
    }

    // Create payload structure matching what the student app expects
    const payload = {
      notification: {
        title: title || 'Notification',
        body: body && body.length > 100 ? `${body.substring(0, 97)}...` : (body || '')
      },
      data: {
        type: type || "notification",
        notificationId: event.params.notificationId,
        senderId: sender || "",
        courseId: courseId || "",
        link: link || "",
        click_action: "FLUTTER_NOTIFICATION_CLICK"
      },
      android: {
        priority: "high",
        ttl: 86400000, // 24 hour availability
        notification: {
          channel_id: type === "chat" ? "chat_channel" : "general_channel" // Match the student app's channel IDs
        }
      },
      apns: {
        headers: {
          "apns-priority": "10"
        },
        payload: {
          aps: {
            badge: 1,
            sound: "default"
          }
        }
      }
    };

    // Log the payload for debugging
    console.log("Sending push notification with payload:", JSON.stringify(payload));

    // Determine how to send the notification
    if (recipients && recipients.length > 0) {
      console.log(`Sending targeted notification to ${recipients.length} recipients`);

      // Process each recipient
      const sendPromises = recipients.map(async recipientId => {
        console.log(`\n=== sendPushNotification Debug ===`);
        console.log(`Getting FCM tokens for user ${recipientId}`);
        console.log(`Notification type: ${type || 'unknown'}`);
        console.log(`Notification ID: ${event.params.notificationId}`);

        try {
          // Query the user_tokens collection for this user's tokens
          const userTokensSnapshot = await admin.firestore()
            .collection('user_tokens')
            .where('userId', '==', recipientId)
            .where('isActive', '==', true)
            .where('appType', '==', 'student')
            .get();

          console.log(`Found ${userTokensSnapshot.size} student tokens for user ${recipientId}`);

          if (userTokensSnapshot.size > 0) {
            console.log(`Token details:`);
            userTokensSnapshot.forEach((doc, index) => {
              const tokenData = doc.data();
              console.log(`  Token ${index + 1}:`);
              console.log(`    - Platform: ${tokenData.platform || 'unknown'}`);
              console.log(`    - Token: ${tokenData.token ? tokenData.token.substring(0, 40) + '...' : 'MISSING'}`);
              console.log(`    - appType: ${tokenData.appType || 'MISSING'}`);
            });
          } else {
            console.log(`❌ NO TOKENS FOUND for user ${recipientId}`);
            console.log(`   Query filters: userId=${recipientId}, isActive=true, appType=student`);
          }

          if (userTokensSnapshot.empty) {
            console.log(`No FCM tokens found for user ${recipientId}, sending to topic instead`);
            return admin.messaging().send({
              topic: `user_${recipientId}`,
              ...payload
            });
          }

          // Get all tokens for this user
          const tokens = [];
          userTokensSnapshot.forEach(doc => {
            tokens.push(doc.data().token);
          });

          console.log(`Sending to ${tokens.length} tokens for user ${recipientId}`);

          if (tokens.length === 0) {
            console.log(`No active tokens for user ${recipientId}`);
            return null;
          } else if (tokens.length === 1) {
            // If only one token, use simple send
            console.log(`Sending to single token: ${tokens[0].substring(0, 40)}...`);
            try {
              const response = await admin.messaging().send({
                token: tokens[0],
                ...payload
              });
              console.log(`✅ Notification sent successfully:`, response);
              return response;
            } catch (sendError) {
              console.error(`❌ Failed to send notification:`, {
                error: sendError.message,
                code: sendError.code,
                tokenPreview: tokens[0].substring(0, 40) + '...'
              });
              throw sendError;
            }
          } else {
            // If multiple tokens, use sendEachForMulticast (sendMulticast deprecated in admin v12+)
            console.log(`Sending to ${tokens.length} tokens using sendEachForMulticast`);
            try {
              const response = await admin.messaging().sendEachForMulticast({
                tokens,
                ...payload
              });
              console.log(`✅ Multicast result:`, {
                successCount: response.successCount,
                failureCount: response.failureCount,
                totalTokens: tokens.length
              });
              if (response.failureCount > 0) {
                console.error(`❌ ${response.failureCount} tokens failed:`);
                response.responses.forEach((resp, index) => {
                  if (!resp.success) {
                    console.error(`  - Token ${index + 1}: ${resp.error?.message || 'Unknown error'}`);
                  }
                });
              }
              return response;
            } catch (sendError) {
              console.error(`❌ sendEachForMulticast failed:`, {
                error: sendError.message,
                code: sendError.code
              });
              throw sendError;
            }
          }
        } catch (err) {
          console.error(`❌ Error sending to user ${recipientId}:`, {
            error: err.message,
            code: err.code,
            stack: err.stack
          });
          // Fallback to topic if token retrieval fails
          console.log(`Falling back to topic: user_${recipientId}`);
          return admin.messaging().send({
            topic: `user_${recipientId}`,
            ...payload
          });
        }
      });

      await Promise.all(sendPromises);
      console.log(`Successfully sent targeted notifications to ${recipients.length} recipients`);
    } else {
      // Broadcast: send to global notifications topic
      console.log('Sending broadcast notification');
      await admin.messaging().send({
        topic: "notifications",
        ...payload
      });
      console.log('Successfully sent broadcast notification');
    }

    return null;
  } catch (error) {
    console.error("Error sending notification:", error);
    console.error("Error details:", error.message, error.stack);
    return null;
  }
});

// Mark notification as read
// Updated: Added CPU limits to reduce quota usage
exports.markNotificationRead = onCall({
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  // Check if user is authenticated
  if (!request.auth) {
    throw new Error(
      "unauthenticated - You must be logged in to mark notifications as read"
    );
  }

  const { notificationId } = request.data;

  if (!notificationId) {
    throw new Error(
      "invalid-argument - Notification ID is required"
    );
  }

  try {
    await admin.firestore()
      .collection("notifications")
      .doc(notificationId)
      .update({
        read: true,
        readTimestamp: admin.firestore.FieldValue.serverTimestamp()
      });

    return { success: true };
  } catch (error) {
    console.error("Error marking notification as read:", error);
    throw new Error(
      "internal - Failed to mark notification as read"
    );
  }
});

// Send course assignment notification
exports.sendCourseAssignmentNotification = async (courseData, assignedUserIds, assignedByAdminId) => {
  try {
    console.log(`Sending course assignment notifications for course ${courseData.id} to ${assignedUserIds.length} users`);

    const notificationResults = [];
    const errors = [];

    // Get admin info for notification
    let adminName = 'Admin';
    try {
      const adminDoc = await admin.firestore().collection('users').doc(assignedByAdminId).get();
      if (adminDoc.exists) {
        adminName = adminDoc.data().displayName || 'Admin';
      }
    } catch (error) {
      console.warn('Could not fetch admin name:', error.message);
    }

    // Send notifications to each assigned user
    // NOTE: The payload is created by sendPushNotification trigger based on notificationData
    for (const userId of assignedUserIds) {
      try {
        console.log(`Processing course assignment notification for user ${userId}`);

        // Create in-app notification record
        const notificationData = {
          title: "New Course Assigned",
          body: `You have been assigned to "${courseData.title}"`,
          type: "course_assignment",
          sender: assignedByAdminId,
          recipients: [userId],
          courseId: courseData.id,
          link: `/course/${courseData.id}`,
          targetApp: "student",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          read: false,
          metadata: {
            courseTitle: courseData.title,
            assignedBy: adminName,
            assignmentDate: new Date().toISOString()
          }
        };

        // Save notification to Firestore (this will trigger sendPushNotification)
        // NOTE: We rely on the sendPushNotification trigger to send the push notification
        // to avoid duplicate notifications. The trigger will handle token querying and sending.
        const notificationRef = await admin.firestore()
          .collection('notifications')
          .add(notificationData);

        console.log(`Created notification record ${notificationRef.id} for user ${userId}`);
        console.log(`Push notification will be sent via sendPushNotification trigger`);

        notificationResults.push({
          userId,
          notificationId: notificationRef.id,
          status: 'success',
          pushNotificationHandledBy: 'sendPushNotification_trigger'
        });

      } catch (error) {
        console.error(`Failed to send notification to user ${userId}:`, error.message);
        errors.push({
          userId,
          error: error.message
        });
      }
    }

    // Log summary
    console.log(`Course assignment notification summary: ${notificationResults.length} successful, ${errors.length} failed`);

    return {
      success: true,
      results: notificationResults,
      errors,
      summary: {
        totalUsers: assignedUserIds.length,
        successful: notificationResults.length,
        failed: errors.length
      }
    };

  } catch (error) {
    console.error('Error in sendCourseAssignmentNotification:', error);
    throw error;
  }
};

// Send consolidated course assignment notification for multiple courses
exports.sendConsolidatedCourseAssignmentNotification = async (courseDataArray, assignedUserIds, assignedByAdminId) => {
  try {
    console.log(`Sending consolidated course assignment notifications for ${courseDataArray.length} courses to ${assignedUserIds.length} users`);

    const notificationResults = [];
    const errors = [];

    // Get admin info for notification
    let adminName = 'Admin';
    try {
      const adminDoc = await admin.firestore().collection('users').doc(assignedByAdminId).get();
      if (adminDoc.exists) {
        const adminData = adminDoc.data();
        adminName = adminData.displayName || adminData.email || 'Admin';
      }
    } catch (adminError) {
      console.warn('Could not fetch admin details:', adminError.message);
    }

    // Create consolidated notification message
    const courseCount = courseDataArray.length;
    let title, body;

    if (courseCount === 1) {
      title = 'New Course Assigned';
      body = `You have been assigned to "${courseDataArray[0].title}" by ${adminName}`;
    } else {
      title = 'New Courses Assigned';
      body = `You have been assigned to ${courseCount} new courses by ${adminName}`;
    }

    // Process each user
    for (const userId of assignedUserIds) {
      try {
        console.log(`Sending consolidated notification to user ${userId}`);

        // Get user's FCM tokens from flat collection
        const tokensSnapshot = await admin.firestore()
          .collection('user_tokens')
          .where('userId', '==', userId)
          .where('isActive', '==', true)
          .where('appType', '==', 'student')
          .get();

        if (tokensSnapshot.empty) {
          console.log(`No active FCM tokens found for user ${userId}`);
          notificationResults.push({
            userId,
            success: false,
            message: 'No active FCM tokens found'
          });
          continue;
        }

        // Create deep link - for multiple courses, link to course list or first course
        const deepLink = courseCount === 1 ? `/course/${courseDataArray[0].id}` : '/courses';

        // Create notification payload
        const notificationPayload = {
          notification: {
            title,
            body
          },
          data: {
            type: 'consolidated_course_assignment',
            courseCount: courseCount.toString(),
            courseIds: JSON.stringify(courseDataArray.map(c => c.id)),
            courseTitles: JSON.stringify(courseDataArray.map(c => c.title)),
            assignedBy: adminName,
            assignedAt: new Date().toISOString(),
            deepLink: deepLink
          }
        };

        // Add course-specific data for single course
        if (courseCount === 1) {
          notificationPayload.data.courseId = courseDataArray[0].id;
          notificationPayload.data.courseName = courseDataArray[0].title;
        }

        // Send to user's devices (deduplicate and limit to recent tokens)
        const tokenDocs = tokensSnapshot.docs;

        // Group tokens by platform and get the most recent one for each platform
        const platformTokens = {};
        tokenDocs.forEach(doc => {
          const tokenData = doc.data();
          const platform = tokenData.platform || 'unknown';
          const lastUsed = tokenData.lastUsed?.toDate?.() || tokenData.createdAt?.toDate?.() || new Date(0);

          if (!platformTokens[platform] || lastUsed > platformTokens[platform].lastUsed) {
            platformTokens[platform] = {
              token: tokenData.token,
              lastUsed: lastUsed
            };
          }
        });

        // Extract tokens from the platform groups (max 1 per platform)
        const tokens = Object.values(platformTokens).map(p => p.token);
        console.log(`Sending to ${tokens.length} deduplicated tokens (from ${tokenDocs.length} total tokens)`);

        const sendPromises = tokens.map(token =>
          admin.messaging().send({
            ...notificationPayload,
            token
          }).catch(error => ({
            token,
            error: error.message
          }))
        );

        const sendResults = await Promise.all(sendPromises);

        // Process results
        let successCount = 0;
        let tokenErrors = [];

        sendResults.forEach((result, index) => {
          if (result.error) {
            tokenErrors.push({
              token: tokens[index],
              error: result.error
            });
          } else {
            successCount++;
          }
        });

        // Create in-app notification for each course
        for (const courseData of courseDataArray) {
          const inAppNotification = {
            id: `course_assignment_${courseData.id}_${userId}_${Date.now()}`,
            userId: userId,
            type: 'course_assignment',
            title: `New Course: ${courseData.title}`,
            body: `You have been assigned to "${courseData.title}" by ${adminName}`,
            recipients: [userId],
            sender: assignedByAdminId,
            courseId: courseData.id,
            link: `/course/${courseData.id}`,
            targetApp: 'student',
            metadata: {
              courseName: courseData.title,
              assignedBy: adminName,
              assignedAt: new Date().toISOString(),
              deepLink: `/course/${courseData.id}`
            },
            read: false,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          };

          await admin.firestore()
            .collection('notifications')
            .add(inAppNotification);
        }

        notificationResults.push({
          userId,
          success: successCount > 0,
          tokensAttempted: tokens.length,
          tokensSuccessful: successCount,
          tokenErrors: tokenErrors,
          message: successCount > 0 ?
            `Notification sent successfully to ${successCount}/${tokens.length} devices` :
            `Failed to send notification to any device`
        });

      } catch (userError) {
        console.error(`Error sending notification to user ${userId}:`, userError);
        errors.push({
          userId,
          error: userError.message
        });
      }
    }

    // Calculate summary
    const totalSuccess = notificationResults.filter(r => r.success).length;
    const totalFailed = notificationResults.filter(r => !r.success).length + errors.length;

    console.log(`Consolidated notification summary: ${totalSuccess} successful, ${totalFailed} failed`);

    return {
      success: totalSuccess > 0,
      results: notificationResults,
      errors: errors,
      summary: {
        totalUsers: assignedUserIds.length,
        totalSuccess: totalSuccess,
        totalFailed: totalFailed,
        coursesAssigned: courseDataArray.length
      }
    };

  } catch (error) {
    console.error('Error in sendConsolidatedCourseAssignmentNotification:', error);
    throw error;
  }
};

// Send push notification when a new community chat message is created
// Updated: Added CPU limits and appType filter for iOS notifications
exports.sendCommunityNotification = onDocumentCreated({
  document: "communityChat/{messageId}",
  cpu: 0.5,
  memory: "256MiB"
}, async (event) => {
  try {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the community chat event");
      return null;
    }

    const messageData = snapshot.data();
    const { text, senderId, senderName } = messageData;

    // Skip welcome messages to avoid notification spam
    if (text && text.includes("Welcome to the Community Chat!")) {
      console.log("Skipping notification for welcome message");
      return null;
    }

    console.log('\n=== Community Chat Notification Debug ===');
    console.log(`Sender: ${senderName} (${senderId})`);
    console.log(`Message: ${text ? text.substring(0, 50) : 'N/A'}...`);

    // Create payload with BOTH notification and data fields for iOS compatibility
    const payload = {
      notification: {
        title: `New community message from ${senderName || 'Someone'}`,
        body: text && text.length > 100 ? `${text.substring(0, 97)}...` : (text || 'New message')
      },
      data: {
        type: "community_chat",
        messageId: event.params.messageId,
        senderId: senderId || "",
        senderName: senderName || "",
        click_action: "FLUTTER_NOTIFICATION_CLICK"
      },
      android: {
        priority: "high",
        notification: {
          channel_id: "community_channel"
        }
      },
      apns: {
        headers: {
          "apns-priority": "10"
        },
        payload: {
          aps: {
            badge: 1,
            sound: "default",
            category: "COMMUNITY_MESSAGE"
          }
        }
      }
    };

    console.log("Payload created for community chat notification");

    try {
      // Send ONLY to individual tokens (no topics) to avoid duplicate notifications
      // Get all users and send individually
      const usersSnapshot = await admin.firestore()
        .collection('users')
        .get();

      if (usersSnapshot.empty) {
        console.log('❌ No users found');
        console.log('=== End Community Chat Notification Debug ===\n');
        return null;
      }

      console.log(`Found ${usersSnapshot.size} total users`);

      // Collect all tokens with platform deduplication
      console.log('Collecting user tokens...');
      const platformTokensMap = new Map(); // userId_platform -> token
      const tokenPromises = [];

      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        // Skip sending notification to the message sender
        if (userId === senderId) {
          console.log(`Skipping sender: ${userId}`);
          continue;
        }

        tokenPromises.push(
          admin.firestore()
            .collection('user_tokens')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .where('appType', '==', 'student')
            .get()
            .then(snapshot => {
              if (!snapshot.empty) {
                const userPlatforms = {};
                snapshot.forEach(doc => {
                  const tokenData = doc.data();
                  const platform = tokenData.platform || 'unknown';
                  const lastUsed = tokenData.lastUsed?.toDate?.() || tokenData.createdAt?.toDate?.() || new Date(0);

                  // Keep only the most recent token per platform per user
                  if (!userPlatforms[platform] || lastUsed > userPlatforms[platform].lastUsed) {
                    userPlatforms[platform] = {
                      token: tokenData.token,
                      lastUsed: lastUsed
                    };
                  }
                });

                // Add deduplicated tokens to map
                Object.entries(userPlatforms).forEach(([platform, data]) => {
                  const key = `${userId}_${platform}`;
                  platformTokensMap.set(key, data.token);
                });
              }
            })
            .catch(err => {
              console.error(`Error getting tokens for user ${userId}:`, err.message);
            })
        );
      }

      // Wait for all token queries to complete
      await Promise.all(tokenPromises);

      const allTokens = Array.from(platformTokensMap.values());
      console.log(`Collected ${allTokens.length} deduplicated tokens (excluding sender)`);

      // Send to all tokens with error tracking
      if (allTokens.length > 0) {
        let successCount = 0;
        let failCount = 0;

        // Send in batches of 10
        const batchSize = 10;
        for (let i = 0; i < allTokens.length; i += batchSize) {
          const batch = allTokens.slice(i, i + batchSize);
          const batchPromises = batch.map(async token => {
            try {
              await admin.messaging().send({
                token: token,
                ...payload
              });
              successCount++;
            } catch (err) {
              failCount++;
              console.error(`Error sending to token ${token.substring(0, 10)}...:`, err.message);

              if (err.code === 'messaging/third-party-auth-error') {
                console.error(`   ⚠️ APNS authentication error`);
              }
            }
          });

          await Promise.all(batchPromises);
          console.log(`Sent batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allTokens.length / batchSize)}`);
        }

        console.log(`\n📊 Community Chat Send Summary:`);
        console.log(`   Total tokens: ${allTokens.length}`);
        console.log(`   ✅ Successful: ${successCount}`);
        console.log(`   ❌ Failed: ${failCount}`);
      } else {
        console.log('No tokens to send to (all users may be offline or sender was only user)');
      }

      console.log('=== End Community Chat Notification Debug ===\n');
    } catch (err) {
      console.error('Error sending community notifications:', err.message);
      console.error(err);
    }

    return null;
  } catch (err) {
    console.error("Error in sendCommunityNotification:", err);
    return null;
  }
});

// Send push notification when a new past questions message is created
// Updated: Added CPU limits and appType filter for iOS notifications
exports.sendPastQuestionsNotification = onDocumentCreated({
  document: "pastQuestions/{messageId}",
  cpu: 0.5,
  memory: "256MiB"
}, async (event) => {
  try {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the past questions event");
      return null;
    }

    const messageData = snapshot.data();
    const { text, senderId, senderName } = messageData;

    // Skip welcome messages to avoid notification spam
    if (text && text.includes("Welcome to Past Questions!")) {
      console.log("Skipping notification for welcome message");
      return null;
    }

    console.log('\n=== Past Questions Notification Debug ===');
    console.log(`Sender: ${senderName} (${senderId})`);
    console.log(`Message: ${text ? text.substring(0, 50) : 'N/A'}...`);

    // Create payload with BOTH notification and data fields for iOS compatibility
    const payload = {
      notification: {
        title: `New past question from ${senderName || 'Someone'}`,
        body: text && text.length > 100 ? `${text.substring(0, 97)}...` : (text || 'New question')
      },
      data: {
        type: "past_questions",
        messageId: event.params.messageId,
        senderId: senderId || "",
        senderName: senderName || "",
        click_action: "FLUTTER_NOTIFICATION_CLICK"
      },
      android: {
        priority: "high",
        notification: {
          channel_id: "past_questions_channel"
        }
      },
      apns: {
        headers: {
          "apns-priority": "10"
        },
        payload: {
          aps: {
            badge: 1,
            sound: "default",
            category: "PAST_QUESTION"
          }
        }
      }
    };

    console.log("Payload created for past questions notification");

    try {
      // Send ONLY to individual tokens (no topics) to avoid duplicate notifications
      // Get all users and send individually
      const usersSnapshot = await admin.firestore()
        .collection('users')
        .get();

      if (usersSnapshot.empty) {
        console.log('❌ No users found');
        console.log('=== End Past Questions Notification Debug ===\n');
        return null;
      }

      console.log(`Found ${usersSnapshot.size} total users`);

      // Collect all tokens with platform deduplication
      console.log('Collecting user tokens...');
      const platformTokensMap = new Map(); // userId_platform -> token
      const tokenPromises = [];

      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        // Skip sending notification to the message sender
        if (userId === senderId) {
          console.log(`Skipping sender: ${userId}`);
          continue;
        }

        tokenPromises.push(
          admin.firestore()
            .collection('user_tokens')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .where('appType', '==', 'student')
            .get()
            .then(snapshot => {
              if (!snapshot.empty) {
                const userPlatforms = {};
                snapshot.forEach(doc => {
                  const tokenData = doc.data();
                  const platform = tokenData.platform || 'unknown';
                  const lastUsed = tokenData.lastUsed?.toDate?.() || tokenData.createdAt?.toDate?.() || new Date(0);

                  // Keep only the most recent token per platform per user
                  if (!userPlatforms[platform] || lastUsed > userPlatforms[platform].lastUsed) {
                    userPlatforms[platform] = {
                      token: tokenData.token,
                      lastUsed: lastUsed
                    };
                  }
                });

                // Add deduplicated tokens to map
                Object.entries(userPlatforms).forEach(([platform, data]) => {
                  const key = `${userId}_${platform}`;
                  platformTokensMap.set(key, data.token);
                });
              }
            })
            .catch(err => {
              console.error(`Error getting tokens for user ${userId}:`, err.message);
            })
        );
      }

      // Wait for all token queries to complete
      await Promise.all(tokenPromises);

      const allTokens = Array.from(platformTokensMap.values());
      console.log(`Collected ${allTokens.length} deduplicated tokens (excluding sender)`);

      // Send to all tokens with error tracking
      if (allTokens.length > 0) {
        let successCount = 0;
        let failCount = 0;

        // Send in batches of 10
        const batchSize = 10;
        for (let i = 0; i < allTokens.length; i += batchSize) {
          const batch = allTokens.slice(i, i + batchSize);
          const batchPromises = batch.map(async token => {
            try {
              await admin.messaging().send({
                token: token,
                ...payload
              });
              successCount++;
            } catch (err) {
              failCount++;
              console.error(`Error sending to token ${token.substring(0, 10)}...:`, err.message);

              if (err.code === 'messaging/third-party-auth-error') {
                console.error(`   ⚠️ APNS authentication error`);
              }
            }
          });

          await Promise.all(batchPromises);
          console.log(`Sent batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allTokens.length / batchSize)}`);
        }

        console.log(`\n📊 Past Questions Send Summary:`);
        console.log(`   Total tokens: ${allTokens.length}`);
        console.log(`   ✅ Successful: ${successCount}`);
        console.log(`   ❌ Failed: ${failCount}`);
      } else {
        console.log('No tokens to send to (all users may be offline or sender was only user)');
      }

      console.log('=== End Past Questions Notification Debug ===\n');
    } catch (err) {
      console.error('Error sending past questions notifications:', err.message);
      console.error(err);
    }

    return null;
  } catch (err) {
    console.error("Error in sendPastQuestionsNotification:", err);
    return null;
  }
});

// ============================================================================
// TOKEN CLEANUP
// ============================================================================

/**
 * Clean up invalid FCM tokens. Runs daily.
 */
exports.cleanupInvalidTokens = onSchedule("every 24 hours", async (event) => {
  try {
    const tokensSnapshot = await admin.firestore()
      .collection("user_tokens")
      .get();

    if (tokensSnapshot.empty) {
      console.log("No tokens to clean up");
      return null;
    }

    const tokens = tokensSnapshot.docs.map((doc) => ({
      token: doc.id,
      data: doc.data(),
    }));

    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const tokenValues = batch.map((t) => t.token);

      try {
        const response = await admin.messaging().sendEachForMulticast({
          data: {test: "true"},
          tokens: tokenValues,
        });

        if (response.failureCount > 0) {
          const failedTokens = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              failedTokens.push(batch[idx].token);
            }
          });

          const deletePromises = failedTokens.map(async (token) => {
            const tokenData = batch.find((t) => t.token === token)?.data;
            const userId = tokenData?.userId;

            await admin.firestore()
              .collection("user_tokens")
              .doc(token)
              .delete();

            if (userId) {
              await admin.firestore()
                .collection("users")
                .doc(userId)
                .collection("tokens")
                .doc(token)
                .delete();
            }
          });

          await Promise.all(deletePromises);
          console.log(`Deleted ${failedTokens.length} invalid tokens`);
        }
      } catch (error) {
        console.error(`Error checking token batch ${i}-${i + 500}:`, error);
      }
    }

    return {success: true};
  } catch (error) {
    console.error("Error cleaning up tokens:", error);
    return {error: error.message};
  }
}); 