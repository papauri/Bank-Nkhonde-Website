import { 
    db, auth, createUserWithEmailAndPassword, 
    doc, setDoc, updateDoc, collection, getDoc, 
    getDocs, deleteDoc, Timestamp, sendEmailVerification 
} from "./firebaseConfig.js";
import { updatePaymentsForNewMember } from "./updatePayments.js";

// ✅ Get DOM elements safely
const memberList = document.getElementById("memberList");
const addMemberForm = document.getElementById("addMemberForm");
const backButton = document.getElementById("backButton");
const editMemberModal = document.getElementById("editMemberModal");
const editMemberForm = document.getElementById("editMemberForm");
const closeEditModal = document.getElementById("closeEditModal");
const paymentModal = document.getElementById("paymentModal");
const confirmPaymentButton = document.getElementById("confirmPaymentButton");
const cancelPaymentButton = document.getElementById("cancelPaymentButton");

// ✅ Payment Input Fields
const paymentSeedMoney = document.getElementById("paymentSeedMoney");
const paymentMonthlyContribution = document.getElementById("paymentMonthlyContribution");
const paymentLoanPenalty = document.getElementById("paymentLoanPenalty");
const paymentMonthlyPenalty = document.getElementById("paymentMonthlyPenalty");

// ✅ Ensure all modals are hidden initially
document.addEventListener("DOMContentLoaded", () => {
    if (editMemberModal) editMemberModal.style.display = "none";
    if (paymentModal) paymentModal.style.display = "none";
});

// ✅ Fetch the group ID from URL parameters
const urlParams = new URLSearchParams(window.location.search);
const groupId = urlParams.get("groupId");

let newMemberData = null;
let groupPaymentSettings = {};

if (!groupId) {
    alert("Group ID is missing. Redirecting...");
    window.location.href = "../pages/admin_dashboard.html";
}

// ✅ Fetch Group Payment Settings (Pre-fill Default Payment Amounts)
async function fetchGroupPaymentSettings() {
    try {
        console.log("🔹 Fetching Group Payment Settings...");
        const groupRef = doc(db, "groups", groupId);
        const groupSnap = await getDoc(groupRef);

        if (groupSnap.exists()) {
            groupPaymentSettings = groupSnap.data();

            // ✅ Access nested structure from rules or top-level fallback
            const seedMoney = groupPaymentSettings.rules?.seedMoney?.amount ?? groupPaymentSettings.seedMoney ?? 0;
            const monthlyContribution = groupPaymentSettings.rules?.monthlyContribution?.amount ?? groupPaymentSettings.monthlyContribution ?? 0;
            const interestRate = groupPaymentSettings.rules?.interestRate ?? groupPaymentSettings.interestRate ?? 0;
            const loanPenalty = groupPaymentSettings.rules?.loanPenalty?.rate ?? groupPaymentSettings.loanPenalty ?? 0;
            const monthlyPenalty = groupPaymentSettings.rules?.monthlyPenalty?.rate ?? groupPaymentSettings.monthlyPenalty ?? 0;

            // ✅ Pre-fill modal with correct values from Firestore
            paymentSeedMoney.value = seedMoney;
            paymentMonthlyContribution.value = monthlyContribution;
            paymentLoanPenalty.value = loanPenalty;
            paymentMonthlyPenalty.value = monthlyPenalty;

            console.log("✅ Group Payment Settings Loaded:", {
                seedMoney,
                monthlyContribution,
                interestRate,
                loanPenalty,
                monthlyPenalty
            });
        } else {
            console.warn("❌ Group settings not found.");
        }
    } catch (error) {
        console.error("❌ Error fetching group settings:", error);
    }
}

// ✅ Load Members from Firestore
async function loadMembers() {
    memberList.innerHTML = "<li>Loading members...</li>";

    try {
        const membersRef = collection(db, `groups/${groupId}/members`);
        const querySnapshot = await getDocs(membersRef);

        memberList.innerHTML = "";
        querySnapshot.forEach((docSnapshot) => {
            const member = docSnapshot.data();
            const listItem = document.createElement("li");
            listItem.innerHTML = `
                ${member.fullName} (${member.role})
                <button class="edit-button" data-id="${docSnapshot.id}" 
                    data-name="${member.fullName}" 
                    data-email="${member.email}" 
                    data-phone="${member.phone}" 
                    data-whatsapp="${member.whatsappNumber || member.phone || ''}"
                    data-address="${member.address || ''}"
                    data-workplace="${member.workplace || ''}"
                    data-career="${member.career || ''}"
                    data-guarantor="${member.guarantor || ''}"
                    data-guarantor-phone="${member.guarantorPhone || ''}"
                    data-role="${member.role}" 
                    data-collateral="${member.collateral || ''}">
                    Edit
                </button>
                <button class="remove-button" data-id="${docSnapshot.id}">Remove</button>
            `;

            memberList.appendChild(listItem);
        });

        // Attach event listeners for edit & remove
        document.querySelectorAll(".edit-button").forEach((button) => {
            button.addEventListener("click", (event) => {
                const memberId = button.getAttribute("data-id");
                if (!editMemberModal) return;

                document.getElementById("editFullName").value = button.getAttribute("data-name");
                document.getElementById("editEmail").value = button.getAttribute("data-email");
                document.getElementById("editPhone").value = button.getAttribute("data-phone");
                document.getElementById("editWhatsappNumber").value = button.getAttribute("data-whatsapp") || "";
                document.getElementById("editAddress").value = button.getAttribute("data-address") || "";
                document.getElementById("editWorkplace").value = button.getAttribute("data-workplace") || "";
                document.getElementById("editCareer").value = button.getAttribute("data-career") || "";
                document.getElementById("editGuarantor").value = button.getAttribute("data-guarantor") || "";
                document.getElementById("editGuarantorPhone").value = button.getAttribute("data-guarantor-phone") || "";
                document.getElementById("editRole").value = button.getAttribute("data-role");
                document.getElementById("editCollateral").value = button.getAttribute("data-collateral") || "";

                editMemberModal.dataset.id = memberId;
                editMemberModal.style.display = "block";
            });
        });

        document.querySelectorAll(".remove-button").forEach((button) => {
            button.addEventListener("click", async () => {
                const memberId = button.getAttribute("data-id");
                await confirmAndRemoveMember(memberId);
            });
        });
    } catch (error) {
        console.error("Error loading members:", error);
        memberList.innerHTML = "<li>Error loading members.</li>";
    }
}

