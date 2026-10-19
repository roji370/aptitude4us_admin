# Screenshot Violation Management System

## Overview
The screenshot violation management system enforces content protection by detecting screenshot attempts in the student app and providing admin tools to manage violations and restore user access.

## System Architecture

### Flow Diagram
```
Student App → Screenshot Detection → Record Violation → Admin Management → Reset Access
     ↓              ↓                    ↓                 ↓                ↓
  iOS Native    Cloud Function      Firestore         Admin Dashboard   Student Access
```

## Components

### 1. Admin App Components

#### Database Schema
```typescript
// screenshotViolations collection
{
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  violations: {
    count: number;
    isBlocked: boolean;
    firstWarning?: Date;
    blockedAt?: Date;
    lastReset?: Date;
    resetHistory: ViolationReset[];
  };
  createdAt: Date;
  updatedAt: Date;
}
```

#### Key Files
- `src/types/violations.ts` - TypeScript definitions
- `src/services/violationService.ts` - API service functions
- `src/components/ViolationsDashboard.tsx` - Main dashboard
- `src/components/UserViolationDetail.tsx` - Individual user view
- `src/components/ResetViolationsDialog.tsx` - Reset functionality
- `src/pages/ViolationsPage.tsx` - Main page component

#### Navigation
- Added to admin sidebar as "Screenshot Violations"
- Route: `/violations`
- Admin-only access

### 2. Cloud Functions

#### API Endpoints
```javascript
// Check if user violations have been reset
exports.checkViolationResetStatus = functions.https.onCall(async (data, context) => {
  // Returns: { hasBeenReset: boolean, resetAt: string, currentViolations: number }
});

// Record a new screenshot violation
exports.recordScreenshotViolation = functions.https.onCall(async (data, context) => {
  // Returns: { success: boolean, violationCount: number, isBlocked: boolean }
});

// Acknowledge that reset has been seen by user
exports.acknowledgeViolationReset = functions.https.onCall(async (data, context) => {
  // Returns: { success: boolean }
});
```

### 3. Security Rules

#### Firestore Rules
```javascript
// Screenshot violations collection
match /screenshotViolations/{violationId} {
  // Users can read their own violations, admins can read all
  allow read: if isAuthenticated() && 
              (resource.data.userId == request.auth.uid || isAdmin());
  // Only admins can create, update, or delete violation records
  allow write: if isAdmin();
}
```

## Admin Workflow

### 1. Dashboard View
- View all users with violations
- Search by email/name
- Filter by status (WARNING/BLOCKED)
- See violation statistics

### 2. User Detail View
- Individual violation history
- Timeline of events
- Reset history
- Current status

### 3. Reset Process
1. Admin selects user to reset
2. Choose reason for reset:
   - False Positive
   - Support Request
   - Technical Issue
   - Admin Discretion
   - Other
3. Add optional notes
4. Confirm reset
5. User immediately regains access

## Student App Integration

### Required Implementation
The student app must implement these functions:

```dart
// Check for admin reset (call on app startup and resume)
Future<void> checkForAdminReset() async {
  try {
    final result = await FirebaseFunctions.instance
        .httpsCallable('checkViolationResetStatus')
        .call();
    
    if (result.data['hasBeenReset'] == true) {
      await resetState();
      // Show success message to user
      await acknowledgeReset();
    }
  } catch (error) {
    Logger.e('Error checking for admin reset: $error');
  }
}

// Record violation when screenshot detected
Future<void> recordViolation() async {
  try {
    final result = await FirebaseFunctions.instance
        .httpsCallable('recordScreenshotViolation')
        .call();
    
    final violationCount = result.data['violationCount'] as int;
    final isBlocked = result.data['isBlocked'] as bool;
    
    if (isBlocked) {
      // Show permanent block UI
    } else {
      // Show warning UI
    }
  } catch (error) {
    Logger.e('Error recording violation: $error');
  }
}
```

