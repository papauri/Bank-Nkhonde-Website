import { 
    db, auth, createUserWithEmailAndPassword, 
    doc, setDoc, updateDoc, collection, getDoc, 
    getDocs, deleteDoc, Timestamp, sendEmailVerification,
    onAuthStateChanged, storage, ref, uploadBytes, getDownloadURL
} from "./firebaseConfig.js";
import { updatePaymentsForNewMember } from "./updatePayments.js";

// ✅ Get DOM elements safely
let memberList = null;
let addMemberForm = null;
let editMemberModal = null;
let editMemberForm = null;
let paymentModal = null;
let confirmPaymentButton = null;
let cancelPaymentButton = null;
let groupId = null;
let currentUser = null;

// ✅ Payment Input Fields
let paymentSeedMoney = null;
let paymentMonthlyContribution = null;
let paymentLoanPenalty = null;
let paymentMonthlyPenalty = null;

let newMemberData = null;
let groupPaymentSettings = {};
let groupData = null;

// ✅ Initialize on DOM ready
document.addEventListener("DOMContentLoaded", async () => {
    // Get elements
    memberList = document.getElementById("membersList");
    addMemberForm = document.getElementById("addMemberForm");
    editMemberModal = document.getElementById("editMemberModal");
    editMemberForm = document.getElementById("editMemberForm");
    paymentModal = document.getElementById("paymentModal");
    confirmPaymentButton = document.getElementById("confirmPaymentButton");
    cancelPaymentButton = document.getElementById("cancelPaymentButton");
    
    paymentSeedMoney = document.getElementById("paymentSeedMoney");
    paymentMonthlyContribution = document.getElementById("paymentMonthlyContribution");
    paymentLoanPenalty = document.getElementById("paymentLoanPenalty");
    paymentMonthlyPenalty = document.getElementById("paymentMonthlyPenalty");

    // ✅ Get groupId from URL or sessionStorage
    const urlParams = new URLSearchParams(window.location.search);
    groupId = urlParams.get("groupId") || sessionStorage.getItem('selectedGroupId');

    if (!groupId) {
        alert("Group ID is missing. Redirecting...");
        window.location.href = "admin_dashboard.html";
        return;
    }

    // Update URL with groupId
    if (!urlParams.get("groupId")) {
        const url = new URL(window.location.href);
        url.searchParams.set('groupId', groupId);
        window.history.replaceState({}, '', url);
    }

    // Check auth
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = "../login.html";
            return;
        }
        currentUser = user;
        await initializePage();
    });
});

// ✅ Initialize page
async function initializePage() {
    // Fetch group data
    await fetchGroupPaymentSettings();
    await loadMembers();
    
    // Setup form handlers
    setupFormHandlers();
}

// ✅ Fetch Group Payment Settings
async function fetchGroupPaymentSettings() {
    try {
        const groupRef = doc(db, "groups", groupId);
        const groupSnap = await getDoc(groupRef);

        if (groupSnap.exists()) {
            groupData = { id: groupSnap.id, ...groupSnap.data() };
            groupPaymentSettings = groupData;

            const seedMoney = groupPaymentSettings.rules?.seedMoney?.amount ?? groupPaymentSettings.seedMoney ?? 0;
            const monthlyContribution = groupPaymentSettings.rules?.monthlyContribution?.amount ?? groupPaymentSettings.monthlyContribution ?? 0;
            const loanPenalty = groupPaymentSettings.rules?.loanPenalty?.rate ?? groupPaymentSettings.loanPenalty ?? 0;
            const monthlyPenalty = groupPaymentSettings.rules?.monthlyPenalty?.rate ?? groupPaymentSettings.monthlyPenalty ?? 0;

            if (paymentSeedMoney) paymentSeedMoney.value = seedMoney;
            if (paymentMonthlyContribution) paymentMonthlyContribution.value = monthlyContribution;
            if (paymentLoanPenalty) paymentLoanPenalty.value = loanPenalty;
            if (paymentMonthlyPenalty) paymentMonthlyPenalty.value = monthlyPenalty;
        }
    } catch (error) {
        console.error("Error fetching group settings:", error);
    }
}