// ✅ Open Payment Confirmation Modal BEFORE user creation
addMemberForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const whatsappNumber = document.getElementById("whatsappNumber").value.trim() || phone;
    const address = document.getElementById("address").value.trim() || "";
    const workplace = document.getElementById("workplace").value.trim() || "";
    const career = document.getElementById("career").value.trim() || "";
    const guarantor = document.getElementById("guarantor").value.trim() || "";
    const guarantorPhone = document.getElementById("guarantorPhone").value.trim() || "";
    const role = document.getElementById("role").value;
    const collateral = document.getElementById("collateral").value.trim() || null;

    try {
        newMemberData = { 
            fullName, 
            email, 
            phone, 
            whatsappNumber,
            address,
            workplace,
            career,
            guarantor,
            guarantorPhone,
            role, 
            collateral 
        };

        // ✅ Fetch default payment settings and show payment modal
        await fetchGroupPaymentSettings();
        paymentModal.style.display = "flex"; 

    } catch (error) {
        alert("Error opening payment modal: " + error.message);
    }
});

// ✅ Confirm & Create User + Update Payments
confirmPaymentButton.addEventListener("click", async () => {
    if (!newMemberData) return;

    try {
        // ✅ Create user AFTER confirmation
        const userCredential = await createUserWithEmailAndPassword(auth, newMemberData.email, "User@123");
        const user = userCredential.user;
        await sendEmailVerification(user);

        // ✅ Store user details in Firestore
        const userData = { uid: user.uid, ...newMemberData, createdAt: Timestamp.now() };

        await setDoc(doc(db, "users", user.uid), { ...userData, groupMemberships: [groupId] });
        await setDoc(doc(db, `groups/${groupId}/members`, user.uid), { ...userData, joinedAt: Timestamp.now() });

        // ✅ Update Payment Collections
        await updatePaymentsForNewMember(
            groupId, user.uid, newMemberData.fullName,
            parseFloat(paymentSeedMoney.value),
            parseFloat(paymentMonthlyContribution.value),
            parseFloat(paymentLoanPenalty.value),
            parseFloat(paymentMonthlyPenalty.value)
        );

        alert("Member and payments added successfully!");
        paymentModal.style.display = "none";
        loadMembers();
    } catch (error) {
        alert("Failed to add member: " + error.message);
    }
});

// ✅ Close modal when clicking "Cancel"
if (cancelPaymentButton) {
    cancelPaymentButton.addEventListener("click", () => {
        if (paymentModal) paymentModal.style.display = "none";
    });
}

// ✅ Close edit modal when clicking "Cancel"
if (closeEditModal) {
    closeEditModal.addEventListener("click", () => {
        if (editMemberModal) editMemberModal.style.display = "none";
    });
}

// ✅ Handle Edit Member Form Submission
if (editMemberForm) {
    editMemberForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const memberId = editMemberModal.dataset.id;
        if (!memberId) return;

        const fullName = document.getElementById("editFullName").value.trim();
        const email = document.getElementById("editEmail").value.trim();
        const phone = document.getElementById("editPhone").value.trim();
        const whatsappNumber = document.getElementById("editWhatsappNumber").value.trim() || phone;
        const address = document.getElementById("editAddress").value.trim() || "";
        const workplace = document.getElementById("editWorkplace").value.trim() || "";
        const career = document.getElementById("editCareer").value.trim() || "";
        const guarantor = document.getElementById("editGuarantor").value.trim() || "";
        const guarantorPhone = document.getElementById("editGuarantorPhone").value.trim() || "";
        const role = document.getElementById("editRole").value;
        const collateral = document.getElementById("editCollateral").value.trim() || null;

        try {
            // Update member in Firestore
            await updateDoc(doc(db, `groups/${groupId}/members`, memberId), {
                fullName,
                email,
                phone,
                whatsappNumber,
                address,
                workplace,
                career,
                guarantor,
                guarantorPhone,
                role,
                collateral,
            });

            alert("Member updated successfully!");
            editMemberModal.style.display = "none";
            loadMembers();
        } catch (error) {
            alert("Failed to update member: " + error.message);
        }
    });
}

// ✅ Confirm and Remove Member Function
async function confirmAndRemoveMember(memberId) {
    if (!confirm("Are you sure you want to remove this member?")) {
        return;
    }

    try {
        await deleteDoc(doc(db, `groups/${groupId}/members`, memberId));
        alert("Member removed successfully!");
        loadMembers();
    } catch (error) {
        alert("Failed to remove member: " + error.message);
    }
}

// ✅ Back Button Navigation
if (backButton) {
    backButton.addEventListener("click", () => {
        window.location.href = `group_page.html?groupId=${groupId}`;
    });
}

// ✅ Load Data on Page Load
fetchGroupPaymentSettings();
loadMembers();
