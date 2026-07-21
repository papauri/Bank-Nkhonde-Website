// Multi-step form navigation
let currentStep = 1;
const totalSteps = 5;
const additionalAdmins = [];
let rulesFile = null;

// DOM Elements
const form = document.getElementById('registrationForm');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const submitBtn = document.getElementById('submitBtn');
const steps = document.querySelectorAll('.step');
const stepConnectors = document.querySelectorAll('.step-connector');
const formSteps = document.querySelectorAll('.form-step');

// Set default dates
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const seedMoneyDue = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  document.getElementById('cycleStartDate').value = nextMonth.toISOString().split('T')[0];
  document.getElementById('seedMoneyDueDate').value = seedMoneyDue.toISOString().split('T')[0];

  // Initialize currency formatting
  initCurrencyInputs();

  // File upload handlers
  initFileUpload();


  // Dynamic interest rate inputs based on max repayment period
  initDynamicInterestRates();
  document.getElementById('maxRepaymentMonths').addEventListener('change', initDynamicInterestRates);

  // Password visibility toggles
  initPasswordToggles();

  // Real-time password validation
  initPasswordValidation();

  // Penalty type toggle
  initPenaltyTypeToggle();
});

// Password visibility toggle
function initPasswordToggles() {
  const togglePassword = document.getElementById('togglePassword');
  const toggleConfirmPassword = document.getElementById('toggleConfirmPassword');
  const passwordInput = document.getElementById('password');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const eyeIcon = document.getElementById('eyeIcon');
  const eyeOffIcon = document.getElementById('eyeOffIcon');
  const eyeIcon2 = document.getElementById('eyeIcon2');
  const eyeOffIcon2 = document.getElementById('eyeOffIcon2');

  if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
      const type = passwordInput.type === 'password' ? 'text' : 'password';
      passwordInput.type = type;
      if (eyeIcon && eyeOffIcon) {
        eyeIcon.style.display = type === 'password' ? 'block' : 'none';
        eyeOffIcon.style.display = type === 'password' ? 'none' : 'block';
      }
      togglePassword.setAttribute('aria-label', type === 'password' ? 'Show password' : 'Hide password');
    });
  }

  if (toggleConfirmPassword && confirmPasswordInput) {
    toggleConfirmPassword.addEventListener('click', () => {
      const type = confirmPasswordInput.type === 'password' ? 'text' : 'password';
      confirmPasswordInput.type = type;
      if (eyeIcon2 && eyeOffIcon2) {
        eyeIcon2.style.display = type === 'password' ? 'block' : 'none';
        eyeOffIcon2.style.display = type === 'password' ? 'none' : 'block';
      }
      toggleConfirmPassword.setAttribute('aria-label', type === 'password' ? 'Show password' : 'Hide password');
    });
  }
}

// Password validation
function initPasswordValidation() {
  const passwordInput = document.getElementById('password');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const passwordStrength = document.getElementById('passwordStrength');
  const passwordStrengthText = document.getElementById('passwordStrengthText');
  const strengthBars = document.querySelectorAll('.strength-bar');
  const confirmPasswordMatch = document.getElementById('confirmPasswordMatch');

  if (passwordInput && passwordStrength) {
    passwordInput.addEventListener('input', () => {
      const password = passwordInput.value;
      passwordStrength.style.display = password ? 'block' : 'none';

      let strength = 0;
      let strengthText = '';
      let strengthColor = '';

      if (password.length >= 6) strength++;
      if (password.length >= 8) strength++;
      if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
      if (/\d/.test(password)) strength++;
      if (/[^a-zA-Z0-9]/.test(password)) strength++;

      if (strength <= 1) {
        strengthText = 'Weak';
        strengthColor = '#EF4444';
      } else if (strength === 2) {
        strengthText = 'Fair';
        strengthColor = '#F59E0B';
      } else if (strength === 3) {
        strengthText = 'Good';
        strengthColor = '#10B981';
      } else {
        strengthText = 'Strong';
        strengthColor = '#059669';
      }

      strengthBars.forEach((bar, index) => {
        bar.style.background = index < strength ? strengthColor : 'var(--bn-gray-lighter)';
      });

      passwordStrengthText.textContent = strengthText;
      passwordStrengthText.style.color = strengthColor;

      // Check confirm password match
      checkPasswordMatch();
    });
  }

  if (confirmPasswordInput) {
    confirmPasswordInput.addEventListener('input', checkPasswordMatch);
  }

  function checkPasswordMatch() {
    const password = passwordInput?.value || '';
    const confirmPassword = confirmPasswordInput?.value || '';

    if (confirmPassword && confirmPasswordMatch) {
      if (password === confirmPassword) {
        confirmPasswordMatch.textContent = '✓ Passwords match';
        confirmPasswordMatch.style.color = '#10B981';
        confirmPasswordMatch.style.display = 'block';
      } else {
        confirmPasswordMatch.textContent = '✗ Passwords do not match';
        confirmPasswordMatch.style.color = '#EF4444';
        confirmPasswordMatch.style.display = 'block';
      }
    }
  }
}

