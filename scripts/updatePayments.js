import { db, doc, setDoc, collection, Timestamp } from "./firebaseConfig.js";

// ✅ Function to Update Payments for a New Member
export async function updatePaymentsForNewMember(groupId, memberId, memberName, seedMoney, monthlyContribution, loanPenalty, monthlyPenalty) {
  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().toLocaleString("default", { month: "long" });

    // 🔹 Create the correct Firestore document path
    const paymentDocRef = doc(db, `groups/${groupId}/payments/${currentYear}/${currentMonth}/${memberId}`);

    // 🔹 Store all payment types inside a **single document** instead of making them part of the path
    await setDoc(paymentDocRef, {
      memberId,
      fullName: memberName,
      groupId,
      createdAt: Timestamp.now(),
      payments: {
        "Seed Money": {
          paymentId: `SeedMoney-${Date.now()}`,
          totalAmount: seedMoney.toFixed(2),
          paidAmount: "0.00",
          arrears: seedMoney.toFixed(2),
          balance: "0.00",
          loanPenalty: loanPenalty.toFixed(2),
          monthlyPenalty: monthlyPenalty.toFixed(2),
          paymentDate: Timestamp.now(),
          status: "pending",
          approvedBy: null,
          approvalStatus: "pending",
        },
        "Monthly Contribution": {
          paymentId: `MonthlyContribution-${Date.now()}`,
          totalAmount: monthlyContribution.toFixed(2),
          paidAmount: "0.00",
          arrears: monthlyContribution.toFixed(2),
          balance: "0.00",
          loanPenalty: loanPenalty.toFixed(2),
          monthlyPenalty: monthlyPenalty.toFixed(2),
          paymentDate: Timestamp.now(),
          status: "pending",
          approvedBy: null,
          approvalStatus: "pending",
        },
      }
    });

    console.log(`✅ Payments initialized for member ${memberName}`);
  } catch (error) {
    console.error("❌ Error initializing payments:", error);
  }
}
