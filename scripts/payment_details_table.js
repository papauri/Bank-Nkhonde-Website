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
 * @param {Object} options - Optional configuration
 * @param {Date} options.filterArrearsBeforeDate - Only show payments with dueDate before this date (for arrears view)
 * @param {Function} options.onRowClick - Callback when a row is clicked (for click-to-pay functionality)
 */
export async function loadPaymentDetailsTable(groupId, userId, container, isAdminView = false, options = {}) {
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
                paymentTypeKey: "seed_money",
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
                paymentTypeKey: "monthly_contribution",
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
                paymentTypeKey: "service_fee",
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

    // Sort by due date (oldest first for arrears view, so most overdue appears first)
    if (options.filterArrearsBeforeDate) {
      allPayments.sort((a, b) => {
        const dateA = a.dueDate || a.date;
        const dateB = b.dueDate || b.date;
        return dateA - dateB; // Oldest first (most overdue)
      });
    } else {
      // Default: sort by date (newest first)
      allPayments.sort((a, b) => b.date - a.date);
    }

    // Render table
    renderPaymentDetailsTable(allPayments, container, isAdminView, options);

  } catch (error) {
    console.error("Error loading payment details:", error);
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">❌</div><p class="empty-state-text">Error loading payment details: ${error.message}</p></div>`;
  }
}

/**
 * Render payment details table
 */
function renderPaymentDetailsTable(payments, container, isAdminView, options = {}) {
  // Filter by date if specified (for arrears view - only show overdue payments)
  let filteredPayments = payments;
  if (options.filterArrearsBeforeDate) {
    const filterDate = new Date(options.filterArrearsBeforeDate);
    filterDate.setHours(23, 59, 59, 999); // End of day
    filteredPayments = payments.filter(p => {
      // Only include if has arrears AND due date is before filter date (overdue)
      const hasArrears = p.arrears > 0;
      const isOverdue = p.dueDate && p.dueDate < filterDate;
      return hasArrears && isOverdue;
    });
  }

  if (filteredPayments.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p class="empty-state-text">No payment records found</p></div>';
    return;
  }

  // Calculate totals based on filtered payments
  const totals = {
    totalAmount: 0,
    amountPaid: 0,
    arrears: 0
  };

  filteredPayments.forEach(p => {
    totals.totalAmount += p.totalAmount;
    totals.amountPaid += p.amountPaid;
    totals.arrears += p.arrears;
  });

  const memberCol = isAdminView ? '<th>Member</th>' : '';
  const memberTotalColspan = isAdminView ? 5 : 4;
  const isArrearsView = !!options.filterArrearsBeforeDate;

  let html = `
    <div class="table-container" style="width: 100%; overflow-x: auto;">
      <table class="table table-responsive" style="min-width: ${isArrearsView ? '900px' : '1100px'}; table-layout: auto;">
        <thead>
          <tr>
            ${memberCol}
            <th>Due Date</th>
            <th>Type</th>
            <th>Period</th>
            <th class="cell-right">Arrears</th>
            <th class="cell-center">Status</th>
            ${isArrearsView ? '<th class="cell-center">Action</th>' : ''}
          </tr>
        </thead>
        <tbody>
  `;

  filteredPayments.forEach((payment, index) => {
    const dueDateStr = payment.dueDate ? payment.dueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
    const periodStr = payment.month ? `${payment.month} ${payment.year}` : `Year ${payment.year}`;
    
    // Calculate days overdue
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = payment.dueDate ? new Date(payment.dueDate) : null;
    const daysOverdue = dueDate ? Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)) : 0;
    
    const statusClass = payment.status === 'approved' || payment.status === 'completed' ? 'success' : 
                       payment.status === 'pending' ? 'warning' : 'danger';
    const statusText = payment.status === 'approved' ? 'Approved' : 
                      payment.status === 'completed' ? 'Completed' : 
                      payment.status === 'pending' ? 'Pending' : 
                      'Unpaid';
    
    const arrearsClass = payment.arrears > 0 ? 'cell-danger' : 'cell-success';
    const memberTd = isAdminView ? `<td data-label="Member" class="cell-name cell-nowrap">${payment.memberName}</td>` : '';
    
    // Row click handler for arrears view
    const rowClickAttr = isArrearsView && payment.arrears > 0 ? 
      `onclick="window.arrearsRowClick && window.arrearsRowClick(${index})" style="cursor: pointer;"` : '';
    
    // Action button for arrears view
    const actionTd = isArrearsView ? 
      `<td data-label="Action" class="cell-center">
        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); window.arrearsRowClick && window.arrearsRowClick(${index})" title="Pay this arrear">
          Pay
        </button>
      </td>` : '';

    html += `
      <tr data-payment-index="${index}" ${rowClickAttr}>
        ${memberTd}
        <td data-label="Due Date" class="cell-muted cell-nowrap">
          ${dueDateStr}
          ${daysOverdue > 0 ? `<br><span style="color: var(--bn-danger); font-size: 11px;">${daysOverdue} days overdue</span>` : ''}
        </td>
        <td data-label="Type" class="cell-bold">${payment.type}</td>
        <td data-label="Period" class="cell-muted cell-nowrap">${periodStr}</td>
        <td data-label="Arrears" class="cell-right ${arrearsClass} cell-bold cell-nowrap">MWK ${payment.arrears.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
        <td data-label="Status" class="cell-center"><span class="badge badge-${statusClass}">${statusText}</span></td>
        ${actionTd}
      </tr>
    `;
  });

  html += `
        </tbody>
        <tfoot>
          <tr>
            <td colspan="${memberTotalColspan - 1}" data-label="" class="cell-right" style="text-transform:uppercase;">Total Arrears</td>
            <td data-label="Total Arrears" class="cell-right cell-bold" style="color: var(--bn-danger);">MWK ${totals.arrears.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
            <td colspan="${isArrearsView ? 2 : 1}" data-label=""></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  container.innerHTML = html;

  // Store payments data for row click callback
  if (isArrearsView && options.onRowClick) {
    // Store both the filtered payments and the callback for access from HTML onclick
    window.arrearsPaymentsData = filteredPayments;
    window.arrearsRowClick = (index) => {
      const payments = window.arrearsPaymentsData || [];
      if (payments[index]) {
        options.onRowClick(payments[index]);
      }
    };
  }
}