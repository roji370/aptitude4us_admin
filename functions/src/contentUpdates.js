const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

/**
 * Helper: send FCM push notifications to a list of student users.
 * Uses sendEachForMulticast (compatible with firebase-admin v12+).
 * @param {Array<string>} userIds - list of user IDs to notify
 * @param {string} title - notification title
 * @param {string} body - notification body
 * @param {Object} data - extra FCM data payload
 * @return {Promise<void>}
 */
async function sendFcmToUsers(userIds, title, body, data = {}) {
  const tokens = [];
  const tokenToUserMap = {}; // Map token -> userId for debugging

  logger.info(`📨 sendFcmToUsers: Sending "${title}" to ${userIds.length} users`);

  let usersWithTokens = 0;
  let usersWithoutTokens = 0;

  for (const userId of userIds) {
    const tokensSnapshot = await admin.firestore()
      .collection('user_tokens')
      .where('userId', '==', userId)
      .where('appType', '==', 'student')
      .where('isActive', '==', true)
      .get();

    if (tokensSnapshot.empty) {
      usersWithoutTokens++;
    } else {
      usersWithTokens++;
    }

    tokensSnapshot.docs.forEach((doc) => {
      const tokenData = doc.data();
      const token = tokenData.token || doc.id;
      if (token) {
        tokens.push(token);
        tokenToUserMap[token] = {
          userId,
          platform: tokenData.platform || 'unknown',
          docId: doc.id
        };
      }
    });
  }

  // Ensure tokens are unique
  const uniqueTokens = [...new Set(tokens)];

  logger.info(`📊 Token summary: ${usersWithTokens} users with tokens, ${usersWithoutTokens} users WITHOUT tokens, ${uniqueTokens.length} unique tokens`);

  if (uniqueTokens.length === 0) {
    logger.warn('⚠️ No active tokens found for any user — notifications cannot be delivered');
    return;
  }


  try {
    const collapseId = `${data.type || 'update'}_${Date.now()}`;
    const message = {
      notification: { title, body },
      data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
      android: {
        priority: "high",
        ttl: 86400000,
        notification: {
          channel_id: "general_channel"
        }
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-collapse-id": collapseId
        },
        payload: {
          aps: {
            badge: 1,
            sound: "default"
          }
        }
      },
      tokens: uniqueTokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    logger.info(`📱 FCM: ${response.successCount}/${uniqueTokens.length} sent`);
    
    // Log per-token results with user context
    response.responses.forEach((resp, idx) => {
      const token = uniqueTokens[idx];
      const userInfo = tokenToUserMap[token] || {};
      if (resp.success) {
        logger.info(`  ✅ Delivered to user ${userInfo.userId || 'unknown'} (${userInfo.platform || 'unknown'}) token:${token.substring(0, 15)}...`);
      } else {
        logger.error(`  ❌ FAILED for user ${userInfo.userId || 'unknown'} (${userInfo.platform || 'unknown'}) token:${token.substring(0, 15)}... error: ${resp.error?.message} [${resp.error?.code}]`);
      }
    });

    // Clean up invalid tokens immediately
    if (response.failureCount > 0) {
      const tokensToDeactivate = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          // Deactivate tokens that are no longer registered
          if (errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/invalid-registration-token') {
            tokensToDeactivate.push(uniqueTokens[idx]);
          }
        }
      });

      // Mark stale tokens as inactive in Firestore
      // Query by token field since user_tokens uses auto-generated doc IDs
      for (const staleToken of tokensToDeactivate) {
        try {
          const tokenQuery = await admin.firestore()
            .collection('user_tokens')
            .where('token', '==', staleToken)
            .get();
          for (const doc of tokenQuery.docs) {
            await doc.ref.update({ isActive: false, deactivatedAt: admin.firestore.FieldValue.serverTimestamp() });
            logger.info(`🧹 Deactivated stale token: ${staleToken.substring(0, 10)}...`);
          }
        } catch (cleanupError) {
          logger.warn(`Could not deactivate token ${staleToken.substring(0, 10)}...:`, cleanupError.message);
        }
      }
    }
  } catch (error) {
    logger.error('Error sending FCM notifications:', error);
  }
}