// Penalty type toggle
function initPenaltyTypeToggle() {
  const penaltyTypePercentage = document.getElementById('penaltyTypePercentage');
  const penaltyTypeFixed = document.getElementById('penaltyTypeFixed');
  const dailyPenaltyLabel = document.getElementById('dailyPenaltyLabel');
  const maxPenaltyLabel = document.getElementById('maxPenaltyLabel');
  const dailyPenaltyPercentageInput = document.getElementById('dailyPenaltyPercentageInput');
  const dailyPenaltyFixedInput = document.getElementById('dailyPenaltyFixedInput');
  const maxPenaltyPercentageInput = document.getElementById('maxPenaltyPercentageInput');
  const maxPenaltyFixedInput = document.getElementById('maxPenaltyFixedInput');

  function togglePenaltyInputs() {
    const isPercentage = penaltyTypePercentage.checked;

    if (dailyPenaltyLabel) {
      dailyPenaltyLabel.textContent = isPercentage ? 'Daily Penalty Rate (%)' : 'Daily Penalty Amount (MWK)';
    }
    if (maxPenaltyLabel) {
      maxPenaltyLabel.textContent = isPercentage ? 'Maximum Penalty Cap (%)' : 'Maximum Penalty Cap (MWK)';
    }

    if (dailyPenaltyPercentageInput) dailyPenaltyPercentageInput.style.display = isPercentage ? 'block' : 'none';
    if (dailyPenaltyFixedInput) dailyPenaltyFixedInput.style.display = isPercentage ? 'none' : 'block';
    if (maxPenaltyPercentageInput) maxPenaltyPercentageInput.style.display = isPercentage ? 'block' : 'none';
    if (maxPenaltyFixedInput) maxPenaltyFixedInput.style.display = isPercentage ? 'none' : 'block';
  }

  if (penaltyTypePercentage) penaltyTypePercentage.addEventListener('change', togglePenaltyInputs);
  if (penaltyTypeFixed) penaltyTypeFixed.addEventListener('change', togglePenaltyInputs);
}

// Store interest rates globally
window.interestRates = {};

// Initialize dynamic interest rate inputs
function initDynamicInterestRates() {
  const maxMonths = parseInt(document.getElementById('maxRepaymentMonths').value) || 3;
  const container = document.getElementById('interestRatesContainer');

  // Default rates (higher for earlier months)
  const defaultRates = [10, 7, 5, 4, 3, 2];

  // Build HTML for interest rate inputs
  let html = '<div class="interest-rates-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--bn-space-3);">';

  for (let i = 1; i <= maxMonths; i++) {
    const defaultRate = defaultRates[i - 1] || defaultRates[defaultRates.length - 1];
    const existingRate = window.interestRates[`month${i}`] || defaultRate;

    html += `
      <div class="form-group" style="margin-bottom: 0;">
        <label class="form-label" style="font-size: var(--bn-text-xs);">Month ${i} Rate (%)</label>
        <input type="number"
               id="interestRateMonth${i}"
               class="form-input interest-rate-input"
               value="${existingRate}"
               min="0"
               max="100"
               step="0.5"
               data-month="${i}"
               onchange="updateInterestRate(${i}, this.value)">
      </div>
    `;
  }

  html += '</div>';

  // Add explanation
  html += `
    <div style="margin-top: var(--bn-space-3); padding: var(--bn-space-3); background: var(--bn-gray-100); border-radius: var(--bn-radius-lg);">
      <p style="font-size: var(--bn-text-xs); color: var(--bn-gray); margin: 0;">
        <strong>Example:</strong> For a MWK 100,000 loan over ${maxMonths} months with reduced balance:
        <br>• Month 1: MWK 100,000 × ${window.interestRates.month1 || defaultRates[0]}% = MWK ${((100000 * (window.interestRates.month1 || defaultRates[0])) / 100).toLocaleString()} interest
        ${maxMonths >= 2 ? `<br>• Month 2: Remaining balance × ${window.interestRates.month2 || defaultRates[1]}%` : ''}
      </p>
    </div>
  `;

  container.innerHTML = html;

  // Initialize rates
  for (let i = 1; i <= maxMonths; i++) {
    if (!window.interestRates[`month${i}`]) {
      window.interestRates[`month${i}`] = defaultRates[i - 1] || defaultRates[defaultRates.length - 1];
    }
  }
}

// Update interest rate in global object
window.updateInterestRate = function(month, value) {
  window.interestRates[`month${month}`] = parseFloat(value) || 0;
};

// Currency input formatting
function initCurrencyInputs() {
  document.querySelectorAll('[data-type="currency"]').forEach(input => {
    input.addEventListener('input', (e) => {
      let value = e.target.value.replace(/[^\d]/g, '');
      if (value) {
        value = parseInt(value).toLocaleString('en-US');
      }
      e.target.value = value;
    });

    input.addEventListener('blur', (e) => {
      let value = e.target.value.replace(/[^\d]/g, '');
      if (value) {
        value = parseInt(value).toLocaleString('en-US');
      }
      e.target.value = value;
    });
  });
}

// Get numeric value from formatted currency
function getCurrencyValue(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  return parseInt(el.value.replace(/[^\d]/g, '')) || 0;
}

