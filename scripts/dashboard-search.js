/**
 * Dashboard Search Functionality
 * Provides global search across members, payments, and loans
 */

import {
  db,
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
} from "./firebaseConfig.js";

// Initialize search
export function initializeSearch(searchInputId, selectedGroupId) {
  const searchInput = document.getElementById(searchInputId);
  if (!searchInput) return;

  let debounceTimer;
  let searchResultsContainer = document.getElementById('searchResults');
  
  // Create search results container if it doesn't exist
  if (!searchResultsContainer) {
    searchResultsContainer = document.createElement('div');
    searchResultsContainer.id = 'searchResults';
    searchResultsContainer.className = 'search-results';
    searchResultsContainer.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid var(--bn-gray-lighter);
      border-radius: var(--bn-radius-lg);
      box-shadow: var(--bn-shadow-lg);
      max-height: 400px;
      overflow-y: auto;
      z-index: 1000;
      display: none;
    `;
    searchInput.parentElement.style.position = 'relative';
    searchInput.parentElement.appendChild(searchResultsContainer);
  }

  // Search on input
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const searchTerm = e.target.value.trim();
    
    if (searchTerm.length < 2) {
      searchResultsContainer.style.display = 'none';
      return;
    }
    
    debounceTimer = setTimeout(async () => {
      const results = await performSearch(searchTerm, selectedGroupId);
      displaySearchResults(results, searchResultsContainer);
    }, 300);
  });

  // Hide results on outside click
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResultsContainer.contains(e.target)) {
      searchResultsContainer.style.display = 'none';
    }
  });

  // Focus handling
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length >= 2) {
      searchResultsContainer.style.display = 'block';
    }
  });
}

// Perform search across members, payments, loans
async function performSearch(searchTerm, groupId) {
  const results = {
    members: [],
    payments: [],
    loans: []
  };

  if (!groupId) return results;

  const searchLower = searchTerm.toLowerCase();

  try {
    // Search members
    const membersSnapshot = await getDocs(collection(db, `groups/${groupId}/members`));
    membersSnapshot.forEach(doc => {
      const member = doc.data();
      const name = (member.fullName || '').toLowerCase();
      const email = (member.email || '').toLowerCase();
      const phone = (member.phone || '').toLowerCase();
      
      if (name.includes(searchLower) || email.includes(searchLower) || phone.includes(searchLower)) {
        results.members.push({
          id: doc.id,
          type: 'member',
          name: member.fullName,
          email: member.email,
          phone: member.phone,
          profileImageUrl: member.profileImageUrl
        });
      }
    });

    // Search loans (by borrower name)
    const loansSnapshot = await getDocs(collection(db, `groups/${groupId}/loans`));
    loansSnapshot.forEach(doc => {
      const loan = doc.data();
      const borrowerName = (loan.borrowerName || '').toLowerCase();
      
      if (borrowerName.includes(searchLower)) {
        results.loans.push({
          id: doc.id,
          type: 'loan',
          borrowerName: loan.borrowerName,
          amount: loan.loanAmount,
          status: loan.status
        });
      }
    });

  } catch (error) {
    console.error('Search error:', error);
  }

  return results;
}

// Display search results
function displaySearchResults(results, container) {
  const totalResults = results.members.length + results.payments.length + results.loans.length;
  
  if (totalResults === 0) {
    container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--bn-gray);">No results found</div>';
    container.style.display = 'block';
    return;
  }

  let html = '';

  // Members section
  if (results.members.length > 0) {
    html += '<div style="padding: 8px 16px; font-size: 12px; font-weight: 600; color: var(--bn-gray); text-transform: uppercase; background: var(--bn-gray-100);">Members</div>';
    results.members.forEach(member => {
      const initials = getInitials(member.name);
      html += `
        <a href="manage_members.html?search=${encodeURIComponent(member.name)}" class="search-result-item" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--bn-gradient-primary); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 12px; overflow: hidden;">
            ${member.profileImageUrl ? `<img src="${member.profileImageUrl}" style="width: 100%; height: 100%; object-fit: cover;">` : initials}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--bn-dark);">${member.name}</div>
            <div style="font-size: 12px; color: var(--bn-gray);">${member.email || member.phone || 'Member'}</div>
          </div>
        </a>
      `;
    });
  }

  // Loans section
  if (results.loans.length > 0) {
    html += '<div style="padding: 8px 16px; font-size: 12px; font-weight: 600; color: var(--bn-gray); text-transform: uppercase; background: var(--bn-gray-100);">Loans</div>';
    results.loans.forEach(loan => {
      const statusColor = loan.status === 'active' ? 'var(--bn-success)' : loan.status === 'overdue' ? 'var(--bn-danger)' : 'var(--bn-gray)';
      html += `
        <a href="manage_loans.html?loanId=${loan.id}" class="search-result-item" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; text-decoration: none; color: inherit; border-bottom: 1px solid var(--bn-gray-lighter); cursor: pointer;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--bn-accent-light); display: flex; align-items: center; justify-content: center; color: var(--bn-accent-dark); font-size: 16px;">💰</div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--bn-dark);">${loan.borrowerName}</div>
            <div style="font-size: 12px; color: var(--bn-gray);">MWK ${(loan.amount || 0).toLocaleString()}</div>
          </div>
          <span style="font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: ${statusColor}15; color: ${statusColor};">${loan.status}</span>
        </a>
      `;
    });
  }

  container.innerHTML = html;
  container.style.display = 'block';

  // Add hover effect
  container.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--bn-gray-100)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = '';
    });
  });
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}
