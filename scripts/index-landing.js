// Navigation scroll effect
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  if (window.scrollY > 50) {
    nav.classList.add('scrolled');
  } else {
    nav.classList.remove('scrolled');
  }
});

// Feature rows animation on scroll
const observerOptions = {
  threshold: 0.2,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, observerOptions);

document.querySelectorAll('[data-animate]').forEach(el => {
  observer.observe(el);
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const href = this.getAttribute('href');
    if (href && href.startsWith('#') && href.length > 1) {
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    }
  });
});

// Update mobile bottom nav - accessible from module and global scope
function updateMobileBottomNav(user) {
  const mobileBottomNav = document.getElementById('mobileBottomNav');
  if (!mobileBottomNav) return;

  const isMobile = window.innerWidth <= 768;

  if (user && isMobile) {
    mobileBottomNav.style.display = 'block';
    const dashboardLink = document.getElementById('mobileDashboardLink');
    const signOutBtn = document.getElementById('mobileBottomNavSignOut');

    if (dashboardLink) {
      const isAdmin = sessionStorage.getItem('isAdmin') === 'true' || localStorage.getItem('isAdmin') === 'true';
      dashboardLink.href = isAdmin ? 'pages/admin_dashboard.html' : 'pages/user_dashboard.html';
    }

    if (signOutBtn) {
      signOutBtn.onclick = async (e) => {
        e.preventDefault();
        try {
          const { logout: apiLogout } = await import('./scripts/api.js');
          await apiLogout();
        } catch (error) {
          console.error('Error signing out:', error);
        } finally {
          sessionStorage.clear();
          localStorage.removeItem('selectedGroupId');
          localStorage.removeItem('isAdmin');
          window.location.reload();
        }
      };
    }
  } else {
    mobileBottomNav.style.display = 'none';
  }
}

// Expose to window for resize listener
window.updateMobileBottomNav = updateMobileBottomNav;

// Update mobile bottom nav on resize
window.addEventListener('resize', () => {
  if (typeof currentAuthUser !== 'undefined') {
    updateMobileBottomNav(currentAuthUser);
  }
});