/**
 * Detect course updates and notify enrolled students
 */
exports.notifyCourseUpdate = onDocumentWritten({
  document: "courses/{courseId}",
  cpu: 0.5,
  memory: "256MiB"
}, async (event) => {
  const courseId = event.params.courseId;
  const beforeData = event.data.before?.data();
  const afterData = event.data.after?.data();

  // Skip if course is being deleted
  if (!afterData) {
    logger.info(`Course ${courseId} deleted, skipping notification`);
    return null;
  }

  // Skip if this is a new course (not an update)
  if (!beforeData) {
    logger.info(`New course ${courseId} created, skipping notification`);
    return null;
  }

  try {
    // Determine what changed
    let updateType = 'course_general';
    let updateMessage = 'Course has been updated';
    let icon = '📚';
    // Whether to send an immediate push notification
    let sendNotification = false;

    // Course unpublished
    if (beforeData.published && !afterData.published) {
      updateType = 'course_unpublished';
      updateMessage = '⚠️ Course is no longer available';
      icon = '🔴';
      sendNotification = true;
    }
    // Course deleted
    else if (beforeData.deleted !== afterData.deleted && afterData.deleted) {
      updateType = 'course_deleted';
      updateMessage = '⚠️ Course has been removed';
      icon = '🔴';
      sendNotification = true;
    }
    // Title changed
    else if (beforeData.title !== afterData.title) {
      updateType = 'course_title';
      updateMessage = `Course renamed to "${afterData.title}"`;
      icon = '📚';
      sendNotification = true;
    }
    // Description changed
    else if (beforeData.description !== afterData.description) {
      updateType = 'course_description';
      updateMessage = 'Course description updated';
      icon = '📝';
      sendNotification = true;
    }
    // Thumbnail changed
    else if (beforeData.thumbnail !== afterData.thumbnail) {
      updateType = 'course_thumbnail';
      updateMessage = 'Course image updated';
      icon = '🖼️';
      sendNotification = false;
    }
    // Category changed
    else if (beforeData.category !== afterData.category) {
      updateType = 'course_category';
      updateMessage = `Moved to ${afterData.category} category`;
      icon = '📁';
      sendNotification = false;
    }
    // Modules updated
    else {
      updateType = 'course_modules_updated';
      updateMessage = 'Course modules have been updated';
      icon = '🔄';
      sendNotification = true;
    }

    logger.info(`Course ${courseId} updated: ${updateType}`);

    // Get all users assigned to this course
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('assignedCourseIds', 'array-contains', courseId)
      .get();

    if (usersSnapshot.empty) {
      logger.info(`No assigned users for course ${courseId}`);
      return null;
    }

    const assignedUserIds = usersSnapshot.docs.map(doc => doc.id);
    logger.info(`Found ${assignedUserIds.length} assigned users for course ${courseId}`);

    // Create update tracking document
    const updateRecord = {
      courseId,
      type: updateType,
      message: updateMessage,
      icon,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      notifiedUsers: assignedUserIds,
      seenBy: [],
      courseName: afterData.title,
      courseThumb: afterData.thumbnail || ''
    };

    const updateRef = await admin.firestore()
      .collection('contentUpdates')
      .add(updateRecord);

    logger.info(`Created update record: ${updateRef.id}`);

    if (sendNotification) {
      const notificationData = {
        title: `${icon} Course Update`,
        body: updateMessage,
        type: 'content_update',
        targetApp: 'student',
        sender: 'system',
        recipients: assignedUserIds,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        link: `/course/${courseId}`,
        metadata: {
          updateType,
          courseId,
          courseName: afterData.title,
          updateId: updateRef.id,
          icon
        }
      };

      await admin.firestore().collection('notifications').add(notificationData);

      // Send FCM push notifications directly
      await sendFcmToUsers(
        assignedUserIds,
        `${icon} Course Update`,
        updateMessage,
        { type: 'content_update', courseId, updateType, updateId: updateRef.id }
      );

      logger.info(`Notification sent to ${assignedUserIds.length} students`);
    } else {
      logger.info(`Update recorded, notification will be batched`);
    }

    return null;
  } catch (error) {
    logger.error('Error in notifyCourseUpdate:', error);
    return null;
  }
});

