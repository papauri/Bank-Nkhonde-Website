# Notification/Broadcast System - Complete Guide

## Overview
The notification system allows admins to send broadcasts to group members and enables users to receive and reply to notifications on their dashboard.

## Features

### ✅ Admin Features
- **Quick Templates**: Pre-filled notification templates for common scenarios
  - Payment Reminder
  - Meeting Announcement
  - Loan Available
  - Payment Confirmed
  - Custom Message
- **Broadcast to Group**: Send notifications to all members of a selected group
- **Custom Messages**: Create custom notifications with titles and messages
- **Notification Types**: Info, Warning, Urgent, Success
- **Reply Control**: Toggle whether members can reply to notifications
- **Recent Broadcasts**: View history of sent broadcasts

### ✅ User Features
- **Notification Display**: See all unread notifications on dashboard
- **Unread Badge**: Visual indicator of unread notification count
- **Real-time Updates**: Notifications appear instantly when sent
- **Mark as Read**: Click notification to mark as read
- **Reply Functionality**: Reply to notifications (if enabled by admin)
- **Notification Types**: Color-coded badges (info, warning, urgent, success)

## Database Structure

### Notifications Collection
Path: `groups/{groupId}/notifications/{notificationId}`

```javascript
{
  notificationId: string,
  groupId: string,
  groupName: string,
  recipientId: string,  // User ID of recipient
  senderId: string,    // Admin user ID or 'system'
  senderName: string,
  senderEmail: string,
  title: string,
  message: string,
  type: 'info' | 'warning' | 'urgent' | 'success',
  allowReplies: boolean,
  read: boolean,
  readAt: Timestamp (optional),
  isAutomated: boolean,
  createdAt: Timestamp,
  replies: [
    {
      replyId: string,
      senderId: string,
      senderName: string,
      senderEmail: string,
      message: string,
      createdAt: Timestamp
    }
  ]
}
```

### Broadcasts Collection
Path: `groups/{groupId}/broadcasts/{broadcastId}`

```javascript
{
  broadcastId: string,
  groupId: string,
  groupName: string,
  senderId: string,
  senderName: string,
  title: string,
  message: string,
  type: string,
  allowReplies: boolean,
  recipientsCount: number,
  isAutomated: boolean,
  createdAt: Timestamp
}
```

## Usage

### Admin: Send Broadcast

1. Go to **Admin Dashboard** → **Broadcast Messages**
2. Choose a **Quick Template** or create a **Custom Message**
3. Select the **Group** to broadcast to
4. Enter **Title** and **Message**
5. Choose **Notification Type**
6. Toggle **Allow Replies** if you want members to respond
7. Click **Send Broadcast**

### User: View Notifications

1. Go to **User Dashboard**
2. View notifications in the **Notifications** section
3. Click a notification to mark it as read
4. Click **Reply** button (if enabled) to respond

### Automated Notifications

The system includes automated notification functions:

#### Payment Reminders
```javascript
import { sendPaymentReminders } from './scripts/automated_notifications.js';

// Send reminders 3 days before payment is due
await sendPaymentReminders(groupId, 3);
```

#### Meeting Announcements
```javascript
import { sendMeetingAnnouncement } from './scripts/automated_notifications.js';

await sendMeetingAnnouncement(
  groupId,
  'January 15, 2024',
  '2:00 PM',
  'Community Center',
  'Monthly group meeting to discuss contributions'
);
```

## Quick Templates

### 1. Payment Reminder
- **Type**: Warning
- **Purpose**: Remind members about upcoming payments
- **Auto-filled**: Title and message about payment deadlines

### 2. Meeting Announcement
- **Type**: Info
- **Purpose**: Announce group meetings
- **Auto-filled**: Meeting announcement template

### 3. Loan Available
- **Type**: Info
- **Purpose**: Notify about available loans
- **Auto-filled**: Loan opportunity message

### 4. Payment Confirmed
- **Type**: Success
- **Purpose**: Confirm payment receipt
- **Auto-filled**: Payment confirmation message

### 5. Custom Message
- **Type**: Info (can be changed)
- **Purpose**: Send any custom message
- **Auto-filled**: Empty (admin fills in)

## Notification Types

- **Info** (Blue): General information
- **Warning** (Yellow): Important reminders (e.g., payment due)
- **Urgent** (Red): Critical messages requiring immediate attention
- **Success** (Green): Positive confirmations (e.g., payment received)

## Reply System

When `allowReplies` is enabled:
1. Users see a **Reply** button on the notification
2. Clicking **Reply** opens a prompt to enter message
3. Reply is saved to the notification's `replies` array
4. Admin can view replies in the notification document

## Real-time Updates

- Notifications appear instantly on user dashboard when sent
- Uses Firestore `onSnapshot` for real-time listening
- Unread badge updates automatically
- No page refresh needed

## Styling

Notifications use the unified design system:
- Unread notifications have a green left border
- Color-coded badges for notification types
- Responsive design for mobile
- Smooth animations and transitions

## Security

- Only admins can send broadcasts
- Users can only see their own notifications
- Replies are stored securely in Firestore
- Real-time listeners are scoped to user's groups

## Future Enhancements

- Email notifications (integrate with email service)
- Push notifications for mobile
- Notification preferences (user can choose what to receive)
- Notification history (view all notifications, not just unread)
- Admin view of replies
- Scheduled notifications
- Notification templates management

## Troubleshooting

### Notifications not appearing?
1. Check that user is a member of the group
2. Verify notification was created in Firestore
3. Check browser console for errors
4. Ensure real-time listener is set up

### Replies not working?
1. Verify `allowReplies` is set to `true`
2. Check Firestore permissions
3. Verify user is authenticated

### Broadcast not sending?
1. Check admin permissions
2. Verify group has members
3. Check Firestore write permissions
4. Review browser console for errors
