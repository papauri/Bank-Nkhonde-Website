// Animate chart bars on load
setTimeout(() => {
  document.querySelectorAll('.chart-bar').forEach(bar => {
    bar.classList.add('animated');
  });
}, 500);

// Demo alert
function addSystemAlert(title, type = 'success') {
  const container = document.getElementById('systemAlerts');
  const icons = {
    success: '✓',
    warning: '⚠',
    danger: '✕',
    info: 'ℹ'
  };

  const alert = document.createElement('div');
  alert.className = `alert-item ${type}`;
  alert.innerHTML = `
    <div class="alert-icon">${icons[type]}</div>
    <div class="alert-content">
      <div class="alert-title">${title}</div>
      <div class="alert-time">Just now</div>
    </div>
    <button class="alert-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.insertBefore(alert, container.firstChild);

  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (alert.parentElement) {
      alert.style.opacity = '0';
      alert.style.transform = 'translateX(100%)';
      setTimeout(() => alert.remove(), 300);
    }
  }, 10000);
}
