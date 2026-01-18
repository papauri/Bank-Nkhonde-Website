/**
 * Payment Details Table Component
 * Displays comprehensive payment information in a simple table format
 * Works for both user dashboard (own payments) and admin dashboard (any user's payments)
 */

import {
  db,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "./firebaseConfig.js";

/**
 * Load and display payment details table
 * @param {string} groupId - Group ID
 * @param {string} userId - User/Member ID (null for all users in admin view)
 * @param {HTMLElement} container - Container element to render table
 * @param {boolean} isAdminView - Whether this is admin viewing or user viewing own payments
 */
export async function loadPaymentDetailsTable(groupId, userId, container, isAdminView = false) {
  if (!container) {
    console.error("Container element not found");
    return;
  }

  container.innerHTML = '<div style="padding: var(--bn-space-4); text-align: center;"><div class="spinner"></div><p>Loading payment details...</p></div>';

  try {
    const currentYear = new Date().getFullYear();
    const yearsToCheck = [currentYear - 1, currentYear, currentYear + 1];
    
    const allPayments = [];
    
    // Get members - either single user or all members
    let members = [];
    if (userId && isAdminView) {
      // Admin viewing specific user
      const memberDoc = await getDoc(doc(db, `groups/${groupId}/members`, userId));
      if (memberDoc.exists()) {
        members.push({ id: userId, ...memberDoc.data() });
      }
    } else if (!userId && isAdminView) {
      // Admin viewing all users
      const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
      membersSnapshot.forEach((doc) => {
        members.push({ id: doc.id, ...doc.data() });
      });
    } else {
      // User viewing own payments
      members.push({ id: userId });
    }

    if (members.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No members found</p></div>';
      return;
    }

    // Load seed money payments
    for (const member of members) {
      for (const year of yearsToCheck) {
        try {
          const seedRef = doc(db, `groups/${groupId}/payments/${year}_SeedMoney/${member.id}/PaymentDetails`);
          const seedDoc = await getDoc(seedRef);
          
          if (seedDoc.exists()) {
            const data = seedDoc.data();
            const amountPaid = parseFloat(data.amountPaid || 0);
            const totalAmount = parseFloat(data.totalAmount || 0);
            const arrears = parseFloat(data.arrears || 0);
            
            if (amountPaid > 0 || arrears > 0) {
              const dueDate = data.dueDate?.toDate ? data.dueDate.toDate() : null;
              const paidAt = data.paidAt?.toDate ? data.paidAt.toDate() : null;
              const approvedAt = data.approvedAt?.toDate ? data.approvedAt.toDate() : null;
              
              allPayments.push({
                date: paidAt || approvedAt || dueDate || new Date(),
                type: "Seed Money",
                month: null,
                year: year,
                memberName: member.fullName || member.name || "Unknown",
                memberId: member.id,
                totalAmount: totalAmount,
                amountPaid: amountPaid,
                arrears: arrears,
                status: data.approvalStatus || data.paymentStatus || "unpaid",
                dueDate: dueDate,
                paidAt: paidAt,
                approvedAt: approvedAt,
                paymentMethod: data.paymentMethod || "N/A",
                isAdvancedPayment: data.isAdvancedPayment || false,
                proofOfPayment: data.proofOfPayment
              });
            }
          }
        } catch (e) {
          // Document might not exist for this year
        }
      }
    }

    // Load monthly contribution payments
    for (const member of members) {
      for (const year of yearsToCheck) {
        try {
          const monthlyRef = collection(db, `groups/${groupId}/payments/${year}_MonthlyContributions/${member.id}`);
          const monthlySnapshot = await getDocs(monthlyRef);
          
          monthlySnapshot.forEach((monthDoc) => {
            const data = monthDoc.data();
            const amountPaid = parseFloat(data.amountPaid || 0);
            const totalAmount = parseFloat(data.totalAmount || 0);
            const arrears = parseFloat(data.arrears || 0);
            
            if (amountPaid > 0 || arrears > 0) {
              const dueDate = data.dueDate?.toDate ? data.dueDate.toDate() : null;
              const paidAt = data.paidAt?.toDate ? data.paidAt.toDate() : null;
              const approvedAt = data.approvedAt?.toDate ? data.approvedAt.toDate() : null;
              
              allPayments.push({
                date: paidAt || approvedAt || dueDate || new Date(),
                type: "Monthly Contribution",
                month: data.month || monthDoc.id,
                year: data.year || year,
                memberName: member.fullName || member.name || "Unknown",
                memberId: member.id,
                totalAmount: totalAmount,
                amountPaid: amountPaid,
                arrears: arrears,
                status: data.approvalStatus || data.paymentStatus || "unpaid",
                dueDate: dueDate,
                paidAt: paidAt,
                approvedAt: approvedAt,
                paymentMethod: data.paymentMethod || "N/A",
                isAdvancedPayment: data.isAdvancedPayment || false,
                proofOfPayment: data.proofOfPayment
              });
            }
          });
        } catch (e) {
          // Collection might not exist
        }
      }

      // Load Service Fee payments
      for (const year of yearsToCheck) {
        try {
          const serviceFeeRef = doc(db, `groups/${groupId}/payments/${year}_ServiceFee/${member.id}/PaymentDetails`);
          const serviceFeeDoc = await getDoc(serviceFeeRef);
          
          if (serviceFeeDoc.exists()) {
            const data = serviceFeeDoc.data();
            const amountPaid = parseFloat(data.amountPaid || 0);
            const totalAmount = parseFloat(data.totalAmount || 0);
            const arrears = parseFloat(data.arrears || 0);
            
            if (amountPaid > 0 || arrears > 0) {
              const dueDate = data.dueDate?.toDate ? data.dueDate.toDate() : null;
              const paidAt = data.paidAt?.toDate ? data.paidAt.toDate() : null;
              const approvedAt = data.approvedAt?.toDate ? data.approvedAt.toDate() : null;
              
              allPayments.push({
                date: paidAt || approvedAt || dueDate || new Date(),
                type: "Service Fee",
                month: null,
                year: year,
                memberName: member.fullName || member.name || "Unknown",
                memberId: member.id,
                totalAmount: totalAmount,
                amountPaid: amountPaid,
                arrears: arrears,
                status: data.approvalStatus || data.paymentStatus || "unpaid",
                dueDate: dueDate,
                paidAt: paidAt,
                approvedAt: approvedAt,
                paymentMethod: data.paymentMethod || "N/A",
                isAdvancedPayment: data.isAdvancedPayment || false,
                proofOfPayment: data.proofOfPayment,
                perCycle: data.perCycle || true,
                nonRefundable: data.nonRefundable || true
              });
            }
          }
        } catch (e) {
          // Document might not exist for this year
        }
      }
    }

    // Sort by date (newest first)
    allPayments.sort((a, b) => b.date - a.date);

    // Render table
    renderPaymentDetailsTable(allPayments, container, isAdminView);

  } catch (error) {
    console.error("Error loading payment details:", error);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❌</div><p class="empty-state-text">Error loading payment details: ${error.message}</p></div>`;
  }
}

/**
 * Render payment details table
 */
function renderPaymentDetailsTable(payments, container, isAdminView) {
  if (payments.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No payment records found</p></div>';
    return;
  }

  // Calculate totals
  const totals = {
    totalAmount: 0,
    amountPaid: 0,
    arrears: 0
  };

  payments.forEach(p => {
    totals.totalAmount += p.totalAmount;
    totals.amountPaid += p.amountPaid;
    totals.arrears += p.arrears;
  });

  const isMobile = window.innerWidth <= 767;
  const tableCellPadding = isMobile ? 'var(--bn-space-1) var(--bn-space-2)' : 'var(--bn-space-3) var(--bn-space-4)';
  const tableFontSize = isMobile ? '10px' : 'var(--bn-text-xs)';

  let html = `
    <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
      <table style="width: 100%; ${isMobile ? 'min-width: 800px;' : ''} border-collapse: collapse; background: var(--bn-white); border-radius: var(--bn-radius-lg); overflow: hidden;">
        <thead>
          <tr style="background: var(--bn-gray-100); border-bottom: 2px solid var(--bn-gray-lighter);">
            ${isAdminView ? `<th style="padding: ${tableCellPadding}; text-align: left; font-weight: 600; color: var(--bn-dark); font-size: ${tableFontSize}; text-transform: uppercase; white-space: nowrap;">Member</th>` : ''}
            <th style="padding: ${tableCellPadding}; text-align: left; font-weight: 600; color: var(--bn-dark); font-size: ${tableFontSize}; text-transform: uppercase; white-space: nowrap;">Date</th>
            <th style="padding: ${tableCellPadding}; text-align: left; font-weight: 600; color: var(--bn-dark); font-size: ${tableFontSize}; text-transform: uppercase; white-space: nowrap;">Type</th>
            <th style="padding: ${tableCellPadding}; text-align: left; font-weight: 600; color: var(--bn-dark); font-size: ${tableFontSize}; text-transform: uppercase; white-space: nowrap;">Period</th>
            <th style="padding: ${tableCellPadding}; text-align: right; font-weight: 600; color: var(--bn-dark); font-size: ${tableFontSize}; text-transform: uppercase; white-space: nowrap;">Total</th>
            <th style="padding: ${tableCellPadding}; text-align: right; font-weight: 600; color: var(--bn-dark); font-size: ${tableFontSize}; text-transform: uppercase; white-space: nowrap;">Paid</th>
            <th style="padding: ${tableCellPadding}; text-align: right; font-weight: 600; color: var(--bn-dark); font-size: ${tableFontSize}; text-transform: uppercase; white-space: nowrap;">Arrears</th>
            <th style="padding: ${tableCellPadding}; text-align: center; font-weight: 600; color: var(--bn-dark); font-size: ${tableFontSize}; text-transform: uppercase; white-space: nowrap;">Status</th>
            <th style="padding: ${tableCellPadding}; text-align: left; font-weight: 600; color: var(--bn-dark); font-size: ${tableFontSize}; text-transform: uppercase; white-space: nowrap;">Method</th>
          </tr>
        </thead>
        <tbody>
  `;

  payments.forEach((payment, index) => {
    const dateStr = payment.date ? payment.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
    const periodStr = payment.month ? `${payment.month} ${payment.year}` : `Year ${payment.year}`;
    const statusClass = payment.status === 'approved' || payment.status === 'completed' ? 'success' : 
                       payment.status === 'pending' ? 'warning' : 'danger';
    const statusText = payment.status === 'approved' ? 'Approved' : 
                      payment.status === 'completed' ? 'Completed' : 
                      payment.status === 'pending' ? 'Pending' : 
                      'Unpaid';
    
    const rowBg = index % 2 === 0 ? 'var(--bn-white)' : 'var(--bn-gray-50)';
    
    const cellFontSize = isMobile ? '10px' : 'var(--bn-text-sm)';
    const badgeFontSize = isMobile ? '9px' : 'var(--bn-text-xs)';
    const badgePadding = isMobile ? '2px 6px' : '4px 12px';
    
    html += `
      <tr style="background: ${rowBg}; border-bottom: 1px solid var(--bn-gray-lighter); transition: background var(--bn-transition-fast);" onmouseover="this.style.background='var(--bn-gray-100)'" onmouseout="this.style.background='${rowBg}'">
        ${isAdminView ? `<td style="padding: ${tableCellPadding}; font-weight: 600; color: var(--bn-dark); font-size: ${cellFontSize}; white-space: nowrap;">${payment.memberName}</td>` : ''}
        <td style="padding: ${tableCellPadding}; color: var(--bn-gray); font-size: ${cellFontSize}; white-space: nowrap;">${dateStr}</td>
        <td style="padding: ${tableCellPadding}; font-size: ${cellFontSize}; white-space: nowrap;">
          <span style="font-weight: 600; color: var(--bn-dark);">${payment.type}</span>
          ${payment.isAdvancedPayment ? `<span style="margin-left: ${isMobile ? '4px' : 'var(--bn-space-2)'}; font-size: ${badgeFontSize}; padding: ${badgePadding}; background: var(--bn-info-light); color: var(--bn-info); border-radius: var(--bn-radius-sm);">Advanced</span>` : ''}
        </td>
        <td style="padding: ${tableCellPadding}; color: var(--bn-gray); font-size: ${cellFontSize}; white-space: nowrap;">${periodStr}</td>
        <td style="padding: ${tableCellPadding}; text-align: right; font-weight: 600; color: var(--bn-dark); font-size: ${cellFontSize}; white-space: nowrap;">MWK ${payment.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding: ${tableCellPadding}; text-align: right; font-weight: 600; color: var(--bn-success); font-size: ${cellFontSize}; white-space: nowrap;">MWK ${payment.amountPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding: ${tableCellPadding}; text-align: right; font-weight: 600; color: ${payment.arrears > 0 ? 'var(--bn-danger)' : 'var(--bn-success)'}; font-size: ${cellFontSize}; white-space: nowrap;">MWK ${payment.arrears.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding: ${tableCellPadding}; text-align: center; font-size: ${cellFontSize}; white-space: nowrap;">
          <span class="badge badge-${statusClass}" style="font-size: ${badgeFontSize}; padding: ${badgePadding};">${statusText}</span>
        </td>
        <td style="padding: ${tableCellPadding}; color: var(--bn-gray); font-size: ${cellFontSize}; text-transform: capitalize; white-space: nowrap;">${payment.paymentMethod.replace(/_/g, ' ')}</td>
      </tr>
    `;
  });

  // Totals row
  const totalsCellPadding = isMobile ? 'var(--bn-space-2)' : 'var(--bn-space-4)';
  const totalsFontSize = isMobile ? '11px' : 'var(--bn-text-sm)';
  const totalsAmountFontSize = isMobile ? '11px' : 'var(--bn-text-base)';
  
  html += `
          <tr style="background: var(--bn-primary); color: var(--bn-white); font-weight: 700;">
            <td colspan="${isAdminView ? '5' : '4'}" style="padding: ${totalsCellPadding}; text-align: right; font-size: ${totalsFontSize}; text-transform: uppercase; white-space: nowrap;">TOTAL:</td>
            <td style="padding: ${totalsCellPadding}; text-align: right; font-size: ${totalsAmountFontSize}; white-space: nowrap;">MWK ${totals.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding: ${totalsCellPadding}; text-align: right; font-size: ${totalsAmountFontSize}; white-space: nowrap;">MWK ${totals.amountPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding: ${totalsCellPadding}; text-align: right; font-size: ${totalsAmountFontSize}; white-space: nowrap;">MWK ${totals.arrears.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td colspan="2" style="padding: ${totalsCellPadding};"></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}