// ✅ Load Members from Firestore (including admin)
async function loadMembers() {
    if (!memberList) return;
    
    memberList.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
            <div class="empty-state-icon">👥</div>
            <p class="empty-state-text">Loading members...</p>
        </div>
    `;

    try {
        // Always ensure groupData is loaded first
        if (!groupData) {
            try {
                const groupRef = doc(db, "groups", groupId);
                const groupSnap = await getDoc(groupRef);
                if (groupSnap.exists()) {
                    groupData = { id: groupSnap.id, ...groupSnap.data() };
                } else {
                    console.error("Group not found:", groupId);
                    memberList.innerHTML = `
                        <div class="empty-state" style="grid-column: 1 / -1;">
                            <div class="empty-state-icon">❌</div>
                            <p class="empty-state-text">Group not found</p>
                        </div>
                    `;
                    return;
                }
            } catch (e) {
                console.error("Error loading group data:", e);
                memberList.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <div class="empty-state-icon">❌</div>
                        <p class="empty-state-text">Error loading group: ${e.message}</p>
                    </div>
                `;
                return;
            }
        }

        const membersRef = collection(db, `groups/${groupId}/members`);
        const querySnapshot = await getDocs(membersRef);

        const members = [];
        
        // Get all members from subcollection
        querySnapshot.forEach((docSnapshot) => {
            const member = docSnapshot.data();
            members.push({
                id: docSnapshot.id,
                ...member
            });
        });

        // ALWAYS ensure admins are included in members list
        const createdBy = groupData.createdBy;
        const admins = groupData.admins || [];
        const adminIds = new Set();
        
        // Collect all admin IDs
        if (createdBy) adminIds.add(createdBy);
        admins.forEach(a => {
            if (a && (a.uid || typeof a === 'string')) {
                adminIds.add(a.uid || a);
            }
        });
        
        // Add all admins who are not already in members list
        for (const adminId of adminIds) {
            if (!adminId) continue; // Skip invalid IDs
            
            const adminInMembers = members.find(m => m.id === adminId || m.uid === adminId);
            
            if (!adminInMembers) {
                // Try to get admin from members collection first
                try {
                    const adminMemberDoc = await getDoc(doc(db, `groups/${groupId}/members`, adminId));
                    if (adminMemberDoc.exists()) {
                        const adminData = adminMemberDoc.data();
                        members.unshift({
                            id: adminId,
                            ...adminData,
                            role: adminData.role || (createdBy === adminId ? 'senior_admin' : 'admin')
                        });
                        continue;
                    }
                } catch (e) {
                    console.log("Admin not in members collection, trying users collection");
                }
                
                // If not in members collection, get from users collection
                try {
                    const userDoc = await getDoc(doc(db, "users", adminId));
                    if (userDoc.exists()) {
                        const userData = userDoc.data();
                        members.unshift({
                            id: adminId,
                            uid: adminId,
                            fullName: userData.fullName || userData.name || "Admin",
                            email: userData.email || "",
                            phone: userData.phone || userData.phoneNumber || "",
                            whatsappNumber: userData.whatsappNumber || "",
                            profileImageUrl: userData.profileImageUrl || "",
                            ...userData,
                            role: createdBy === adminId ? 'senior_admin' : 'admin',
                            joinedAt: groupData.createdAt || Timestamp.now(),
                            status: 'active'
                        });
                    } else {
                        // If user doesn't exist in users collection, create a basic admin entry
                        console.warn("Admin user not found in users collection, creating basic entry:", adminId);
                        members.unshift({
                            id: adminId,
                            uid: adminId,
                            fullName: "Admin",
                            email: "",
                            phone: "",
                            role: createdBy === adminId ? 'senior_admin' : 'admin',
                            joinedAt: groupData.createdAt || Timestamp.now(),
                            status: 'active'
                        });
                    }
                } catch (e) {
                    console.error("Error loading admin user:", e);
                    // Even if there's an error, create a basic admin entry
                    members.unshift({
                        id: adminId,
                        uid: adminId,
                        fullName: "Admin",
                        email: "",
                        phone: "",
                        role: createdBy === adminId ? 'senior_admin' : 'admin',
                        joinedAt: groupData.createdAt || Timestamp.now(),
                        status: 'active'
                    });
                }
            } else {
                // Admin is already in members, but ensure role is set correctly
                const adminIndex = members.findIndex(m => (m.id === adminId || m.uid === adminId));
                if (adminIndex >= 0) {
                    if (!members[adminIndex].role) {
                        members[adminIndex].role = createdBy === adminId ? 'senior_admin' : 'admin';
                    }
                }
            }
        }

        // Fallback: If no members found and we have a current user, add them as admin
        if (members.length === 0 && currentUser && groupData) {
            console.warn("No members found, adding current user as admin");
            try {
                const userDoc = await getDoc(doc(db, "users", currentUser.uid));
                const userData = userDoc.exists() ? userDoc.data() : {};
                
                members.push({
                    id: currentUser.uid,
                    uid: currentUser.uid,
                    fullName: userData.fullName || userData.name || currentUser.displayName || "Admin",
                    email: currentUser.email || userData.email || "",
                    phone: userData.phone || userData.phoneNumber || "",
                    whatsappNumber: userData.whatsappNumber || "",
                    profileImageUrl: userData.profileImageUrl || currentUser.photoURL || "",
                    role: (groupData.createdBy === currentUser.uid) ? 'senior_admin' : 'admin',
                    joinedAt: groupData.createdAt || Timestamp.now(),
                    status: 'active',
                    ...userData
                });
            } catch (e) {
                console.error("Error adding current user as admin:", e);
                // Still add basic entry
                members.push({
                    id: currentUser.uid,
                    uid: currentUser.uid,
                    fullName: currentUser.displayName || "Admin",
                    email: currentUser.email || "",
                    phone: "",
                    role: (groupData.createdBy === currentUser.uid) ? 'senior_admin' : 'admin',
                    joinedAt: groupData.createdAt || Timestamp.now(),
                    status: 'active'
                });
            }
        }

        // Sort: admins first, then by name
        members.sort((a, b) => {
            const aIsAdmin = a.role === 'admin' || a.role === 'senior_admin';
            const bIsAdmin = b.role === 'admin' || b.role === 'senior_admin';
            if (aIsAdmin && !bIsAdmin) return -1;
            if (!aIsAdmin && bIsAdmin) return 1;
            return (a.fullName || '').localeCompare(b.fullName || '');
        });

        // Store members globally for filtering
        window.allMembers = members;

        // Render member cards
        renderMembers(members);

        // Apply current filter
        const activeFilter = document.querySelector('.filter-tab.active')?.getAttribute('data-filter') || 'all';
        filterMembers(activeFilter);

    } catch (error) {
        console.error("Error loading members:", error);
        memberList.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">❌</div>
                <p class="empty-state-text">Error loading members: ${error.message}</p>
            </div>
        `;
    }
}

// ✅ Render members list
function renderMembers(members) {
    if (!memberList) return;
    
    if (members.length === 0) {
        memberList.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">👥</div>
                <p class="empty-state-text">No members found</p>
            </div>
        `;
        return;
    }

    memberList.innerHTML = members.map(member => {
        const isAdmin = member.role === 'admin' || member.role === 'senior_admin';
        const roleLabel = isAdmin ? (member.role === 'senior_admin' ? 'Senior Admin' : 'Admin') : 'Member';
        const initials = getInitials(member.fullName);
        const avatarContent = member.profileImageUrl 
            ? `<img src="${member.profileImageUrl}" alt="${member.fullName}">`
            : initials;

        return `
            <div class="member-card">
                <div class="member-card-header">
                    <div class="member-avatar">${avatarContent}</div>
                    <div class="member-info">
                        <div class="member-name">${member.fullName || 'Unknown'}</div>
                        <span class="member-role ${isAdmin ? 'admin' : 'member'}">${roleLabel}</span>
                    </div>
                </div>
                <div class="member-card-body">
                    <div class="member-details-grid">
                        <div class="member-detail">
                            <span class="member-detail-label">📧 Email</span>
                            <span class="member-detail-value">${member.email || 'N/A'}</span>
                        </div>
                        <div class="member-detail">
                            <span class="member-detail-label">📞 Phone</span>
                            <span class="member-detail-value">${member.phone || 'N/A'}</span>
                        </div>
                        ${member.whatsappNumber ? `
                        <div class="member-detail">
                            <span class="member-detail-label">💬 WhatsApp</span>
                            <span class="member-detail-value">${member.whatsappNumber}</span>
                        </div>
                        ` : ''}
                        ${member.career ? `
                        <div class="member-detail">
                            <span class="member-detail-label">💼 Career</span>
                            <span class="member-detail-value">${member.career}</span>
                        </div>
                        ` : ''}
                    </div>
                    ${(member.bankName || member.accountNumber) ? `
                    <div class="member-details-grid" style="margin-top: var(--bn-space-3); padding-top: var(--bn-space-3); border-top: 1px solid var(--bn-gray-lighter);">
                        <h4 style="grid-column: 1 / -1; font-size: var(--bn-text-sm); font-weight: 700; color: var(--bn-dark); margin-bottom: var(--bn-space-2);">🏦 Bank Account Details</h4>
                        ${member.bankName ? `
                        <div class="member-detail">
                            <span class="member-detail-label">Bank Name</span>
                            <span class="member-detail-value">${member.bankName}</span>
                        </div>
                        ` : ''}
                        ${member.accountNumber ? `
                        <div class="member-detail">
                            <span class="member-detail-label">Account Number</span>
                            <span class="member-detail-value" style="font-family: monospace;">****${member.accountNumber.slice(-4)}</span>
                        </div>
                        ` : ''}
                        ${member.accountHolderName ? `
                        <div class="member-detail">
                            <span class="member-detail-label">Account Holder</span>
                            <span class="member-detail-value">${member.accountHolderName}</span>
                        </div>
                        ` : ''}
                        ${member.branchName ? `
                        <div class="member-detail">
                            <span class="member-detail-label">Branch</span>
                            <span class="member-detail-value">${member.branchName}</span>
                        </div>
                        ` : ''}
                        ${member.accountType ? `
                        <div class="member-detail">
                            <span class="member-detail-label">Account Type</span>
                            <span class="member-detail-value">${member.accountType === 'savings' ? 'Savings' : member.accountType === 'current' ? 'Current' : member.accountType === 'checking' ? 'Checking' : member.accountType}</span>
                        </div>
                        ` : ''}
                        ${member.bankAccountChanged ? `
                        <div class="member-detail" style="grid-column: 1 / -1;">
                            <span class="member-detail-label" style="color: var(--bn-warning);">⚠️ Recently Updated</span>
                            <span class="member-detail-value" style="color: var(--bn-warning); font-size: var(--bn-text-xs);">Bank account details were recently changed</span>
                        </div>
                        ` : ''}
                    </div>
                    ` : ''}
                </div>
                <div class="member-card-footer">
                    <button class="btn btn-ghost btn-sm edit-member-btn" 
                            data-id="${member.id}"
                            data-name="${member.fullName || ''}"
                            data-email="${member.email || ''}"
                            data-phone="${member.phone || ''}"
                            data-whatsapp="${member.whatsappNumber || member.phone || ''}"
                            data-address="${member.address || ''}"
                            data-workplace="${member.workplace || ''}"
                            data-career="${member.career || ''}"
                            data-guarantor="${member.guarantorName || member.guarantor || ''}"
                            data-guarantor-phone="${member.guarantorPhone || ''}"
                            data-role="${member.role || 'member'}"
                            data-collateral="${member.collateral || ''}"
                            data-dob="${member.dateOfBirth || ''}"
                            data-gender="${member.gender || ''}">
                        ✏️ Edit
                    </button>
                    ${!isAdmin || (window.allMembers || []).filter(m => m.role === 'admin' || m.role === 'senior_admin').length > 1 ? `
                    <button class="btn btn-danger btn-sm remove-member-btn" data-id="${member.id}">
                        🗑️ Remove
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Re-attach event listeners
    attachMemberEventListeners();
}

// ✅ Filter members by role and search term
function filterMembers(filter = 'all', searchTerm = '') {
    if (!window.allMembers) return;
    
    let filtered = [...window.allMembers];
    
    // Apply role filter
    if (filter === 'admin') {
        filtered = filtered.filter(m => m.role === 'admin' || m.role === 'senior_admin');
    } else if (filter === 'member') {
        // Members tab should show ALL members including admins (they are also members)
        // But if you want to exclude admins, uncomment the line below
        // filtered = filtered.filter(m => m.role !== 'admin' && m.role !== 'senior_admin');
    }
    // 'all' shows everyone, no filtering needed
    
    // Apply search filter
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(m => {
            const name = (m.fullName || '').toLowerCase();
            const email = (m.email || '').toLowerCase();
            const phone = (m.phone || '').toLowerCase();
            return name.includes(term) || email.includes(term) || phone.includes(term);
        });
    }
    
    // Render filtered members
    renderMembers(filtered);
}

