// Animate chart bars on load
setTimeout(() => {
  document.querySelectorAll('.chart-bar').forEach(bar => {
    bar.classList.add('animated');
  });
}, 500);