/**
 * Detect module updates (content added, title changed, etc.)
 * Listens to flat modules collection: modules/{moduleId}
 */
exports.notifyModuleUpdate = onDocumentWritten({
  document: "modules/{moduleId}",
  cpu: 0.5,
  memory: "256MiB"
}, async (event) => {
  const moduleId = event.params.moduleId;
  const beforeData = event.data.before?.data();
  const afterData = event.data.after?.data();

  // Skip if module is being deleted or newly created
  if (!afterData) {
    logger.info(`Module ${moduleId} deleted, skipping notification`);
    return null;
  }

  if (!beforeData) {
    logger.info(`New module ${moduleId} created, skipping notification`);
    return null;
  }

  // Get courseId from module data
  const courseId = afterData.courseId;
  if (!courseId) {
    logger.warn(`Module ${moduleId} has no courseId`);
    return null;
  }

  try {
    // Determine what changed
    let updateType = 'module_general';
    let updateMessage = 'Module has been updated';
    let icon = '📝';

    if (beforeData.title !== afterData.title) {
      updateType = 'module_title';
      updateMessage = `Module renamed to "${afterData.title}"`;
      icon = '📝';
    }
    else if (beforeData.description !== afterData.description) {
      updateType = 'module_description';
      updateMessage = `Module "${afterData.title}" description updated`;
      icon = '📝';
    }
    else {
      // Content-level changes (array additions, item URL/publish changes, etc.) are handled
      // by notifyContentUpdate and notifyContentItemUpdate which also listen on modules/{moduleId}.
      // Returning null here prevents duplicate FCM sends.
      logger.info(`Module ${moduleId} updated but no title/description change — deferring to content-level triggers`);
      return null;
    }

    logger.info(`Module ${moduleId} in course ${courseId} updated: ${updateType}`);

    // Get course info
    const courseDoc = await admin.firestore()
      .collection('courses')
      .doc(courseId)
      .get();

    if (!courseDoc.exists) {
      logger.warn(`Course ${courseId} not found`);
      return null;
    }

    const courseData = courseDoc.data();

    // Get assigned users
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('assignedCourseIds', 'array-contains', courseId)
      .get();

    if (usersSnapshot.empty) {
      logger.info(`No assigned users for course ${courseId}`);
      return null;
    }

    const assignedUserIds = usersSnapshot.docs.map(doc => doc.id);

    // Create update tracking
    const updateRecord = {
      courseId,
      moduleId,
      type: updateType,
      message: updateMessage,
      icon,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      notifiedUsers: assignedUserIds,
      seenBy: [],
      moduleName: afterData.title,
      courseName: courseData.title
    };

    const updateRef = await admin.firestore()
      .collection('contentUpdates')
      .add(updateRecord);

    // Send notification for all module update types (title, description, content)
    const notificationData = {
      title: `${icon} Module Update`,
      body: `${courseData.title}: ${updateMessage}`,
      type: 'content_update',
      targetApp: 'student',
      sender: 'system',
      recipients: assignedUserIds,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      link: `/course/${courseId}/module/${moduleId}`,
      metadata: {
        updateType,
        courseId,
        moduleId,
        courseName: courseData.title,
        moduleName: afterData.title,
        updateId: updateRef.id,
        icon
      }
    };

    await admin.firestore().collection('notifications').add(notificationData);

    // Send FCM push notifications directly
    await sendFcmToUsers(
      assignedUserIds,
      `${icon} Module Update`,
      `${courseData.title}: ${updateMessage}`,
      { type: 'content_update', courseId, moduleId, updateType, updateId: updateRef.id }
    );

    logger.info(`Module update notification sent to ${assignedUserIds.length} students`);

    return null;
  } catch (error) {
    logger.error('Error in notifyModuleUpdate:', error);
    return null;
  }
});