// ✅ Attach event listeners for edit and remove buttons using event delegation
function attachMemberEventListeners() {
    // Use event delegation on document for better reliability (handles dynamic content)
    // Remove existing listener if any
    const clickHandler = async (e) => {
        // Handle edit button clicks
        const editBtn = e.target.closest(".edit-member-btn");
        if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            const memberId = editBtn.getAttribute("data-id");
            console.log("Edit button clicked", memberId);
            if (memberId) {
                await openEditModal(editBtn);
            }
            return false;
        }
        
        // Handle remove button clicks
        const removeBtn = e.target.closest(".remove-member-btn");
        if (removeBtn) {
            e.preventDefault();
            e.stopPropagation();
            const memberId = removeBtn.getAttribute("data-id");
            if (memberId) {
                await confirmAndRemoveMember(memberId);
            }
            return false;
        }
    };
    
    // Remove old listener if it exists
    if (window._memberClickHandler) {
        document.removeEventListener("click", window._memberClickHandler);
    }
    
    // Store reference and add new listener
    window._memberClickHandler = clickHandler;
    document.addEventListener("click", clickHandler, true); // Use capture phase
}

// ✅ Open edit modal - Load full member data
async function openEditModal(button) {
    console.log("openEditModal called", button);
    
    // Ensure editMemberModal is found
    if (!editMemberModal) {
        editMemberModal = document.getElementById("editMemberModal");
        if (!editMemberModal) {
            console.error("Edit member modal not found in DOM");
            alert("Edit modal not found. Please refresh the page.");
            return;
        }
    }

    const memberId = button.getAttribute("data-id") || button.dataset.id || (button.nodeType === 1 ? button.getAttribute("data-id") : null);
    if (!memberId) {
        console.error("Member ID not found on button", button);
        alert("Member ID not found. Please try again.");
        return;
    }
    
    console.log("Opening edit modal for member:", memberId);
    
    try {
        // Ensure groupData is loaded
        if (!groupData) {
            const groupRef = doc(db, "groups", groupId);
            const groupSnap = await getDoc(groupRef);
            if (groupSnap.exists()) {
                groupData = { id: groupSnap.id, ...groupSnap.data() };
            }
        }
        
        // Fetch full member data from Firestore
        const memberRef = doc(db, `groups/${groupId}/members`, memberId);
        const memberDoc = await getDoc(memberRef);
        
        let memberData = {};
        
        // First try to get from members collection
        if (memberDoc.exists()) {
            memberData = { ...memberDoc.data(), id: memberDoc.id };
        } else {
            // If not in members collection, try users collection (for admins)
            const userRef = doc(db, "users", memberId);
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
                memberData = { ...userDoc.data(), id: userDoc.id };
            } else {
                // If still not found, try to get from current members list
                const memberFromList = (window.allMembers || []).find(m => m.id === memberId);
                if (memberFromList) {
                    memberData = memberFromList;
                } else {
                    throw new Error('Member not found');
                }
            }
        }
        
        // Populate edit form fields with all member data
        const formFieldsContainer = document.getElementById("editFormFields");
        if (formFieldsContainer) {
            formFieldsContainer.innerHTML = `
                <!-- Personal Information -->
                <div class="form-section">
                    <h4 class="form-section-title">Personal Information</h4>
                    <div class="form-group">
                        <label class="form-label">Full Name *</label>
                        <input type="text" class="form-input" id="editFullName" value="${memberData.fullName || ''}" required>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Phone Number *</label>
                            <input type="tel" class="form-input" id="editPhone" value="${memberData.phone || ''}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">WhatsApp</label>
                            <input type="tel" class="form-input" id="editWhatsappNumber" value="${memberData.whatsappNumber || memberData.phone || ''}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Date of Birth</label>
                            <input type="date" class="form-input" id="editDOB" value="${memberData.dateOfBirth || ''}">
                            <span class="help-text" style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: var(--bn-space-1); display: block;">
                              Member must be at least 18 years old
                            </span>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Gender</label>
                            <select class="form-select" id="editGender">
                                <option value="">Select...</option>
                                <option value="male" ${memberData.gender === 'male' ? 'selected' : ''}>Male</option>
                                <option value="female" ${memberData.gender === 'female' ? 'selected' : ''}>Female</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Address</label>
                        <textarea class="form-textarea" id="editAddress" rows="2">${memberData.address || ''}</textarea>
                    </div>
                </div>

                <!-- Professional Information -->
                <div class="form-section">
                    <h4 class="form-section-title">Professional Information</h4>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Career/Profession</label>
                            <input type="text" class="form-input" id="editCareer" value="${memberData.career || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Job Title</label>
                            <input type="text" class="form-input" id="editJobTitle" value="${memberData.jobTitle || ''}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Workplace</label>
                            <input type="text" class="form-input" id="editWorkplace" value="${memberData.workplace || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Work Address</label>
                            <input type="text" class="form-input" id="editWorkAddress" value="${memberData.workAddress || ''}">
                        </div>
                    </div>
                </div>

                <!-- Guarantor Information -->
                <div class="form-section">
                    <h4 class="form-section-title">Guarantor Information</h4>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Guarantor Name</label>
                            <input type="text" class="form-input" id="editGuarantor" value="${memberData.guarantorName || memberData.guarantor || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Guarantor Phone</label>
                            <input type="tel" class="form-input" id="editGuarantorPhone" value="${memberData.guarantorPhone || ''}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Relationship</label>
                            <select class="form-select" id="editGuarantorRelationship">
                                <option value="">Select...</option>
                                <option value="spouse" ${memberData.guarantorRelationship === 'spouse' ? 'selected' : ''}>Spouse</option>
                                <option value="parent" ${memberData.guarantorRelationship === 'parent' ? 'selected' : ''}>Parent</option>
                                <option value="sibling" ${memberData.guarantorRelationship === 'sibling' ? 'selected' : ''}>Sibling</option>
                                <option value="relative" ${memberData.guarantorRelationship === 'relative' ? 'selected' : ''}>Relative</option>
                                <option value="friend" ${memberData.guarantorRelationship === 'friend' ? 'selected' : ''}>Friend</option>
                                <option value="colleague" ${memberData.guarantorRelationship === 'colleague' ? 'selected' : ''}>Colleague</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Guarantor Address</label>
                            <input type="text" class="form-input" id="editGuarantorAddress" value="${memberData.guarantorAddress || ''}">
                        </div>
                    </div>
                </div>

                <!-- Security & ID -->
                <div class="form-section">
                    <h4 class="form-section-title">Identification & Security</h4>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">ID Type</label>
                            <select class="form-select" id="editIdType">
                                <option value="">Select...</option>
                                <option value="national_id" ${memberData.idType === 'national_id' ? 'selected' : ''}>National ID</option>
                                <option value="passport" ${memberData.idType === 'passport' ? 'selected' : ''}>Passport</option>
                                <option value="drivers_license" ${memberData.idType === 'drivers_license' ? 'selected' : ''}>Driver's License</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">ID Number</label>
                            <input type="text" class="form-input" id="editIdNumber" value="${memberData.idNumber || ''}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Emergency Contact</label>
                            <input type="text" class="form-input" id="editEmergencyContact" value="${memberData.emergencyContact || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Emergency Phone</label>
                            <input type="tel" class="form-input" id="editEmergencyPhone" value="${memberData.emergencyPhone || ''}">
                        </div>
                    </div>
                </div>

                <!-- Bank Account Details (Read-only for Admin) -->
                <div class="form-section">
                    <h4 class="form-section-title">Bank Account Details</h4>
                    <p style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-bottom: var(--bn-space-3);">
                        ℹ️ Bank account details are managed by the member in their settings. Changes will be visible here automatically.
                    </p>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Bank Name</label>
                            <input type="text" class="form-input" value="${memberData.bankName || 'Not provided'}" disabled style="background: var(--bn-gray-100); color: var(--bn-gray);">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Account Number</label>
                            <input type="text" class="form-input" value="${memberData.accountNumber ? '****' + memberData.accountNumber.slice(-4) : 'Not provided'}" disabled style="background: var(--bn-gray-100); color: var(--bn-gray); font-family: monospace;">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Account Holder Name</label>
                            <input type="text" class="form-input" value="${memberData.accountHolderName || 'Not provided'}" disabled style="background: var(--bn-gray-100); color: var(--bn-gray);">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Branch Name</label>
                            <input type="text" class="form-input" value="${memberData.branchName || 'Not provided'}" disabled style="background: var(--bn-gray-100); color: var(--bn-gray);">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Account Type</label>
                            <input type="text" class="form-input" value="${memberData.accountType ? (memberData.accountType === 'savings' ? 'Savings' : memberData.accountType === 'current' ? 'Current' : memberData.accountType === 'checking' ? 'Checking' : memberData.accountType) : 'Not provided'}" disabled style="background: var(--bn-gray-100); color: var(--bn-gray);">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Swift Code</label>
                            <input type="text" class="form-input" value="${memberData.swiftCode || 'Not provided'}" disabled style="background: var(--bn-gray-100); color: var(--bn-gray);">
                        </div>
                    </div>
                    ${memberData.bankAccountChanged ? `
                    <div style="margin-top: var(--bn-space-3); padding: var(--bn-space-3); background: var(--bn-warning-light); border-left: 3px solid var(--bn-warning); border-radius: var(--bn-radius-md);">
                        <p style="font-size: var(--bn-text-xs); color: var(--bn-warning-dark); margin: 0; font-weight: 600;">
                            ⚠️ Bank account details were recently updated. Please verify before processing payments.
                        </p>
                    </div>
                    ` : ''}
                </div>

                <!-- Account & Collateral -->
                <div class="form-section">
                    <h4 class="form-section-title">Account & Collateral</h4>
                    <div class="form-group">
                        <label class="form-label">Email Address *</label>
                        <input type="email" class="form-input" id="editEmail" value="${memberData.email || ''}" required>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Role</label>
                            ${(() => {
                                const isGroupCreator = memberData.id === (groupData?.createdBy || '');
                                const isSeniorAdmin = memberData.role === 'senior_admin';
                                const canChangeRole = !(isSeniorAdmin && isGroupCreator);
                                
                                return `
                                    <select class="form-select" id="editRole" ${!canChangeRole ? 'disabled' : ''}>
                                        <option value="member" ${(!memberData.role || memberData.role === 'member') ? 'selected' : ''}>Member</option>
                                        <option value="admin" ${memberData.role === 'admin' ? 'selected' : ''}>Admin (Full Permissions)</option>
                                        ${isSeniorAdmin ? `<option value="senior_admin" ${isSeniorAdmin ? 'selected' : ''}>Senior Admin</option>` : ''}
                                    </select>
                                    ${!canChangeRole ? `
                                    <p style="font-size: var(--bn-text-xs); color: var(--bn-warning); margin-top: 4px;">
                                        ⚠️ Senior Admin (Group Creator) role cannot be changed
                                    </p>
                                    ` : memberData.role !== 'senior_admin' ? `
                                    <p style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin-top: 4px;">
                                        💡 Admin role grants full permissions: approve payments, manage loans, add/remove members, manage settings
                                    </p>
                                    ` : ''}
                                `;
                            })()}
                        </div>
                        <div class="form-group">
                            <label class="form-label">Status</label>
                            <select class="form-select" id="editStatus">
                                <option value="active" ${(!memberData.status || memberData.status === 'active') ? 'selected' : ''}>Active</option>
                                <option value="pending" ${memberData.status === 'pending' ? 'selected' : ''}>Pending</option>
                                <option value="inactive" ${memberData.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Collateral Description</label>
                        <textarea class="form-textarea" id="editCollateral" rows="2">${memberData.collateral || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Notes</label>
                        <textarea class="form-textarea" id="editNotes" rows="2">${memberData.notes || ''}</textarea>
                    </div>
                </div>
            `;
        }

        // Update profile preview
        const previewEl = document.getElementById("editMemberProfilePreview");
        if (previewEl) {
            if (memberData.profileImageUrl) {
                previewEl.innerHTML = `<img src="${memberData.profileImageUrl}" alt="${memberData.fullName}">`;
            } else {
                const initials = getInitials(memberData.fullName || '');
                previewEl.innerHTML = initials;
            }
        }

        editMemberModal.dataset.id = memberId;
        editMemberModal.style.display = 'flex';
        editMemberModal.classList.remove('hidden');
        editMemberModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        console.log("Edit modal opened for member:", memberId);
    } catch (error) {
        console.error("Error loading member data:", error);
        alert("Failed to load member data: " + error.message);
    }
}

