import {
  db,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  Timestamp,
  onSnapshot,
} from "./firebaseConfig.js";


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

// Mark the invitation code as used and delete it immediately
export async function markCodeAsUsedAndDelete(code) {
  try {
    const codeQuery = query(collection(db, "invitationCodes"), where("code", "==", code));
    const querySnapshot = await getDocs(codeQuery);

    if (!querySnapshot.empty) {
      const invitationDocRef = querySnapshot.docs[0].ref;
      // Delete the document immediately after use
      await deleteDoc(invitationDocRef);
      console.log("Invitation code deleted after use.");
    } else {
      console.warn("No matching invitation code found.");
    }
  } catch (err) {
    console.error("Error deleting code:", err);
    alert("Failed to process the invitation code. Please try again.");
  }
}

// Poll for registration key approval using real-time listener
export async function pollForApproval(code, maxWaitTimeMs = 300000) {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const codeQuery = query(collection(db, "invitationCodes"), where("code", "==", code));
    
    // Use real-time listener instead of polling
    const unsubscribe = onSnapshot(codeQuery, (snapshot) => {
      if (snapshot.empty) {
        unsubscribe();
        reject(new Error("Registration key not found. It may have been deleted."));
        return;
      }

      const invitationDoc = snapshot.docs[0];
      const invitationData = invitationDoc.data();

      if (invitationData.approved) {
        unsubscribe();
        resolve(true);
        return;
      }

      // Check if we've exceeded max wait time
      if (Date.now() - startTime > maxWaitTimeMs) {
        unsubscribe();
        reject(new Error("Registration key approval timeout. Please contact an administrator."));
      }
    }, (error) => {
      reject(error);
    });
    
    // Set a timeout to clean up the listener
    setTimeout(() => {
      unsubscribe();
      reject(new Error("Registration key approval timeout. Please contact an administrator."));
    }, maxWaitTimeMs);
  });
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