/**
 * Detect content-level updates (changes to specific content types within a module)
 * This provides more granular tracking than notifyModuleUpdate
 */
exports.notifyContentUpdate = onDocumentWritten({
  document: "modules/{moduleId}",
  cpu: 0.5,
  memory: "256MiB"
}, async (event) => {
  const moduleId = event.params.moduleId;
  const beforeData = event.data.before?.data();
  const afterData = event.data.after?.data();

  // Skip if module is being deleted or newly created
  if (!afterData || !beforeData) {
    return null;
  }

  const courseId = afterData.courseId;
  if (!courseId) {
    logger.warn(`Module ${moduleId} has no courseId`);
    return null;
  }

  try {
    const beforeContent = beforeData.content || {};
    const afterContent = afterData.content || {};

    const contentTypes = ['videos', 'notes', 'pdfs', 'images', 'audios', 'links'];
    const updates = [];

    // Analyze each content type for changes
    for (const contentType of contentTypes) {
      const beforeItems = beforeContent[contentType] || [];
      const afterItems = afterContent[contentType] || [];

      // Stable key: prefer explicit id, fall back to url or inline content.
      const itemKey = (item) => item.id || item.url || item.content || '';

      const beforeKeyed = beforeItems.map(itemKey).filter(Boolean);
      const afterKeyed = afterItems.map(itemKey).filter(Boolean);

      // Determine if we can use stable key diffing (items have meaningful keys)
      const canUseKeyDiff = beforeKeyed.length === beforeItems.length && afterKeyed.length === afterItems.length;

      if (canUseKeyDiff && (beforeItems.length > 0 || afterItems.length > 0)) {
        // Stable key diffing — most accurate
        const beforeIds = new Set(beforeKeyed);
        const afterIds = new Set(afterKeyed);

        const addedIds = [...afterIds].filter((id) => !beforeIds.has(id));
        const removedIds = [...beforeIds].filter((id) => !afterIds.has(id));

        if (addedIds.length > 0) {
          const label = contentType.slice(0, -1);
          updates.push({
            type: `content_${contentType}_updated`,
            message: `${addedIds.length} new ${label}${addedIds.length > 1 ? 's' : ''} added`,
            icon: getContentIcon(contentType),
            contentType,
            changeType: 'added',
            count: addedIds.length,
            itemIds: addedIds
          });
        }

        if (removedIds.length > 0) {
          const label = contentType.slice(0, -1);
          updates.push({
            type: `content_${contentType}_updated`,
            message: `${removedIds.length} ${label}${removedIds.length > 1 ? 's' : ''} removed`,
            icon: getContentIcon(contentType),
            contentType,
            changeType: 'removed',
            count: removedIds.length,
            itemIds: removedIds
          });
        }
      } else {
        // Fallback: items lack stable keys — compare array lengths
        const diff = afterItems.length - beforeItems.length;

        if (diff > 0) {
          const label = contentType.slice(0, -1);
          updates.push({
            type: `content_${contentType}_updated`,
            message: `${diff} new ${label}${diff > 1 ? 's' : ''} added`,
            icon: getContentIcon(contentType),
            contentType,
            changeType: 'added',
            count: diff,
            itemIds: []
          });
        } else if (diff < 0) {
          const count = Math.abs(diff);
          const label = contentType.slice(0, -1);
          updates.push({
            type: `content_${contentType}_updated`,
            message: `${count} ${label}${count > 1 ? 's' : ''} removed`,
            icon: getContentIcon(contentType),
            contentType,
            changeType: 'removed',
            count,
            itemIds: []
          });
        }
      }
    }

    // If no content-level changes detected, skip
    if (updates.length === 0) {
      return null;
    }

    logger.info(`Content-level updates detected in module ${moduleId}: ${updates.length} changes`);

    // Get course info
    const courseDoc = await admin.firestore()
      .collection('courses')
      .doc(courseId)
      .get();

    if (!courseDoc.exists) {
      logger.warn(`Course ${courseId} not found`);
      return null;
    }

    const courseData = courseDoc.data();

    // Get assigned users
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('assignedCourseIds', 'array-contains', courseId)
      .get();

    if (usersSnapshot.empty) {
      logger.info(`No assigned users for course ${courseId}`);
      return null;
    }

    const assignedUserIds = usersSnapshot.docs.map(doc => doc.id);

    // Process each update
    for (const update of updates) {
      // Create update tracking
      const updateRecord = {
        courseId,
        moduleId,
        type: update.type,
        message: update.message,
        icon: update.icon,
        contentType: update.contentType,
        changeType: update.changeType,
        count: update.count,
        itemIds: update.itemIds,          // top-level for direct access
        contentChanges: [{                // nested for per-item badge tracking
          type: update.contentType,
          change: update.changeType,
          count: update.count,
          itemIds: update.itemIds
        }],
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        notifiedUsers: assignedUserIds,
        seenBy: [],
        moduleName: afterData.title,
        courseName: courseData.title
      };

      const updateRef = await admin.firestore()
        .collection('contentUpdates')
        .add(updateRecord);

      logger.info(`Created content update doc: ${updateRef.id} (${update.contentType} ${update.changeType})`);
    }

    // Send a single summarised FCM notification
    // No per-update notification docs — avoids double notifications from sendPushNotification trigger
    const summaryMessage = updates.map((u) =>
      u.changeType === 'added'
        ? `${getContentIcon(u.contentType)} ${u.count} new ${u.contentType.slice(0, -1)}${u.count > 1 ? 's' : ''} added`
        : `${getContentIcon(u.contentType)} ${u.count} ${u.contentType.slice(0, -1)}${u.count > 1 ? 's' : ''} removed`
    ).join('. ');

    await sendFcmToUsers(
      assignedUserIds,
      '✨ Content Update',
      `${courseData.title}: ${summaryMessage}`,
      { type: 'content_update', courseId, moduleId }
    );

    return null;
  } catch (error) {
    logger.error('Error in notifyContentUpdate:', error);
    return null;
  }
});