// ✅ Setup form handlers
function setupFormHandlers() {
    // Add member form
    if (addMemberForm) {
        addMemberForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            await handleAddMember();
        });
    }

    // Edit member form
    if (editMemberForm) {
        editMemberForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            await handleEditMember();
        });
    }
    
    // Close edit modal buttons
    const cancelEditBtn = document.getElementById("cancelEditMember");
    const closeEditBtn = document.getElementById("closeEditMemberModal");
    
    const closeEditModal = () => {
        if (editMemberModal) {
            editMemberModal.style.display = 'none';
            editMemberModal.classList.add('hidden');
            editMemberModal.classList.remove('active');
            document.body.style.overflow = '';
        }
    };
    
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener("click", closeEditModal);
    }
    
    if (closeEditBtn) {
        closeEditBtn.addEventListener("click", closeEditModal);
    }
    
    // Close modal on overlay click
    if (editMemberModal) {
        editMemberModal.addEventListener("click", (e) => {
            if (e.target === editMemberModal) {
                closeEditModal();
            }
        });
    }
    
    // Initialize event listeners for member buttons (using delegation)
    attachMemberEventListeners();

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active state
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Filter members
            const filter = tab.getAttribute('data-filter');
            filterMembers(filter);
        });
    });

    // Search functionality
    const searchInput = document.getElementById('searchMembers');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            filterMembers(null, searchTerm);
        });
    }

    // Payment confirmation
    if (confirmPaymentButton) {
        confirmPaymentButton.addEventListener("click", async () => {
            await handleConfirmPayment();
        });
    }

    // Cancel buttons
    if (cancelPaymentButton) {
        cancelPaymentButton.addEventListener("click", () => {
            if (paymentModal) {
                paymentModal.classList.add('hidden');
                paymentModal.classList.remove('active');
            }
        });
    }

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal-overlay');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });
}

