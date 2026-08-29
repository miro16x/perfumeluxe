/* ── ACCOUNT: SIGN UP, SIGN IN, PREFERENCES, RECOMMENDATIONS ──
   This is a static site with no backend, so accounts and taste
   preferences live in localStorage on this device — a personalized
   preview, not a live authenticated store login. Passwords are
   obfuscated for casual readability only, never treat this as real
   password security. */

const UL_USERS_KEY   = 'ul-users';
const UL_SESSION_KEY = 'ul-session';

function ulGetUsers() {
  try { return JSON.parse(localStorage.getItem(UL_USERS_KEY)) || []; } catch (e) { return []; }
}
function ulSaveUsers(users) {
  try { localStorage.setItem(UL_USERS_KEY, JSON.stringify(users)); } catch (e) {}
}
function ulGetSession() {
  try { return localStorage.getItem(UL_SESSION_KEY) || null; } catch (e) { return null; }
}
function ulSetSession(email) {
  try {
    if (email) localStorage.setItem(UL_SESSION_KEY, email);
    else localStorage.removeItem(UL_SESSION_KEY);
  } catch (e) {}
}
function ulFindUser(email) {
  if (!email) return null;
  return ulGetUsers().find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
}
function ulCurrentUser() {
  return ulFindUser(ulGetSession());
}
function ulObfuscate(str) {
  try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { return str; }
}
function ulTitleCase(str) {
  return str.split(' ').map((w) => (w === '&' ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
}

/* ── RECOMMENDED FOR YOU ──────────────────────────────── */
function renderRecommendations() {
  const section = document.getElementById('recommendedSection');
  const grid = document.getElementById('recommendedGrid');
  if (!section || !grid || typeof PRODUCTS === 'undefined' || typeof renderProductCard === 'undefined') return;

  const user = ulCurrentUser();
  const prefs = user && user.preferences;
  if (!prefs || (!prefs.scents.length && !prefs.brands.length && !prefs.genders.length)) {
    section.hidden = true;
    return;
  }

  const scored = PRODUCTS
    .filter((p) => prefs.bodyCare || p.category !== 'body-care')
    .map((p) => {
      let score = 0;
      if (prefs.brands.includes(p.brand)) score += 3;
      score += p.scents.filter((s) => prefs.scents.includes(s)).length * 2;
      if (prefs.genders.includes(p.gender)) score += 1;
      /* explicit opt-in nudges body care up among same-score ties, so it isn't
         crowded out entirely by same-brand fragrances/mists in the top slice */
      if (prefs.bodyCare && p.category === 'body-care') score += 0.5;
      return { p, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.p);

  if (!scored.length) {
    section.hidden = true;
    return;
  }

  const picks = scored.slice(0, 8);
  const nameEl = document.getElementById('recommendedName');
  if (nameEl) nameEl.textContent = user.name.split(' ')[0];

  grid.innerHTML = picks.map((p) => renderProductCard(p)).join('');
  grid.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
  grid.querySelectorAll('.product-wish').forEach((btn) => {
    btn.addEventListener('click', () => {
      const active = btn.classList.toggle('wished');
      const path = btn.querySelector('svg path');
      if (path) path.setAttribute('fill', active ? 'var(--gold)' : 'none');
      btn.style.color = active ? 'var(--gold)' : '';
      btn.style.borderColor = active ? 'var(--gold)' : '';
      btn.setAttribute('aria-pressed', active);
    });
  });

  section.hidden = false;
}

/* ── ACCOUNT MODAL ─────────────────────────────────────── */
(function initAccount() {
  const overlay  = document.getElementById('accountOverlay');
  const modal    = document.getElementById('accountModal');
  const closeBtn = document.getElementById('accountClose');
  const btns     = [document.getElementById('accountBtn'), document.getElementById('accountBtnMobile')].filter(Boolean);
  const dot      = document.getElementById('accountDot');
  if (!modal || typeof PRODUCTS === 'undefined') return;

  const authView     = document.getElementById('accountAuthView');
  const prefsView     = document.getElementById('accountPrefsView');
  const loggedInView = document.getElementById('accountLoggedInView');

  const tabSignIn  = document.getElementById('tabSignIn');
  const tabSignUp  = document.getElementById('tabSignUp');
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');
  const signInError = document.getElementById('signInError');
  const signUpError = document.getElementById('signUpError');

  const prefsWelcomeName = document.getElementById('prefsWelcomeName');
  const prefsScents   = document.getElementById('prefsScents');
  const prefsBrands   = document.getElementById('prefsBrands');
  const prefsGender   = document.getElementById('prefsGender');
  const prefsBodyCare = document.getElementById('prefsBodyCare');
  const prefsSave     = document.getElementById('prefsSave');

  const accountNameEl  = document.getElementById('accountName');
  const accountEmailEl = document.getElementById('accountEmail');
  const editPrefsBtn   = document.getElementById('accountEditPrefs');
  const signOutBtn     = document.getElementById('accountSignOut');

  const SCENT_LABELS = { floral: 'Floral', woody: 'Woody', oriental: 'Oriental', fresh: 'Fresh', gourmand: 'Gourmand', fruity: 'Fruity', aquatic: 'Aquatic', chypre: 'Chypre' };
  const BRANDS = [...new Set(PRODUCTS.map((p) => p.brand))].sort();

  function updateDot() {
    if (dot) dot.hidden = !ulGetSession();
  }

  function openModal() {
    modal.classList.add('open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    renderCurrentView();
  }
  function closeModal() {
    modal.classList.remove('open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function renderCurrentView() {
    const user = ulCurrentUser();
    if (!user) { showAuthView(); return; }
    if (!user.preferences) showPrefsView(user);
    else showLoggedInView(user);
  }

  function showAuthView() {
    authView.hidden = false;
    prefsView.hidden = true;
    loggedInView.hidden = true;
    switchTab('signin');
  }
  function showPrefsView(user) {
    authView.hidden = true;
    prefsView.hidden = false;
    loggedInView.hidden = true;
    prefsWelcomeName.textContent = (user.name || '').split(' ')[0] || 'there';
    buildPrefsChips(user.preferences || {});
  }
  function showLoggedInView(user) {
    authView.hidden = true;
    prefsView.hidden = true;
    loggedInView.hidden = false;
    accountNameEl.textContent = user.name;
    accountEmailEl.textContent = user.email;
  }

  function switchTab(tab) {
    const isSignIn = tab === 'signin';
    tabSignIn.classList.toggle('account-tab-active', isSignIn);
    tabSignUp.classList.toggle('account-tab-active', !isSignIn);
    tabSignIn.setAttribute('aria-selected', String(isSignIn));
    tabSignUp.setAttribute('aria-selected', String(!isSignIn));
    signInForm.hidden = !isSignIn;
    signUpForm.hidden = isSignIn;
    signInError.hidden = true;
    signUpError.hidden = true;
  }
  tabSignIn.addEventListener('click', () => switchTab('signin'));
  tabSignUp.addEventListener('click', () => switchTab('signup'));

  signInForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email    = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value;
    const user = ulFindUser(email);
    if (!user || user.password !== ulObfuscate(password)) {
      signInError.textContent = 'Incorrect email or password.';
      signInError.hidden = false;
      return;
    }
    signInError.hidden = true;
    ulSetSession(user.email);
    updateDot();
    signInForm.reset();
    renderCurrentView();
    renderRecommendations();
  });

  signUpForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name     = document.getElementById('signUpName').value.trim();
    const email    = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value;

    if (!name || !email) {
      signUpError.textContent = 'Please fill in every field.';
      signUpError.hidden = false;
      return;
    }
    if (ulFindUser(email)) {
      signUpError.textContent = 'An account with this email already exists.';
      signUpError.hidden = false;
      return;
    }
    if (password.length < 6) {
      signUpError.textContent = 'Password must be at least 6 characters.';
      signUpError.hidden = false;
      return;
    }
    signUpError.hidden = true;

    const users = ulGetUsers();
    users.push({ name, email, password: ulObfuscate(password), preferences: null });
    ulSaveUsers(users);
    ulSetSession(email);
    updateDot();
    signUpForm.reset();
    renderCurrentView();
  });

  function buildPrefsChips(existing) {
    const scentSet = new Set(existing.scents || []);
    prefsScents.innerHTML = Object.keys(SCENT_LABELS).map((s) =>
      `<button type="button" class="search-chip${scentSet.has(s) ? ' chip-selected' : ''}" data-scent="${s}">${SCENT_LABELS[s]}</button>`
    ).join('');

    const brandSet = new Set(existing.brands || []);
    prefsBrands.innerHTML = BRANDS.map((b) =>
      `<button type="button" class="search-chip${brandSet.has(b) ? ' chip-selected' : ''}" data-brand="${b.replace(/"/g, '&quot;')}">${ulTitleCase(b)}</button>`
    ).join('');

    const genderSet = new Set(existing.genders || []);
    prefsGender.querySelectorAll('.search-chip').forEach((chip) => {
      chip.classList.toggle('chip-selected', genderSet.has(chip.dataset.gender));
    });

    prefsBodyCare.checked = !!existing.bodyCare;
  }

  [prefsScents, prefsBrands, prefsGender].forEach((el) => {
    el.addEventListener('click', (e) => {
      const chip = e.target.closest('.search-chip');
      if (chip) chip.classList.toggle('chip-selected');
    });
  });

  prefsSave.addEventListener('click', () => {
    const user = ulCurrentUser();
    if (!user) return;

    const scents   = [...prefsScents.querySelectorAll('.chip-selected')].map((c) => c.dataset.scent);
    const brands   = [...prefsBrands.querySelectorAll('.chip-selected')].map((c) => c.dataset.brand);
    const genders  = [...prefsGender.querySelectorAll('.chip-selected')].map((c) => c.dataset.gender);
    const bodyCare = prefsBodyCare.checked;

    const users = ulGetUsers();
    const idx = users.findIndex((u) => u.email.toLowerCase() === user.email.toLowerCase());
    if (idx !== -1) {
      users[idx].preferences = { scents, brands, genders, bodyCare };
      ulSaveUsers(users);
    }

    closeModal();
    renderRecommendations();
  });

  editPrefsBtn.addEventListener('click', () => {
    const user = ulCurrentUser();
    if (user) showPrefsView(user);
  });

  signOutBtn.addEventListener('click', () => {
    ulSetSession(null);
    updateDot();
    closeModal();
    renderRecommendations();
  });

  btns.forEach((btn) => btn.addEventListener('click', openModal));
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

  updateDot();
  renderRecommendations();
})();