/**
 * Detect individual content item updates (title, description, URL, publish status changes)
 * This provides the most granular level of change tracking
 */
exports.notifyContentItemUpdate = onDocumentWritten({
  document: "modules/{moduleId}",
  cpu: 0.5,
  memory: "256MiB"
}, async (event) => {
  const moduleId = event.params.moduleId;
  const beforeData = event.data.before?.data();
  const afterData = event.data.after?.data();

  // Skip if module is being deleted or newly created
  if (!afterData || !beforeData) {
    return null;
  }

  const courseId = afterData.courseId;
  if (!courseId) {
    logger.warn(`Module ${moduleId} has no courseId`);
    return null;
  }

  try {
    const beforeContent = beforeData.content || {};
    const afterContent = afterData.content || {};

    const contentTypes = ['videos', 'notes', 'pdfs', 'images', 'audios', 'links'];
    const itemUpdates = [];

    // Analyze each content type for item-level changes
    for (const contentType of contentTypes) {
      const beforeItems = beforeContent[contentType] || [];
      const afterItems = afterContent[contentType] || [];

      // Create maps for easy lookup
      const beforeMap = new Map(beforeItems.filter(item => item.id).map(item => [item.id, item]));
      const afterMap = new Map(afterItems.filter(item => item.id).map(item => [item.id, item]));

      // Check for updates to existing items
      for (const [itemId, afterItem] of afterMap.entries()) {
        const beforeItem = beforeMap.get(itemId);

        // Skip if this is a new item (handled by notifyContentUpdate)
        if (!beforeItem) continue;

        // Detect title change — record only, no push
        if (beforeItem.title !== afterItem.title) {
          itemUpdates.push({
            type: 'content_item_title_changed',
            message: `"${beforeItem.title}" renamed to "${afterItem.title}"`,
            icon: '✏️',
            contentType,
            itemId,
            itemTitle: afterItem.title,
            changeType: 'title_changed',
            oldValue: beforeItem.title,
            newValue: afterItem.title,
            sendNotification: false
          });
        }

        // Detect description change — record only, no push
        if (beforeItem.description !== afterItem.description) {
          itemUpdates.push({
            type: 'content_item_description_changed',
            message: `Description updated for "${afterItem.title}"`,
            icon: '📝',
            contentType,
            itemId,
            itemTitle: afterItem.title,
            changeType: 'description_changed',
            sendNotification: false
          });
        }

        // Detect URL change (content replaced) — send push
        if (beforeItem.url !== afterItem.url) {
          itemUpdates.push({
            type: 'content_item_replaced',
            message: `"${afterItem.title}" has been updated with new content`,
            icon: '🔄',
            contentType,
            itemId,
            itemTitle: afterItem.title,
            changeType: 'url_changed',
            sendNotification: true
          });
        }

        // Detect publish status change
        if (beforeItem.isPublished !== afterItem.isPublished) {
          if (afterItem.isPublished === false) {
            // Unpublished — send push
            itemUpdates.push({
              type: 'content_item_unpublished',
              message: `"${afterItem.title}" is no longer available`,
              icon: '🔴',
              contentType,
              itemId,
              itemTitle: afterItem.title,
              changeType: 'unpublished',
              sendNotification: true
            });
          } else {
            // Published — send push
            itemUpdates.push({
              type: 'content_item_published',
              message: `"${afterItem.title}" is now available`,
              icon: '✅',
              contentType,
              itemId,
              itemTitle: afterItem.title,
              changeType: 'published',
              sendNotification: true
            });
          }
        }

        // Detect one-time view toggle
        if (beforeItem.isOneTimeView !== afterItem.isOneTimeView) {
          if (afterItem.isOneTimeView) {
            itemUpdates.push({
              type: 'content_item_one_time_enabled',
              message: `"${afterItem.title}" is now restricted to one-time view`,
              icon: '🔒',
              contentType,
              itemId,
              itemTitle: afterItem.title,
              changeType: 'one_time_enabled',
              sendNotification: true  // Notify students about one-time view changes
            });
          } else {
            itemUpdates.push({
              type: 'content_item_one_time_disabled',
              message: `"${afterItem.title}" can now be viewed multiple times`,
              icon: '🔓',
              contentType,
              itemId,
              itemTitle: afterItem.title,
              changeType: 'one_time_disabled',
              sendNotification: true  // Notify students about one-time view changes
            });
          }
        }
      }
    }

    // If no item-level changes detected, skip
    if (itemUpdates.length === 0) {
      return null;
    }

    logger.info(`Content-item updates detected in module ${moduleId}: ${itemUpdates.length} changes`);

    // Get course info
    const courseDoc = await admin.firestore()
      .collection('courses')
      .doc(courseId)
      .get();

    if (!courseDoc.exists) {
      logger.warn(`Course ${courseId} not found`);
      return null;
    }

    const courseData = courseDoc.data();

    // Get assigned users
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('assignedCourseIds', 'array-contains', courseId)
      .get();

    if (usersSnapshot.empty) {
      logger.info(`No assigned users for course ${courseId}`);
      return null;
    }

    const assignedUserIds = usersSnapshot.docs.map(doc => doc.id);

    // Process each item update
    for (const update of itemUpdates) {
      // Create update tracking
      const updateRecord = {
        courseId,
        moduleId,
        contentItemId: update.itemId,
        type: update.type,
        message: update.message,
        icon: update.icon,
        contentType: update.contentType,
        itemTitle: update.itemTitle,
        changeType: update.changeType,
        ...(update.oldValue !== undefined && { oldValue: update.oldValue }),
        ...(update.newValue !== undefined && { newValue: update.newValue }),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        notifiedUsers: assignedUserIds,
        seenBy: [],
        moduleName: afterData.title,
        courseName: courseData.title
      };

      const updateRef = await admin.firestore()
        .collection('contentUpdates')
        .add(updateRecord);

      // Send push for: url_changed, published, unpublished
      // Record only (no push) for: title_changed, description_changed
      if (update.sendNotification) {
        const notificationData = {
          title: `${update.icon} Content Item Update`,
          body: `${courseData.title} - ${afterData.title}: ${update.message}`,
          type: 'content_item_update',
          targetApp: 'student',
          sender: 'system',
          recipients: assignedUserIds,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          link: `/course/${courseId}/module/${moduleId}`,
          metadata: {
            updateType: update.type,
            courseId,
            moduleId,
            contentItemId: update.itemId,
            courseName: courseData.title,
            moduleName: afterData.title,
            itemTitle: update.itemTitle,
            updateId: updateRef.id,
            icon: update.icon,
            contentType: update.contentType,
            changeType: update.changeType
          }
        };

        await admin.firestore().collection('notifications').add(notificationData);

        // Send FCM push notifications directly
        await sendFcmToUsers(
          assignedUserIds,
          `${update.icon} Content Item Update`,
          `${courseData.title} - ${afterData.title}: ${update.message}`,
          { type: 'content_item_update', courseId, moduleId, changeType: update.changeType }
        );

        logger.info(`Content item update notification sent to ${assignedUserIds.length} students`);
      } else {
        logger.info(`Item update recorded, notification will be batched`);
      }
    }

    return null;
  } catch (error) {
    logger.error('Error in notifyContentItemUpdate:', error);
    return null;
  }
});

