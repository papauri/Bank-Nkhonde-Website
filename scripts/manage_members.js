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
            groupData = groupSnap.data();
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

        // Also check if admin is in the group document
        if (groupData) {
            const createdBy = groupData.createdBy;
            const admins = groupData.admins || [];
            
            // Check if current user (admin) is already in members list
            const adminInMembers = members.find(m => m.id === currentUser.uid);
            
            if (!adminInMembers && (createdBy === currentUser.uid || admins.some(a => a.uid === currentUser.uid || a.email === currentUser.email))) {
                // Add admin to members list
                const userDoc = await getDoc(doc(db, "users", currentUser.uid));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    members.unshift({
                        id: currentUser.uid,
                        ...userData,
                        role: 'senior_admin',
                        joinedAt: groupData.createdAt || Timestamp.now()
                    });
                }
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

        if (members.length === 0) {
            memberList.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">👥</div>
                    <p class="empty-state-text">No members found</p>
                </div>
            `;
            return;
        }

        // Render member cards
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
                        ${!isAdmin || members.filter(m => m.role === 'admin' || m.role === 'senior_admin').length > 1 ? `
                        <button class="btn btn-danger btn-sm remove-member-btn" data-id="${member.id}">
                            🗑️ Remove
                        </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners
        attachMemberEventListeners();

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

// ✅ Attach event listeners for edit and remove buttons
function attachMemberEventListeners() {
    // Edit buttons
    document.querySelectorAll(".edit-member-btn").forEach((button) => {
        button.addEventListener("click", () => {
            openEditModal(button);
        });
    });

    // Remove buttons
    document.querySelectorAll(".remove-member-btn").forEach((button) => {
        button.addEventListener("click", async () => {
            const memberId = button.getAttribute("data-id");
            await confirmAndRemoveMember(memberId);
        });
    });
}

// ✅ Open edit modal
function openEditModal(button) {
    if (!editMemberModal) return;

    const memberId = button.getAttribute("data-id");
    
    // Populate form fields
    const fields = {
        'editFullName': button.getAttribute("data-name"),
        'editEmail': button.getAttribute("data-email"),
        'editPhone': button.getAttribute("data-phone"),
        'editWhatsappNumber': button.getAttribute("data-whatsapp"),
        'editAddress': button.getAttribute("data-address"),
        'editWorkplace': button.getAttribute("data-workplace"),
        'editCareer': button.getAttribute("data-career"),
        'editGuarantor': button.getAttribute("data-guarantor"),
        'editGuarantorPhone': button.getAttribute("data-guarantor-phone"),
        'editRole': button.getAttribute("data-role"),
        'editCollateral': button.getAttribute("data-collateral"),
        'editDOB': button.getAttribute("data-dob"),
        'editGender': button.getAttribute("data-gender")
    };

    Object.keys(fields).forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.value = fields[fieldId] || '';
        }
    });

    editMemberModal.dataset.id = memberId;
    editMemberModal.classList.remove('hidden');
    editMemberModal.classList.add('active');
    document.body.style.overflow = 'hidden';
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
    const dateOfBirth = document.getElementById("memberDOB")?.value || null;
    const gender = document.getElementById("memberGender")?.value || null;

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

// ✅ Handle edit member
async function handleEditMember() {
    const memberId = editMemberModal?.dataset.id;
    if (!memberId) return;

    const fullName = document.getElementById("editFullName")?.value.trim();
    const email = document.getElementById("editEmail")?.value.trim();
    const phone = document.getElementById("editPhone")?.value.trim();
    const whatsappNumber = document.getElementById("editWhatsappNumber")?.value.trim() || phone;
    const address = document.getElementById("editAddress")?.value.trim() || "";
    const workplace = document.getElementById("editWorkplace")?.value.trim() || "";
    const career = document.getElementById("editCareer")?.value.trim() || "";
    const guarantorName = document.getElementById("editGuarantor")?.value.trim() || "";
    const guarantorPhone = document.getElementById("editGuarantorPhone")?.value.trim() || "";
    const role = document.getElementById("editRole")?.value;
    const collateral = document.getElementById("editCollateral")?.value.trim() || null;
    const dateOfBirth = document.getElementById("editDOB")?.value || null;
    const gender = document.getElementById("editGender")?.value || null;

    try {
        const updateData = {
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
            updatedAt: Timestamp.now()
        };

        if (dateOfBirth) updateData.dateOfBirth = dateOfBirth;
        if (gender) updateData.gender = gender;

        // Update member in Firestore
        await updateDoc(doc(db, `groups/${groupId}/members`, memberId), updateData);

        // Also update in users collection if exists
        try {
            await updateDoc(doc(db, "users", memberId), updateData);
        } catch (e) {
            console.log("User document not found or already updated");
        }

        alert("Member updated successfully!");
        
        // Close modal
        if (editMemberModal) {
            editMemberModal.classList.add('hidden');
            editMemberModal.classList.remove('active');
            document.body.style.overflow = '';
        }
        
        // Reload members
        await loadMembers();
        
    } catch (error) {
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
