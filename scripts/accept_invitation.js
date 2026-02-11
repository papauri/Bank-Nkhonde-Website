import {
  db,
  auth,
  createUserWithEmailAndPassword,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  sendEmailVerification,
} from "./firebaseConfig.js";

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");

  const loadingMessage = document.getElementById("loadingMessage");
  const invitationForm = document.getElementById("invitationForm");
  const expiredMessage = document.getElementById("expiredMessage");
  const acceptInvitationForm = document.getElementById("acceptInvitationForm");
  const errorMessage = document.getElementById("errorMessage");
  const successMessage = document.getElementById("successMessage");
  const submitBtn = document.getElementById("submitBtn");

  if (!token) {
    showExpired();
    return;
  }

  // Load invitation details
  try {
    const invitationsRef = collection(db, "invitations");
    const q = query(invitationsRef, where("invitationToken", "==", token), where("status", "==", "pending"));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      showExpired();
      return;
    }

    const invitationDoc = querySnapshot.docs[0];
    const invitationData = invitationDoc.data();
    const invitationId = invitationDoc.id;

    // Check if invitation has expired
    const expiresAt = invitationData.expiresAt.toDate();
    if (expiresAt < new Date()) {
      showExpired();
      return;
    }

    // Display invitation details
    document.getElementById("groupName").textContent = invitationData.groupName;
    document.getElementById("invitedBy").textContent = invitationData.invitedByName || invitationData.invitedByEmail;
    document.getElementById("email").value = invitationData.email;

    loadingMessage.style.display = "none";
    invitationForm.style.display = "block";

    // Handle form submission
    acceptInvitationForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const fullName = document.getElementById("fullName").value.trim();
      const email = invitationData.email;
      const phone = document.getElementById("phone").value.trim();
      const password = document.getElementById("password").value;
      const confirmPassword = document.getElementById("confirmPassword").value;

      // Validate inputs
      if (!fullName || !phone || !password || !confirmPassword) {
        showError("Please fill in all fields.");
        return;
      }

      if (password.length < 6) {
        showError("Password must be at least 6 characters long.");
        return;
      }

      if (password !== confirmPassword) {
        showError("Passwords do not match.");
        return;
      }

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = "Creating account...";

        // Create Firebase Auth user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Send email verification
        await sendEmailVerification(user);

        // Create user document
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          fullName,
          email,
          phone,
          roles: ["user"],
          createdAt: Timestamp.now(),
          groupMemberships: [invitationData.groupId],
        });

        // Add user to group members
        await setDoc(doc(db, `groups/${invitationData.groupId}/members`, user.uid), {
          uid: user.uid,
          fullName,
          email,
          phone,
          role: "user",
          joinedAt: Timestamp.now(),
          collateral: null,
          balances: [],
        });

        // Initialize payment records for the new member
        await initializePayments(invitationData.groupId, user.uid, fullName);

        // Update invitation status
        await updateDoc(doc(db, "invitations", invitationId), {
          status: "accepted",
          acceptedAt: Timestamp.now(),
          acceptedByUid: user.uid,
        });

        // Show success message
        showSuccess("Account created successfully! Redirecting to your dashboard...");
        
        // Redirect to user dashboard after 2 seconds (using relative path)
        setTimeout(() => {
          window.location.href = "user_dashboard.html";
        }, 2000);

      } catch (error) {
        console.error("Error accepting invitation:", error);
        
        if (error.code === "auth/email-already-in-use") {
          showError("This email is already registered. Please log in instead.");
        } else if (error.code === "auth/weak-password") {
          showError("Password is too weak. Please use a stronger password.");
        } else {
          showError("Error creating account: " + error.message);
        }
        
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account & Join Group";
      }
    });

  } catch (error) {
    console.error("Error loading invitation:", error);
    showExpired();
  }

  // Helper function to initialize payments for new member
  async function initializePayments(groupId, memberId, memberName) {
    try {
      // Fetch group settings
      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) return;

      const groupData = groupDoc.data();
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().toLocaleString("default", { month: "long" });

      const paymentDocRef = doc(db, `groups/${groupId}/payments/${currentYear}/${currentMonth}/${memberId}`);

      await setDoc(paymentDocRef, {
        memberId,
        fullName: memberName,
        groupId,
        createdAt: Timestamp.now(),
        payments: {
          "Seed Money": {
            paymentId: `SeedMoney-${Date.now()}`,
            totalAmount: (groupData.seedMoney || 0).toFixed(2),
            paidAmount: "0.00",
            arrears: "0.00",
            balance: "0.00",
            loanPenalty: (groupData.loanPenalty || 0).toFixed(2),
            monthlyPenalty: (groupData.monthlyPenalty || 0).toFixed(2),
            paymentDate: Timestamp.now(),
            status: "pending",
            approvedBy: null,
            approvalStatus: "pending",
          },
          "Monthly Contribution": {
            paymentId: `MonthlyContribution-${Date.now()}`,
            totalAmount: (groupData.monthlyContribution || 0).toFixed(2),
            paidAmount: "0.00",
            arrears: "0.00",
            balance: "0.00",
            loanPenalty: (groupData.loanPenalty || 0).toFixed(2),
            monthlyPenalty: (groupData.monthlyPenalty || 0).toFixed(2),
            paymentDate: Timestamp.now(),
            status: "pending",
            approvedBy: null,
            approvalStatus: "pending",
          },
        }
      });

      console.log("✅ Payments initialized for new member");
    } catch (error) {
      console.error("❌ Error initializing payments:", error);
    }
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = "block";
    successMessage.style.display = "none";
  }

  function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.style.display = "block";
    errorMessage.style.display = "none";
  }

  function showExpired() {
    loadingMessage.style.display = "none";
    invitationForm.style.display = "none";
    expiredMessage.style.display = "block";
  }
});
