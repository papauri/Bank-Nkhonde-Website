# Comprehensive Profile System - Complete Guide

## Overview
The profile system ensures all vital member information is captured, including mandatory and optional fields. New admins must complete their profile first, and all members can have profile pictures displayed throughout the app.

## Features

### ✅ Profile Completion for New Admins
- **Automatic Redirect**: After registration, admins are redirected to complete their profile
- **Comprehensive Form**: All vital information fields are captured
- **Profile Picture Upload**: Upload and display profile pictures
- **One-Time Setup**: Profile completion is tracked to prevent skipping

### ✅ Comprehensive Member Information
When creating a new member, the following information is captured:

#### Personal Information (Mandatory)
- Full Name *
- Phone Number *
- WhatsApp Number (defaults to phone if not provided)
- Address *
- Date of Birth (optional)
- Gender (optional)

#### Professional Information (Mandatory)
- Career/Profession *
- Job Title (optional)
- Workplace/Employer (optional)
- Work Address (optional)

#### Guarantor Information (Mandatory)
- Guarantor Full Name *
- Guarantor Phone *
- Relationship * (Spouse, Parent, Sibling, Relative, Friend, Colleague, Other)
- Guarantor Address (optional)

#### Security Information (Optional)
- ID Type (National ID, Passport, Driver's License, Other)
- ID Number
- Emergency Contact Name
- Emergency Contact Phone

#### Additional Information
- Email Address * (for account creation)
- Role (Member or Admin)
- Collateral Description (optional)
- Additional Notes (optional)
- Profile Picture (optional, but recommended)

### ✅ Profile Picture System
- **Upload**: Members can upload profile pictures during creation
- **Storage**: Pictures stored in Firebase Storage at `profile-pictures/{userId}/{timestamp}_{filename}`
- **Display**: Profile pictures displayed as round icons throughout the app
- **Fallback**: If no picture, initials are displayed in a colored circle
- **Size Limit**: Maximum 5MB per image
- **Formats**: JPG, PNG supported

## Database Structure

### User Document (`users/{userId}`)
```javascript
{
  uid: string,
  email: string,
  fullName: string,
  phone: string,
  whatsappNumber: string,
  address: string,
  dateOfBirth: string | null,
  gender: string | null,
  career: string,
  jobTitle: string | null,
  workplace: string | null,
  workAddress: string | null,
  guarantorName: string,
  guarantorPhone: string,
  guarantorRelationship: string,
  guarantorAddress: string | null,
  idType: string | null,
  idNumber: string | null,
  emergencyContact: string | null,
  emergencyContactPhone: string | null,
  profileImageUrl: string,
  profileCompleted: boolean,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  groupMemberships: [...]
}
```

### Member Document (`groups/{groupId}/members/{userId}`)
Same structure as user document, plus:
```javascript
{
  // ... all user fields ...
  role: string,
  collateral: string | null,
  notes: string | null,
  joinedAt: Timestamp,
  addedBy: string,
  status: string,
  financialSummary: {...}
}
```

## User Flow

### New Admin Registration
1. Admin registers group → Account created
2. **Redirected to Profile Completion page**
3. Admin fills out comprehensive profile form
4. Profile picture uploaded (optional)
5. Profile marked as `profileCompleted: true`
6. Redirected to Admin Dashboard

### Adding New Members
1. Admin goes to Manage Members
2. Clicks "Add New Member"
3. **Comprehensive form opens** with all fields
4. Admin fills in:
   - Profile picture (optional)
   - Personal information (mandatory fields marked with *)
   - Professional information
   - Guarantor information (required)
   - Security information (optional)
   - Additional information
5. Member account created with temporary password
6. Member receives verification email
7. Member can log in and complete their profile if needed

## Profile Picture Display

### Where Profile Pictures Appear
1. **Member Cards** (Manage Members page)
   - Round icon (50px) with border
   - Falls back to initials if no picture

2. **User Dashboard**
   - Profile section shows user's own picture
   - Group members list shows member pictures

3. **Group Pages**
   - Member listings show profile pictures

4. **Notifications**
   - Sender profile pictures in notification cards

### Profile Picture Styling
- **Size**: 50px × 50px (member cards), 100px × 100px (profile section)
- **Shape**: Perfect circle (border-radius: 50%)
- **Border**: 2px solid primary color
- **Object Fit**: Cover (maintains aspect ratio)
- **Fallback**: Colored circle with initials

## Profile Completion Check

### Admin Dashboard
- Checks `profileCompleted` field on load
- If `false`, redirects to `complete_profile.html`
- Prevents access to dashboard until profile is complete

### User Dashboard
- Shows profile picture or initials
- Displays all profile information
- Allows profile editing (if implemented)

## Form Validation

### Mandatory Fields
- Full Name
- Phone Number
- Address
- Career/Profession
- Guarantor Name
- Guarantor Phone
- Guarantor Relationship
- Email Address

### Optional Fields
- All other fields are optional but recommended
- Profile picture is optional but highly recommended

## File Structure

### New Files Created
- `pages/complete_profile.html` - Profile completion page for new admins
- `scripts/complete_profile.js` - Profile completion logic
- `PROFILE_SYSTEM.md` - This documentation

### Modified Files
- `pages/manage_members.html` - Updated member creation form with all fields
- `scripts/manage_members_new.js` - Updated to handle all fields and profile pictures
- `scripts/registration.js` - Redirects to profile completion after registration
- `scripts/admin_dashboard.js` - Checks profile completion status
- `scripts/user_dashboard.js` - Displays profile pictures

## Security Considerations

1. **Profile Picture Upload**
   - File size validation (max 5MB)
   - File type validation (images only)
   - Stored in Firebase Storage with user-specific paths

2. **Data Privacy**
   - All personal information stored securely in Firestore
   - Profile pictures are publicly accessible (consider adding authentication rules)

3. **Profile Completion**
   - Prevents incomplete profiles from accessing certain features
   - Ensures data quality and completeness

## Future Enhancements

- [ ] Profile editing page for existing members
- [ ] Profile picture cropping/editing tool
- [ ] Profile picture compression before upload
- [ ] Profile completion progress indicator
- [ ] Bulk profile import
- [ ] Profile export functionality
- [ ] Profile picture privacy settings
- [ ] Profile verification badges

## Troubleshooting

### Profile picture not uploading?
1. Check file size (must be < 5MB)
2. Check file type (must be image)
3. Check Firebase Storage rules
4. Check browser console for errors

### Profile completion not working?
1. Check `profileCompleted` field in user document
2. Verify redirect logic in `admin_dashboard.js`
3. Check form validation

### Member information not saving?
1. Check all mandatory fields are filled
2. Check Firestore write permissions
3. Review browser console for errors
4. Verify form data collection in `manage_members_new.js`
