// Firebase Setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyClJfGFoc1WZ_qYi5ImQJXyurQtqXgOqfA",
  authDomain: "banknkonde.firebaseapp.com",
  databaseURL: "https://banknkonde-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "banknkonde",
  storageBucket: "banknkonde.appspot.com",
  messagingSenderId: "698749180404",
  appId: "1:698749180404:web:7e8483cae4abd7555101a1",
  measurementId: "G-MC7PDS90FR",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

document.addEventListener("DOMContentLoaded", () => {
  // Toggle visibility of group details
  const createGroupCheckbox = document.getElementById("createGroup");
  const groupDetails = document.getElementById("groupDetails");

  // Show or hide the group details section
  createGroupCheckbox.addEventListener("change", () => {
    if (createGroupCheckbox.checked) {
      groupDetails.classList.remove("hidden");
    } else {
      groupDetails.classList.add("hidden");
    }
  });

  // Registration Form Submission Handler
  const registrationForm = document.getElementById("registrationForm");
  registrationForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("name").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const invitationCode = document.getElementById("invitationCode").value.trim();
    const createGroup = createGroupCheckbox.checked;

    // Validate required fields
    if (!name || !phone || !email || !password || !invitationCode) {
      alert("Please fill out all required fields.");
      return;
    }

    try {
      // Check invitation code in Firestore
      const codeQuery = query(collection(db, "invitationCodes"), where("code", "==", invitationCode));
      const querySnapshot = await getDocs(codeQuery);

      if (querySnapshot.empty) {
        alert("Invalid invitation code.");
        return;
      }

      const invitationDoc = querySnapshot.docs[0];
      const invitationData = invitationDoc.data();

      // Validate invitation code approval and usage
      if (!invitationData.approved) {
        alert("This invitation code has not been approved by the admin.");
        return;
      }

      if (invitationData.used) {
        alert("This invitation code has already been used.");
        return;
      }

      // Register the user with Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Save user details in Firestore
      await setDoc(doc(db, "users", user.uid), {
        name,
        phone,
        email,
        role: "admin",
        createdAt: new Date(),
      });

      // Mark invitation code as used
      await setDoc(invitationDoc.ref, { used: true }, { merge: true });

      // Handle group creation if applicable
      if (createGroup) {
        const groupName = document.getElementById("groupName").value.trim();
        const seedMoney = parseFloat(document.getElementById("seedMoney").value) || 0;
        const interestRate = parseFloat(document.getElementById("interestRate").value) || 0;
        const monthlyContribution = parseFloat(document.getElementById("monthlyContribution").value) || 0;
        const loanPenalty = parseFloat(document.getElementById("loanPenalty").value) || 0;
        const monthlyPenalty = parseFloat(document.getElementById("monthlyPenalty").value) || 0;

        if (!groupName) {
          alert("Please provide a group name.");
          return;
        }

        await setDoc(doc(db, "groups", user.uid), {
          name: groupName,
          admin: user.uid,
          seedMoney,
          interestRate,
          monthlyContribution,
          loanPenalty,
          monthlyPenalty,
          createdAt: new Date(),
        });
      }

      alert("Registration successful!");
      window.location.href = "../dashboard/admin_dashboard.html";
    } catch (err) {
      console.error("Error during registration:", err.message);
      alert("An error occurred during registration. Please try again.");
    }
  });
});