### Integration Points
1. **App Startup**: Check for resets
2. **App Resume**: Check for resets
3. **Screenshot Detection**: Record violation
4. **Content Access**: Validate not blocked

## API Reference

### Admin Service Functions

```typescript
// Get all violations for dashboard
getAllViolations(): Promise<ViolationSummary[]>

// Get specific user's violations
getUserViolations(userId: string): Promise<ScreenshotViolation | null>

// Reset user's violations
resetUserViolations(userId: string, resetRequest: ViolationResetRequest, adminUserId: string): Promise<void>

// Get violation statistics
getViolationStats(): Promise<{ total: number, warnings: number, blocked: number, recentResets: number }>

// Bulk reset multiple users
bulkResetViolations(userIds: string[], resetRequest: ViolationResetRequest, adminUserId: string): Promise<{ successful: number, failed: number }>
```

### Cloud Function Calls

```javascript
// Student app calls
firebase.functions().httpsCallable('checkViolationResetStatus')
firebase.functions().httpsCallable('recordScreenshotViolation')
firebase.functions().httpsCallable('acknowledgeViolationReset')
```

## Security Considerations

### Access Control
- Only admins can view violation management
- Users can only see their own violations
- All reset actions are logged with admin ID

### Audit Trail
- Complete history of all resets
- Admin who performed reset
- Reason and notes for reset
- Timestamps for all actions

### Privacy
- Minimal data collection (no screenshots stored)
- Only violation counts and timestamps
- User data anonymized in logs

## Testing

### Test Scenarios
1. **First Violation**: Warning shown, access continues
2. **Second Violation**: Access blocked permanently
3. **Admin Reset**: User regains immediate access
4. **Acknowledgment**: Reset status cleared after user sees restoration

### Test Data
```javascript
// Create test violation
await recordViolation('testUserId', false); // First violation
await recordViolation('testUserId', true);  // Second violation (blocked)

// Test reset
await resetUserViolations('testUserId', {
  reason: 'false_positive',
  notes: 'Testing reset functionality'
}, 'adminUserId');
```

## Monitoring

### Admin Dashboard Metrics
- Total users with violations
- Active warnings vs blocks
- Recent resets (7 days)
- Violation trends

### Alerts
- High violation counts
- Repeated resets for same user
- System errors in violation recording

## Deployment Checklist

### Admin App
- [x] TypeScript types defined
- [x] Service functions implemented
- [x] Dashboard components created
- [x] Navigation added
- [x] Firestore rules updated
- [x] Routes configured

### Cloud Functions
- [x] Violation functions implemented
- [x] Functions exported in index.js
- [x] Error handling added
- [x] Authentication checks in place

### Student App (Required)
- [ ] Screenshot detection integration
- [ ] Reset checking on startup
- [ ] Reset checking on app resume
- [ ] Violation recording
- [ ] Reset acknowledgment

### Database
- [x] Firestore collection structure
- [x] Security rules deployed
- [x] Indexes created (if needed)

## Support Workflow

### When Users Report Being Blocked
1. **Verify User Identity**: Confirm user details
2. **Check Violation History**: Review violation timeline
3. **Investigate Reason**: Determine if reset is warranted
4. **Reset if Appropriate**: Use admin dashboard to reset
5. **Document Decision**: Add notes explaining the reset
6. **Follow Up**: Confirm user has regained access

### Escalation Process
- Repeated violations after reset → Security review
- Technical issues → Development team
- Policy questions → Management approval

## Future Enhancements

### Potential Features
- Configurable violation thresholds
- Different violation types (screenshot vs screen recording)
- Temporary timeouts instead of permanent blocks
- User appeal process
- Automated false positive detection
- Integration with payment system (block renewals)

### Analytics Integration
- Violation trends by user segment
- Geographic patterns
- Device-specific issues
- Content correlation with violations

---

**Last Updated**: Current Date
**Version**: 1.0
**Maintained By**: Admin Development Team
