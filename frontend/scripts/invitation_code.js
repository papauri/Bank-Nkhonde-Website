import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-analytics.js";
import { getFirestore, collection, addDoc, Timestamp, query, where, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

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
const analytics = getAnalytics(app);
const db = getFirestore(app);

// Generate a random 8-character code
function generateInvitationCode() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Create and store the invitation code in Firestore
export async function createInvitationCode() {
  const code = generateInvitationCode();
  try {
    const docRef = await addDoc(collection(db, "invitationCodes"), {
      code: code,
      approved: false,
      used: false,
      createdAt: Timestamp.now(),
    });
    console.log("Invitation code created:", code);
    alert(`Your invitation code: ${code}`);
    document.getElementById("invitationCode").value = code; // Autofill the code in the form
    return code;
  } catch (err) {
    console.error("Error creating invitation code:", err);
    alert("An error occurred while generating the invitation code.");
    return null;
  }
}

// Validate the invitation code
export async function validateInvitationCode(code) {
  try {
    const codeQuery = query(collection(db, "invitationCodes"), where("code", "==", code));
    const querySnapshot = await getDocs(codeQuery);

    if (querySnapshot.empty) {
      alert("Invalid invitation code.");
      return false;
    }

    const invitationDoc = querySnapshot.docs[0];
    const invitationData = invitationDoc.data();

    if (!invitationData.approved) {
      alert("This invitation code has not been approved by the admin.");
      return false;
    }

    if (invitationData.used) {
      alert("This invitation code has already been used.");
      return false;
    }

    return true;
  } catch (err) {
    console.error("Error validating invitation code:", err);
    alert("An error occurred while validating the invitation code. Please try again.");
    return false;
  }
}

// Mark the invitation code as used
export async function markCodeAsUsed(code) {
  try {
    const codeQuery = query(collection(db, "invitationCodes"), where("code", "==", code));
    const querySnapshot = await getDocs(codeQuery);

    if (!querySnapshot.empty) {
      const invitationDocRef = querySnapshot.docs[0].ref;
      await updateDoc(invitationDocRef, { used: true });
      console.log("Invitation code marked as used.");
    } else {
      console.warn("No matching invitation code found.");
    }
  } catch (err) {
    console.error("Error marking code as used:", err);
    alert("Failed to mark the invitation code as used. Please try again.");
  }
}

// Automatically create an invitation code on page load
document.addEventListener("DOMContentLoaded", () => {
  const generateCodeBtn = document.getElementById("generateCodeBtn"); // Add a button for manual generation if needed
  if (generateCodeBtn) {
    generateCodeBtn.addEventListener("click", async () => {
      await createInvitationCode();
    });
  }

  // Automatically create and autofill the code on form load
  createInvitationCode();
});