/**
 * Helper function to get icon for content type
 */
function getContentIcon(contentType) {
  const icons = {
    videos: '🎥',
    notes: '📝',
    pdfs: '📄',
    images: '🖼️',
    audios: '🎵',
    links: '🔗'
  };
  return icons[contentType] || '📦';
}

/**
 * Mark content update as seen by user
 */
exports.markUpdateAsSeen = onCall({
  cors: true,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { updateId } = request.data;
  const userId = request.auth.uid;

  if (!updateId) {
    throw new Error('Update ID is required');
  }

  try {
    const updateRef = admin.firestore().collection('contentUpdates').doc(updateId);
    const updateDoc = await updateRef.get();

    if (!updateDoc.exists) {
      throw new Error('Update not found');
    }

    // Check if user is in notifiedUsers
    const notifiedUsers = updateDoc.data().notifiedUsers || [];
    if (!notifiedUsers.includes(userId)) {
      throw new Error('User not authorized to mark this update as seen');
    }

    await updateRef.update({
      seenBy: admin.firestore.FieldValue.arrayUnion(userId)
    });

    logger.info(`User ${userId} marked update ${updateId} as seen`);

    return { success: true };
  } catch (error) {
    logger.error('Error marking update as seen:', error);
    throw new Error(error.message || 'Failed to mark update as seen');
  }
});

/**
 * Get unseen updates count for a user
 */
exports.getUnseenUpdatesCount = onCall({
  cors: true,
  cpu: 0.5,
  memory: "256MiB"
}, async (request) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const userId = request.auth.uid;

  try {
    const updatesSnapshot = await admin.firestore()
      .collection('contentUpdates')
      .where('notifiedUsers', 'array-contains', userId)
      .get();

    let unseenCount = 0;

    updatesSnapshot.forEach(doc => {
      const seenBy = doc.data().seenBy || [];
      if (!seenBy.includes(userId)) {
        unseenCount++;
      }
    });

    return {
      success: true,
      unseenCount
    };
  } catch (error) {
    logger.error('Error getting unseen updates count:', error);
    throw new Error('Failed to get unseen updates count');
  }
});