// ✅ Handle add member
async function handleAddMember() {
    const fullName = document.getElementById("memberName")?.value.trim();
    const email = document.getElementById("memberEmail")?.value.trim();
    const phone = document.getElementById("memberPhone")?.value.trim();
    const whatsappNumber = document.getElementById("memberWhatsApp")?.value.trim() || phone;
    const address = document.getElementById("memberAddress")?.value.trim() || "";
    const workplace = document.getElementById("memberWorkplace")?.value.trim() || "";
    const career = document.getElementById("memberCareer")?.value.trim() || "";
    const guarantorName = document.getElementById("memberGuarantorName")?.value.trim() || "";
    const guarantorPhone = document.getElementById("memberGuarantorPhone")?.value.trim() || "";
    const role = document.getElementById("memberRole")?.value || "member";
    const collateral = document.getElementById("memberCollateral")?.value.trim() || null;
    const dateOfBirthInput = document.getElementById("memberDOB");
    const dateOfBirth = dateOfBirthInput?.value || null;
    const gender = document.getElementById("memberGender")?.value || null;
    
    // Validate age if DOB is provided
    if (dateOfBirth && window.DOBValidation) {
      const validation = window.DOBValidation.validateAge(dateOfBirth);
      if (!validation.isValid) {
        alert(validation.error);
        if (dateOfBirthInput) {
          dateOfBirthInput.focus();
          dateOfBirthInput.reportValidity();
        }
        return;
      }
    }

    if (!fullName || !email || !phone) {
        alert("Please fill in all required fields (Name, Email, Phone)");
        return;
    }

    try {
        newMemberData = { 
            fullName, 
            email, 
            phone, 
            whatsappNumber,
            address,
            workplace,
            career,
            guarantorName,
            guarantorPhone,
            role, 
            collateral,
            dateOfBirth,
            gender
        };

        // Show payment modal
        await fetchGroupPaymentSettings();
        if (paymentModal) {
            paymentModal.classList.remove('hidden');
            paymentModal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }

    } catch (error) {
        alert("Error: " + error.message);
    }
}