// Format currency for display
function formatCurrency(amount) {
  return 'MWK ' + parseInt(amount || 0).toLocaleString('en-US');
}

// File upload
function initFileUpload() {
  const uploadArea = document.getElementById('rulesUploadArea');
  const fileInput = document.getElementById('rulesDocument');
  const preview = document.getElementById('rulesFilePreview');
  const removeBtn = document.getElementById('removeRulesFile');

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      handleFileSelect(file);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  });

  removeBtn.addEventListener('click', () => {
    rulesFile = null;
    preview.style.display = 'none';
    uploadArea.style.display = 'block';
    fileInput.value = '';
  });
}

function handleFileSelect(file) {
  if (file.size > 10 * 1024 * 1024) {
    alert('File size must be less than 10MB');
    return;
  }

  rulesFile = file;
  document.getElementById('rulesFileName').textContent = file.name;
  document.getElementById('rulesFileSize').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
  document.getElementById('rulesFilePreview').style.display = 'block';
  document.getElementById('rulesUploadArea').style.display = 'none';
}


// Navigation
function updateStepIndicator() {
  steps.forEach((step, index) => {
    const stepNum = index + 1;
    step.classList.remove('active', 'completed');

    if (stepNum < currentStep) {
      step.classList.add('completed');
    } else if (stepNum === currentStep) {
      step.classList.add('active');
    }
  });

  stepConnectors.forEach((connector, index) => {
    connector.classList.toggle('completed', index < currentStep - 1);
  });

  formSteps.forEach(formStep => {
    formStep.classList.toggle('active', parseInt(formStep.dataset.step) === currentStep);
  });

  prevBtn.style.display = currentStep > 1 ? 'block' : 'none';
  nextBtn.style.display = currentStep < totalSteps ? 'block' : 'none';
  submitBtn.style.display = currentStep === totalSteps ? 'block' : 'none';
}

function validateStep(step) {
  switch(step) {
    case 1:
      const name = document.getElementById('fullName').value.trim();
      const email = document.getElementById('email').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (!name || !email || !phone || !password) {
        alert('Please fill in all required fields');
        return false;
      }
      if (password.length < 8) {
        alert('Password must be at least 8 characters');
        return false;
      }
      if (password !== confirmPassword) {
        alert('Passwords do not match');
        return false;
      }
      return true;

    case 2:
      const groupName = document.getElementById('groupName').value.trim();
      const cycleStart = document.getElementById('cycleStartDate').value;

      if (!groupName) {
        alert('Please enter a group name');
        return false;
      }
      if (!cycleStart) {
        alert('Please select a cycle start date');
        return false;
      }
      return true;

    case 3:
      const monthly = getCurrencyValue('monthlyContribution');
      const seed = getCurrencyValue('seedMoney');

      // Monthly contribution is optional (can be 0 for seed-money-only groups)
      return true;

    default:
      return true;
  }
}

function updateSummary() {
  // Admin info
  document.getElementById('summaryAdminName').textContent = document.getElementById('fullName').value;
  document.getElementById('summaryAdminEmail').textContent = document.getElementById('email').value;

  // Group details
  document.getElementById('summaryGroupName').textContent = document.getElementById('groupName').value;
  document.getElementById('summaryCycleLength').textContent = document.getElementById('cycleLength').value + ' months';
  document.getElementById('summaryCycleStart').textContent = new Date(document.getElementById('cycleStartDate').value).toLocaleDateString();
  document.getElementById('summaryDueDay').textContent = document.getElementById('contributionDueDay').value + ' of each month';

  // Financial
  document.getElementById('summaryMonthly').textContent = formatCurrency(getCurrencyValue('monthlyContribution'));
  document.getElementById('summarySeedMoney').textContent = formatCurrency(getCurrencyValue('seedMoney'));
  const maxLoan = getCurrencyValue('maxLoanAmount');
  document.getElementById('summaryMaxLoan').textContent = maxLoan ? formatCurrency(maxLoan) : 'No limit';
  document.getElementById('summaryInterestMethod').textContent =
    document.getElementById('interestMethod').value === 'reduced_balance' ? 'Reduced Balance' : 'Flat Rate';

  // Dynamic interest rates summary
  const maxMonths = parseInt(document.getElementById('maxRepaymentMonths').value) || 3;
  const rates = [];
  for (let i = 1; i <= maxMonths; i++) {
    const rate = window.interestRates[`month${i}`] || 0;
    rates.push(`M${i}: ${rate}%`);
  }
  document.getElementById('summaryInterestRates').textContent = rates.join(' / ');
  document.getElementById('summaryPenalty').textContent = document.getElementById('dailyPenaltyRate').value + '% per day';

}

prevBtn.addEventListener('click', () => {
  if (currentStep > 1) {
    currentStep--;
    updateStepIndicator();
  }
});

nextBtn.addEventListener('click', () => {
  if (validateStep(currentStep)) {
    if (currentStep < totalSteps) {
      currentStep++;
      updateStepIndicator();

      if (currentStep === totalSteps) {
        updateSummary();
      }
    }
  }
});

// Initialize
updateStepIndicator();
