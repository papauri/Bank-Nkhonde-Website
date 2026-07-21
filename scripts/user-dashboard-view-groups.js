// "Groups" quick action opens the nav's group-switcher dropdown
// (select_group.html is retired) rather than duplicating it here.
document.addEventListener('DOMContentLoaded', () => {
  const viewGroupsBtn = document.getElementById('viewGroupsBtn');
  if (viewGroupsBtn) {
    viewGroupsBtn.addEventListener('click', () => {
      const groupToggle = document.getElementById('currentGroupToggle');
      if (groupToggle) {
        groupToggle.scrollIntoView({ behavior: 'smooth', block: 'center' });
        groupToggle.click();
      }
    });
  }
});