// ✅ Handle confirm payment and create member
async function handleConfirmPayment() {
    if (!newMemberData) return;

    try {
        // Use Cloud Function or Admin SDK approach instead of signing out
        // For now, we'll use a workaround: create user via invitation code
        
        // Create invitation code for the new member
        const invitationCode = await createInvitationCode(newMemberData.email);
        
        // Store member data temporarily
        const tempMemberRef = doc(db, `groups/${groupId}/pendingMembers`, newMemberData.email);
        await setDoc(tempMemberRef, {
            ...newMemberData,
            invitationCode,
            createdAt: Timestamp.now(),
            paymentSettings: {
                seedMoney: parseFloat(paymentSeedMoney?.value || 0),
                monthlyContribution: parseFloat(paymentMonthlyContribution?.value || 0),
                loanPenalty: parseFloat(paymentLoanPenalty?.value || 0),
                monthlyPenalty: parseFloat(paymentMonthlyPenalty?.value || 0)
            }
        });

        alert(`Member invitation created! Share this code with ${newMemberData.email}: ${invitationCode}\n\nThey can register using this code.`);
        
        // Close modal
        if (paymentModal) {
            paymentModal.classList.add('hidden');
            paymentModal.classList.remove('active');
        }
        if (addMemberForm) addMemberForm.reset();
        newMemberData = null;

    } catch (error) {
        console.error("Error adding member:", error);
        alert("Failed to add member: " + error.message);
    }
}

