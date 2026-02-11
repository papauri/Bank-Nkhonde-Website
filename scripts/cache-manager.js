/**
 * Cache Manager for Bank Nkhonde
 * Provides intelligent client-side caching to reduce Firestore reads and improve performance
 */

class CacheManager {
  constructor(cacheTimeout = 300000) { // Default 5 minutes
    this.cache = new Map();
    this.cacheTimeout = cacheTimeout;
    this.cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      invalidations: 0
    };
  }

  /**
   * Generate a cache key from parameters
   */
  _generateKey(prefix, ...params) {
    return `${prefix}_${params.join('_')}`;
  }

  /**
   * Check if a cache entry is still valid
   */
  _isValid(entry) {
    if (!entry) return false;
    const age = Date.now() - entry.timestamp;
    return age < this.cacheTimeout;
  }

  /**
   * Get data from cache
   */
  get(prefix, ...params) {
    const key = this._generateKey(prefix, ...params);
    const entry = this.cache.get(key);

    if (entry && this._isValid(entry)) {
      this.cacheStats.hits++;
      console.log(`Cache HIT: ${key}`);
      return entry.data;
    }

    this.cacheStats.misses++;
    console.log(`Cache MISS: ${key}`);
    return null;
  }

  /**
   * Set data in cache
   */
  set(prefix, data, ...params) {
    const key = this._generateKey(prefix, ...params);
    this.cache.set(key, {
      data: data,
      timestamp: Date.now()
    });
    this.cacheStats.sets++;
    console.log(`Cache SET: ${key}`);
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(prefix, ...params) {
    const key = this._generateKey(prefix, ...params);
    if (this.cache.has(key)) {
      this.cache.delete(key);
      this.cacheStats.invalidations++;
      console.log(`Cache INVALIDATE: ${key}`);
    }
  }

  /**
   * Invalidate all cache entries for a group
   */
  invalidateGroup(groupId) {
    const keysToDelete = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(`_${groupId}_`) || key.startsWith(`group_${groupId}`)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.cacheStats.invalidations++;
    });

    console.log(`Cache INVALIDATE GROUP: ${groupId} (${keysToDelete.length} entries)`);
  }

  /**
   * Invalidate all cache entries for a user
   */
  invalidateUser(userId) {
    const keysToDelete = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(`_${userId}_`) || key.startsWith(`user_${userId}`)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.cacheStats.invalidations++;
    });

    console.log(`Cache INVALIDATE USER: ${userId} (${keysToDelete.length} entries)`);
  }

  /**
   * Clear all cache
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.cacheStats.invalidations += size;
    console.log(`Cache CLEAR: ${size} entries`);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const totalRequests = this.cacheStats.hits + this.cacheStats.misses;
    const hitRate = totalRequests > 0 
      ? ((this.cacheStats.hits / totalRequests) * 100).toFixed(2) 
      : 0;

    return {
      ...this.cacheStats,
      currentSize: this.cache.size,
      hitRate: `${hitRate}%`
    };
  }

  /**
   * Log cache statistics
   */
  logStats() {
    const stats = this.getStats();
    console.table({
      'Cache Hits': stats.hits,
      'Cache Misses': stats.misses,
      'Cache Sets': stats.sets,
      'Invalidations': stats.invalidations,
      'Current Size': stats.currentSize,
      'Hit Rate': stats.hitRate
    });
  }
}

// Global cache instance
const cache = new CacheManager();

/**
 * Get group members with caching
 */
async function getGroupMembers(db, groupId, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = cache.get('members', groupId);
    if (cached) {
      return cached;
    }
  }

  // Fetch from Firestore
  const snap = await getDocs(collection(db, `groups/${groupId}/members`));
  const members = [];
  
  snap.forEach(doc => {
    members.push({ id: doc.id, ...doc.data() });
  });

  // Cache the result
  cache.set('members', members, groupId);

  return members;
}

/**
 * Get group data with caching
 */
async function getGroupData(db, groupId, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = cache.get('group', groupId);
    if (cached) {
      return cached;
    }
  }

  // Fetch from Firestore
  const docSnap = await getDoc(doc(db, `groups/${groupId}`));
  
  if (!docSnap.exists()) {
    throw new Error('Group not found');
  }

  const groupData = { id: docSnap.id, ...docSnap.data() };

  // Cache the result
  cache.set('group', groupData, groupId);

  return groupData;
}

/**
 * Get payments with caching
 */
async function getPayments(db, groupId, userId = null, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = cache.get('payments', groupId, userId || 'all');
    if (cached) {
      return cached;
    }
  }

  // Build query
  let q;
  if (userId) {
    q = query(
      collection(db, `groups/${groupId}/payments`),
      where('userId', '==', userId)
    );
  } else {
    q = collection(db, `groups/${groupId}/payments`);
  }

  // Fetch from Firestore
  const snap = await getDocs(q);
  const payments = [];
  
  snap.forEach(doc => {
    payments.push({ id: doc.id, ...doc.data() });
  });

  // Cache the result
  cache.set('payments', payments, groupId, userId || 'all');

  return payments;
}

/**
 * Get loans with caching
 */
async function getLoans(db, groupId, userId = null, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = cache.get('loans', groupId, userId || 'all');
    if (cached) {
      return cached;
    }
  }

  // Build query
  let q;
  if (userId) {
    q = query(
      collection(db, `groups/${groupId}/loans`),
      where('borrowerId', '==', userId)
    );
  } else {
    q = query(
      collection(db, `groups/${groupId}/loans`),
      orderBy('requestedAt', 'desc')
    );
  }

  // Fetch from Firestore
  const snap = await getDocs(q);
  const loans = [];
  
  snap.forEach(doc => {
    loans.push({ id: doc.id, ...doc.data() });
  });

  // Cache the result
  cache.set('loans', loans, groupId, userId || 'all');

  return loans;
}

