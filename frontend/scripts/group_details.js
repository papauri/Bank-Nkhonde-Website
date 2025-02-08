import {
  db,
  auth,
  doc,
  getDoc,
  collection,
  getDocs,
  onAuthStateChanged,
} from "./firebaseConfig.js";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    alert("You must be signed in to access this page.");
    window.location.href = "/login.html";
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const groupId = urlParams.get("groupId");

  const paymentsContainer = document.getElementById("paymentsContainer");
  const pendingPaymentsContainer = document.getElementById("pendingPaymentsContainer");
  const backButton = document.getElementById("backButton");

  if (!groupId) {
    alert("Group ID is missing. Redirecting to the admin dashboard...");
    window.location.href = "/frontend/pages/admin_dashboard.html";
    return;
  }

  async function fetchPayments(groupId) {
    try {
      const currentMonth = new Date().toLocaleString("default", { month: "long" });
      const currentYear = new Date().getFullYear();

      const groupDoc = await getDoc(doc(db, "groups", groupId));
      if (!groupDoc.exists()) {
        alert("Group not found!");
        return;
      }

      const { monthlyPenalty } = groupDoc.data();

      // Fetch Payments
      const paymentsSnapshot = await getDocs(collection(db, `groups/${groupId}/payments`));
      const pendingPaymentsSnapshot = await getDocs(collection(db, `groups/${groupId}/payments/pendingPayments`));

      // Filter and Display Payments
      const filteredPendingPayments = pendingPaymentsSnapshot.docs.filter((doc) => {
        const payment = doc.data();
        return payment.month === currentMonth && payment.year === currentYear;
      });

      populatePaymentCards(filteredPendingPayments, pendingPaymentsContainer, true, monthlyPenalty);
    } catch (error) {
      console.error("Error fetching payments:", error.message);
      alert("An error occurred while fetching payments.");
    }
  }

  function populatePaymentCards(docs, container, isPending = false, penaltyRate = 0) {
    container.innerHTML = ""; 

    if (!docs.length) {
      container.innerHTML = `<p>No ${isPending ? "pending" : ""} payments available for the current month.</p>`;
      return;
    }

    docs.forEach((doc) => {
      const data = doc.data();
      const arrears = Math.max(data.totalAmount - (data.paid?.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0), 0);
      const penalty = arrears > 0 ? arrears * (penaltyRate / 100) : 0;
      const totalDue = arrears + penalty;

      const card = document.createElement("div");
      card.classList.add("payment-card");

      card.innerHTML = `
        <div class="card-header">${data.fullName || "Unknown Member"}</div>
        <div class="card-body">
          <p><strong>Type:</strong> ${data.paymentType || "Unknown"}</p>
          <p><strong>Amount:</strong> MWK ${data.totalAmount || 0}</p>
          <p><strong>Due Date:</strong> ${data.dueDate || "N/A"}</p>
          <p><strong>Arrears:</strong> MWK ${arrears.toFixed(2)}</p>
          <p><strong>Penalty:</strong> MWK ${penalty.toFixed(2)}</p>
          <p><strong>Total Due:</strong> MWK ${totalDue.toFixed(2)}</p>
          <p><strong>Status:</strong> ${data.status || "Pending"}</p>
        </div>
      `;
      container.appendChild(card);
    });
  }

  // Initialize Fetch
  fetchPayments(groupId);

  // Back Button Event Listener
  backButton.addEventListener("click", () => {
    window.location.href = "/frontend/pages/admin_dashboard.html";
  });
});