// ✅ Create invitation code
async function createInvitationCode(email) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const codeRef = doc(db, `groups/${groupId}/invitationCodes`, code);
    await setDoc(codeRef, {
        email,
        code,
        createdAt: Timestamp.now(),
        used: false,
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) // 7 days
    });
    return code;
}

// ✅ Handle edit member - Save all fields
async function handleEditMember() {
    const memberId = editMemberModal?.dataset.id;
    if (!memberId) return;

    const fullName = document.getElementById("editFullName")?.value.trim();
    const email = document.getElementById("editEmail")?.value.trim();
    const phone = document.getElementById("editPhone")?.value.trim();
    const whatsappNumber = document.getElementById("editWhatsappNumber")?.value.trim() || phone;
    const address = document.getElementById("editAddress")?.value.trim() || "";
    const workplace = document.getElementById("editWorkplace")?.value.trim() || "";
    const workAddress = document.getElementById("editWorkAddress")?.value.trim() || "";
    const career = document.getElementById("editCareer")?.value.trim() || "";
    const jobTitle = document.getElementById("editJobTitle")?.value.trim() || "";
    const guarantorName = document.getElementById("editGuarantor")?.value.trim() || "";
    const guarantorPhone = document.getElementById("editGuarantorPhone")?.value.trim() || "";
    const guarantorRelationship = document.getElementById("editGuarantorRelationship")?.value || "";
    const guarantorAddress = document.getElementById("editGuarantorAddress")?.value.trim() || "";
    const idType = document.getElementById("editIdType")?.value || "";
    const idNumber = document.getElementById("editIdNumber")?.value.trim() || "";
    const emergencyContact = document.getElementById("editEmergencyContact")?.value.trim() || "";
    const emergencyPhone = document.getElementById("editEmergencyPhone")?.value.trim() || "";
    const role = document.getElementById("editRole")?.value || "member";
    const status = document.getElementById("editStatus")?.value || "active";
    const collateral = document.getElementById("editCollateral")?.value.trim() || "";
    const notes = document.getElementById("editNotes")?.value.trim() || "";
    const dateOfBirthInput = document.getElementById("editDOB");
    const dateOfBirth = dateOfBirthInput?.value || null;
    
    // Validate age if DOB is provided
    if (dateOfBirth && window.DOBValidation) {
      const validation = window.DOBValidation.validateAge(dateOfBirth);
      if (!validation.isValid) {
        alert(validation.error);
        if (dateOfBirthInput) {
          dateOfBirthInput.focus();
          dateOfBirthInput.reportValidity();
        }
        return;
      }
    }
    const gender = document.getElementById("editGender")?.value || null;

    if (!fullName || !email || !phone) {
        alert("Please fill in all required fields (Name, Email, Phone)");
        return;
    }

    try {
        const updateData = {
            fullName,
            email,
            phone,
            whatsappNumber,
            address,
            workplace,
            workAddress,
            career,
            jobTitle,
            guarantorName,
            guarantorPhone,
            guarantorRelationship,
            guarantorAddress,
            idType,
            idNumber,
            emergencyContact,
            emergencyPhone,
            role,
            status,
            collateral,
            notes,
            updatedAt: Timestamp.now()
        };

        if (dateOfBirth) updateData.dateOfBirth = dateOfBirth;
        if (gender) updateData.gender = gender;

        // Handle profile picture upload if changed
        const profilePictureInput = document.getElementById("editMemberProfilePicture");
        if (profilePictureInput?.files?.length > 0) {
            try {
                const file = profilePictureInput.files[0];
                const storageRef = ref(storage, `profiles/${groupId}/${memberId}/${Date.now()}_${file.name}`);
                await uploadBytes(storageRef, file);
                const downloadURL = await getDownloadURL(storageRef);
                updateData.profileImageUrl = downloadURL;
            } catch (uploadError) {
                console.error("Error uploading profile picture:", uploadError);
                // Continue without profile picture if upload fails
            }
        }

        // Get current member data to check role changes
        const memberRef = doc(db, `groups/${groupId}/members`, memberId);
        const memberDoc = await getDoc(memberRef);
        const currentMemberData = memberDoc.exists() ? memberDoc.data() : {};
        const oldRole = currentMemberData.role || 'member';
        const newRole = role;
        
        // Handle role change (promote/demote admin)
        if (oldRole !== newRole && (oldRole === 'admin' || oldRole === 'senior_admin' || newRole === 'admin')) {
            // Get group data
            const groupRef = doc(db, "groups", groupId);
            const groupDoc = await getDoc(groupRef);
            if (!groupDoc.exists()) {
                throw new Error("Group not found");
            }
            const groupData = groupDoc.data();
            const admins = groupData.admins || [];
            
            // Get user data for admin entry
            const userRef = doc(db, "users", memberId);
            const userDoc = await getDoc(userRef);
            const userData = userDoc.exists() ? userDoc.data() : {};
            
            if (newRole === 'admin' || newRole === 'senior_admin') {
                // Promote to admin - add to admins array
                const isAlreadyAdmin = admins.some(a => a.uid === memberId || a.email === email);
                if (!isAlreadyAdmin) {
                    admins.push({
                        uid: memberId,
                        fullName: fullName,
                        email: email,
                        phone: phone,
                        whatsappNumber: whatsappNumber,
                        role: newRole === 'senior_admin' ? 'senior_admin' : 'admin',
                        assignedAt: Timestamp.now(),
                        assignedBy: currentUser.uid,
                        isContactAdmin: false,
                        canPromoteMembers: true,
                        permissions: {
                            canApprovePayments: true,
                            canApproveLoan: true,
                            canAddMembers: true,
                            canRemoveMembers: true,
                            canPromoteToAdmin: true,
                            canDemoteAdmin: true,
                            canSendBroadcasts: true,
                            canManageSettings: true,
                            canViewReports: true
                        }
                    });
                    await updateDoc(groupRef, { admins });
                } else {
                    // Update existing admin entry
                    const adminIndex = admins.findIndex(a => a.uid === memberId || a.email === email);
                    if (adminIndex >= 0) {
                        admins[adminIndex] = {
                            ...admins[adminIndex],
                            fullName: fullName,
                            email: email,
                            phone: phone,
                            whatsappNumber: whatsappNumber,
                            role: newRole === 'senior_admin' ? 'senior_admin' : 'admin',
                            permissions: {
                                canApprovePayments: true,
                                canApproveLoan: true,
                                canAddMembers: true,
                                canRemoveMembers: true,
                                canPromoteToAdmin: true,
                                canDemoteAdmin: true,
                                canSendBroadcasts: true,
                                canManageSettings: true,
                                canViewReports: true
                            }
                        };
                        await updateDoc(groupRef, { admins });
                    }
                }
            } else if (oldRole === 'admin' || oldRole === 'senior_admin') {
                // Demote from admin - remove from admins array (but not if they're the creator)
                if (groupData.createdBy !== memberId) {
                    const filteredAdmins = admins.filter(a => a.uid !== memberId && a.email !== email);
                    await updateDoc(groupRef, { admins: filteredAdmins });
                } else {
                    // Cannot demote the group creator
                    alert("⚠️ Cannot demote the group creator from admin role!");
                    return;
                }
            }
        }
        
        // Ensure member document exists in members collection
        if (memberDoc.exists()) {
            // Update existing member document
            await updateDoc(memberRef, updateData);
        } else {
            // Create member document if it doesn't exist (for admins)
            await setDoc(memberRef, {
                ...updateData,
                joinedAt: Timestamp.now(),
                createdAt: Timestamp.now()
            });
        }

        // Also update in users collection if exists
        try {
            const userRef = doc(db, "users", memberId);
            const userDoc = await getDoc(userRef);
            if (userDoc.exists()) {
                await updateDoc(userRef, updateData);
            }
        } catch (e) {
            console.log("User document not found or already updated");
        }

        alert("Member updated successfully!");
        
        // Close modal
        if (editMemberModal) {
            editMemberModal.style.display = 'none';
            editMemberModal.classList.add('hidden');
            editMemberModal.classList.remove('active');
            document.body.style.overflow = '';
        }
        
        // Reload members
        await loadMembers();
        
    } catch (error) {
        console.error("Error updating member:", error);
        alert("Failed to update member: " + error.message);
    }
}

// ✅ Confirm and Remove Member
async function confirmAndRemoveMember(memberId) {
    if (!confirm("Are you sure you want to remove this member? This action cannot be undone.")) {
        return;
    }

    try {
        await deleteDoc(doc(db, `groups/${groupId}/members`, memberId));
        alert("Member removed successfully!");
        await loadMembers();
    } catch (error) {
        alert("Failed to remove member: " + error.message);
    }
}

// ✅ Helper: Get initials
function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}