/**
 * Get transactions with caching
 */
async function getTransactions(db, groupId, limit = 50, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = cache.get('transactions', groupId, limit);
    if (cached) {
      return cached;
    }
  }

  // Fetch from Firestore
  const q = query(
    collection(db, `groups/${groupId}/transactions`),
    orderBy('createdAt', 'desc'),
    limit(limit)
  );

  const snap = await getDocs(q);
  const transactions = [];
  
  snap.forEach(doc => {
    transactions.push({ id: doc.id, ...doc.data() });
  });

  // Cache the result
  cache.set('transactions', transactions, groupId, limit);

  return transactions;
}

/**
 * Get notifications with caching
 */
async function getNotifications(db, userId, unreadOnly = false, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = cache.get('notifications', userId, unreadOnly ? 'unread' : 'all');
    if (cached) {
      return cached;
    }
  }

  // Build query
  let q = query(
    collection(db, 'notifications'),
    where('recipientId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(50)
  );

  // If unread only, add filter
  if (unreadOnly) {
    q = query(
      collection(db, 'notifications'),
      where('recipientId', '==', userId),
      where('read', '==', false),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
  }

  // Fetch from Firestore
  const snap = await getDocs(q);
  const notifications = [];
  
  snap.forEach(doc => {
    notifications.push({ id: doc.id, ...doc.data() });
  });

  // Cache the result
  cache.set('notifications', notifications, userId, unreadOnly ? 'unread' : 'all');

  return notifications;
}

/**
 * Get user data with caching
 */
async function getUserData(db, userId, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = cache.get('user', userId);
    if (cached) {
      return cached;
    }
  }

  // Fetch from Firestore
  const docSnap = await getDoc(doc(db, `users/${userId}`));
  
  if (!docSnap.exists()) {
    throw new Error('User not found');
  }

  const userData = { id: docSnap.id, ...docSnap.data() };

  // Cache the result
  cache.set('user', userData, userId);

  return userData;
}

/**
 * Calculate financial summary for a member with caching
 */
async function calculateMemberFinancialSummary(db, groupId, userId, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = cache.get('summary', groupId, userId);
    if (cached) {
      return cached;
    }
  }

  // Get all payments for the user
  const payments = await getPayments(db, groupId, userId, forceRefresh);

  // Calculate summary
  let totalPaid = 0;
  let totalArrears = 0;
  let seedMoneyPaid = 0;
  let contributionsPaid = 0;
  let serviceFeePaid = 0;

  payments.forEach(payment => {
    const amountPaid = payment.amountPaid || 0;
    const arrears = payment.arrears || 0;

    totalPaid += amountPaid;
    totalArrears += arrears;

    if (payment.paymentType === 'seed_money') {
      seedMoneyPaid += amountPaid;
    } else if (payment.paymentType === 'monthly_contribution') {
      contributionsPaid += amountPaid;
    } else if (payment.paymentType === 'service_fee') {
      serviceFeePaid += amountPaid;
    }
  });

  const summary = {
    totalPaid,
    totalArrears,
    seedMoneyPaid,
    contributionsPaid,
    serviceFeePaid,
    lastUpdated: new Date()
  };

  // Cache the result
  cache.set('summary', summary, groupId, userId);

  return summary;
}

/**
 * Preload commonly used data for a group
 */
async function preloadGroupData(db, groupId) {
  console.log(`Preloading data for group: ${groupId}`);
  
  try {
    await Promise.all([
      getGroupData(db, groupId),
      getGroupMembers(db, groupId),
      getPayments(db, groupId),
      getLoans(db, groupId),
      getTransactions(db, groupId)
    ]);
    
    console.log(`Preload complete for group: ${groupId}`);
  } catch (error) {
    console.error('Error preloading group data:', error);
  }
}

/**
 * Invalidate cache after data change
 */
function invalidateAfterChange(type, groupId, userId = null) {
  switch (type) {
    case 'payment':
      cache.invalidate('payments', groupId, userId || 'all');
      cache.invalidate('summary', groupId, userId);
      cache.invalidate('transactions', groupId);
      break;
    case 'loan':
      cache.invalidate('loans', groupId, userId || 'all');
      cache.invalidate('transactions', groupId);
      break;
    case 'member':
      cache.invalidate('members', groupId);
      cache.invalidate('group', groupId);
      break;
    case 'group':
      cache.invalidateGroup(groupId);
      break;
    case 'notification':
      if (userId) {
        cache.invalidate('notifications', userId, 'unread');
        cache.invalidate('notifications', userId, 'all');
      }
      break;
  }
}

/**
 * Smart query wrapper that automatically caches results
 */
async function cachedQuery(db, queryRef, cacheKey, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = cache.get('query', cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Execute query
  const snap = await getDocs(queryRef);
  const results = [];
  
  snap.forEach(doc => {
    results.push({ id: doc.id, ...doc.data() });
  });

  // Cache the result
  cache.set('query', results, cacheKey);

  return results;
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CacheManager,
    cache,
    getGroupMembers,
    getGroupData,
    getPayments,
    getLoans,
    getTransactions,
    getNotifications,
    getUserData,
    calculateMemberFinancialSummary,
    preloadGroupData,
    invalidateAfterChange,
    cachedQuery
  };
}