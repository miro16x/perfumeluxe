/* ── ACCOUNT: SIGN UP, SIGN IN, PREFERENCES, LIKES, ORDER HISTORY ──
   Accounts are real Supabase accounts: passwords are stored and checked by
   Supabase (never by this site), and each customer's preferences, likes and
   order history live in the database, protected by row-level security so a
   customer can only read their own rows.

   The URL and publishable key below are safe to ship in the browser. The
   secret/service-role key must never appear here — it lives only in the
   Cloudflare Worker (see lib/supabase.js). */

const UL_SUPABASE_URL = 'https://bvffpffnyjfufprcdskb.supabase.co';
const UL_SUPABASE_KEY = 'sb_publishable_NGGc4fVDwCVlsInS2NT51g_ymNOYi7w';
const UL_SUPABASE_SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

const UL_ACCOUNT_CACHE_KEY = 'ul-account';       /* last known { id, name, email, preferences } */
const UL_LEGACY_PREFS_KEY  = 'ul-legacy-prefs';  /* preferences rescued from the old device-only accounts */
const UL_QUIZ_PROFILE_KEY  = 'ul-quiz-profile';  /* latest quiz answers, waiting to be saved to a profile */

function ulReadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}
function ulWriteJSON(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

/* The site used to keep whole accounts (with reversible passwords) in
   localStorage. Remove them, keeping only each email's taste preferences so
   they can be restored when that person creates a real account. */
(function ulRetireLegacyAccounts() {
  const legacyUsers = ulReadJSON('ul-users', null);
  if (Array.isArray(legacyUsers)) {
    const rescued = ulReadJSON(UL_LEGACY_PREFS_KEY, {});
    legacyUsers.forEach((user) => {
      if (user && user.email && user.preferences) rescued[String(user.email).toLowerCase()] = user.preferences;
    });
    if (Object.keys(rescued).length) ulWriteJSON(UL_LEGACY_PREFS_KEY, rescued);
  }
  try {
    localStorage.removeItem('ul-users');
    localStorage.removeItem('ul-session');
  } catch (e) {}
})();

/* Cached so recommendations and the pickup form can render immediately; it is
   re-validated against Supabase as soon as the SDK loads. */
let ulUser = ulReadJSON(UL_ACCOUNT_CACHE_KEY, null);
let ulClient = null;

function ulCurrentUser() {
  return ulUser;
}
function ulSetUser(user) {
  ulUser = user;
  ulWriteJSON(UL_ACCOUNT_CACHE_KEY, user);
}
function ulTitleCase(str) {
  return str.split(' ').map((w) => (w === '&' ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
}

/* Resolves to the Supabase client, or null if the SDK could not load
   (offline, blocked CDN). Everything account-related awaits this. */
const ulReady = new Promise((resolve) => {
  const script = document.createElement('script');
  script.src = UL_SUPABASE_SDK;
  script.async = true;
  script.onload = () => {
    try {
      ulClient = window.supabase.createClient(UL_SUPABASE_URL, UL_SUPABASE_KEY);
      resolve(ulClient);
    } catch (error) {
      console.warn('Unable to start account service:', error);
      resolve(null);
    }
  };
  script.onerror = () => {
    console.warn('Unable to load account service.');
    resolve(null);
  };
  document.head.appendChild(script);
});

/* Used by the pickup form so the Worker can attach the order to this account. */
window.ulGetAccessToken = async () => {
  const client = await ulReady;
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token || null;
};

/* Called by app.js whenever a heart is toggled. */
window.ulOnWishlistToggle = (productId, added) => {
  if (!ulClient || !ulUser) return;
  const request = added
    ? ulClient.from('wishlist_items').upsert(
        { user_id: ulUser.id, product_id: productId },
        { onConflict: 'user_id,product_id', ignoreDuplicates: true }
      )
    : ulClient.from('wishlist_items').delete().eq('user_id', ulUser.id).eq('product_id', productId);
  request.then(({ error }) => {
    if (error) console.warn('Unable to sync liked fragrance:', error.message);
  });
};

/* ── PERSONALIZE INVITE (home page) ───────────────────────
   Signed out → invite to create an account. Signed in without a scent
   profile → nudge to finish it. Profile saved → hidden, because the
   "Recommended for You" section takes its place. */
function renderPersonalizeInvite() {
  const section = document.getElementById('personalizeSection');
  if (!section) return;
  const user = ulCurrentUser();
  if (user && user.preferences) { section.hidden = true; return; }

  const signedIn = Boolean(user);
  document.getElementById('personalizeEyebrow').textContent = signedIn ? 'Almost There' : 'Your Scent Profile';
  document.getElementById('personalizeTitle').innerHTML = signedIn
    ? 'Finish Your <em>Scent Profile</em>'
    : 'A Collection Curated <em>Just for You</em>';
  document.getElementById('personalizeSub').textContent = signedIn
    ? 'Tell us the fragrance families, houses and styles you love, and we’ll handpick perfumes matched to your taste.'
    : 'Create a free account, tell us the fragrance families and houses you love, and we’ll handpick perfumes matched to your taste every time you visit.';
  document.getElementById('personalizeCta').textContent = signedIn ? 'Choose My Preferences' : 'Create Free Account';
  document.getElementById('personalizeSignIn').hidden = signedIn;
  section.hidden = false;
}

/* ── RECOMMENDED FOR YOU ──────────────────────────────── */
const UL_REC_RECENT_KEY = 'ul-rec-recent';   /* ids shown on the previous visit */
const UL_REC_COUNT = 12;
let ulRecSelection = null;                   /* { key, ids }: one shuffle per page load */

/* A fresh, preference-weighted selection on every visit: random jitter
   reorders similar matches while stronger matches still tend to win, the
   previous visit's picks sit out when enough others match, and no brand
   crowds the carousel (favourite brands get more room). */
function ulPickRecommendations(scored, prefs, key) {
  if (ulRecSelection && ulRecSelection.key === key) return ulRecSelection.ids;

  const top = scored[0].score;
  const strong = scored.filter((m) => m.score >= top * 0.5);
  let pool = strong.length >= UL_REC_COUNT * 2 ? strong : scored.slice(0, UL_REC_COUNT * 4);
  const lastVisit = new Set(ulReadJSON(UL_REC_RECENT_KEY, []));
  const fresh = pool.filter((m) => !lastVisit.has(m.p.id));
  if (fresh.length >= UL_REC_COUNT) pool = fresh;

  const ranked = pool
    .map((m) => ({ ...m, rank: m.score + Math.random() * top * 0.4 }))
    .sort((a, b) => b.rank - a.rank);

  const picks = [];
  const perBrand = {};
  for (const m of ranked) {
    const cap = prefs.brands.includes(m.p.brand) ? 4 : 2;
    if ((perBrand[m.p.brand] || 0) >= cap) continue;
    perBrand[m.p.brand] = (perBrand[m.p.brand] || 0) + 1;
    picks.push(m);
    if (picks.length === UL_REC_COUNT) break;
  }
  for (const m of ranked) {
    if (picks.length === UL_REC_COUNT) break;
    if (!picks.includes(m)) picks.push(m);
  }

  const ids = picks.map((m) => m.p.id);
  ulWriteJSON(UL_REC_RECENT_KEY, ids);
  ulRecSelection = { key, ids };
  return ids;
}

function renderRecommendations() {
  renderPersonalizeInvite();
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
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    section.hidden = true;
    return;
  }

  const nameEl = document.getElementById('recommendedName');
  if (nameEl) nameEl.textContent = (user.name || '').split(' ')[0];

  const ids = ulPickRecommendations(scored, prefs, `${user.id}:${JSON.stringify(prefs)}`);
  section.hidden = false;
  /* This runs again on every account refresh; only rebuild (and reset the
     carousel) when the selection actually changed. */
  if (grid.dataset.ids === ids.join(',')) return;
  grid.dataset.ids = ids.join(',');

  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  grid.innerHTML = ids.map((id) => renderProductCard(byId.get(id))).join('');
  grid.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
  /* Shared coverflow (app.js) re-reads the cards; the section must be visible
     first so card widths can be measured. */
  grid.dispatchEvent(new CustomEvent('coverflow:refresh'));
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
  const prefsView    = document.getElementById('accountPrefsView');
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
  const UNAVAILABLE = 'Accounts are unavailable right now. Check your connection and try again.';
  const ORDER_STATUS = { placed: 'Placed', paid: 'Paid', cancelled: 'Cancelled', refunded: 'Refunded' };

  /* ── extra UI the static markup doesn't have (same on every page) ── */
  tabSignIn.closest('.account-tabs').insertAdjacentHTML('afterend',
    '<p class="account-notice" id="accountNotice" role="status" hidden></p>' +
    '<button type="button" class="account-link account-resend" id="resendConfirmBtn" hidden>Resend confirmation email</button>' +
    '<p class="account-intro" id="accountIntro" hidden>Create a free account and we’ll recommend fragrances matched to your taste. Your likes and order history come with you to any device.</p>');
  signInForm.querySelector('button[type="submit"]').insertAdjacentHTML('beforebegin',
    '<button type="button" class="account-link" id="forgotPasswordBtn">Forgot password?</button>');
  prefsSave.insertAdjacentHTML('beforebegin', '<p class="account-error" id="prefsError" hidden></p>');
  loggedInView.querySelector('.account-actions').insertAdjacentHTML('beforebegin', `
    <div class="account-orders">
      <span class="search-section-label">Order History</span>
      <div class="account-orders-list" id="accountOrders"></div>
    </div>`);
  loggedInView.insertAdjacentHTML('afterend', `
    <div class="account-view" id="accountRecoveryView" hidden>
      <p class="section-eyebrow">Reset password</p>
      <h3 class="account-view-title">Choose a New Password</h3>
      <form class="account-form" id="recoveryForm" novalidate>
        <p class="account-error" id="recoveryError" hidden></p>
        <label class="account-field">
          <span>New password</span>
          <input type="password" id="recoveryPassword" required autocomplete="new-password" minlength="6">
        </label>
        <button type="submit" class="btn-gold btn-full">Save Password</button>
      </form>
    </div>`);
  const accountNote = authView.querySelector('.account-note');
  if (accountNote) accountNote.textContent = 'Your preferences, likes and order history are saved to your account and follow you to any device.';

  const notice        = document.getElementById('accountNotice');
  const resendBtn     = document.getElementById('resendConfirmBtn');
  const intro         = document.getElementById('accountIntro');
  const RESEND_LABEL  = resendBtn.textContent;
  const confirmRedirect = () => new URL('index.html', window.location.href).href;
  const prefsSub      = prefsView.querySelector('.account-view-sub');
  const prefsSubText  = prefsSub ? prefsSub.textContent : '';
  const quizSaveBox   = document.getElementById('aiSaveProfile');   /* home page only */

  /* ── quiz answers → scent profile ─────────────────────── */
  const union = (a = [], b = []) => [...new Set([...a, ...b])];
  const pendingQuizProfile = () => ulReadJSON(UL_QUIZ_PROFILE_KEY, null);
  function withQuizAnswers(prefs, quiz) {
    const base = prefs || {};
    return {
      scents: union(base.scents, quiz.scents),
      brands: [...(base.brands || [])],
      genders: union(base.genders, quiz.genders),
      bodyCare: !!base.bodyCare || !!quiz.bodyCare
    };
  }
  function quizAddsToProfile(prefs, quiz) {
    if (!prefs) return true;
    const merged = withQuizAnswers(prefs, quiz);
    return merged.scents.length !== (prefs.scents || []).length
      || merged.genders.length !== (prefs.genders || []).length
      || merged.bodyCare !== !!prefs.bodyCare;
  }

  function renderQuizSavePrompt() {
    if (!quizSaveBox) return;
    const quiz = pendingQuizProfile();
    const user = ulCurrentUser();
    if (!quiz || (user && !quizAddsToProfile(user.preferences, quiz))) { quizSaveBox.hidden = true; return; }
    document.getElementById('aiSaveTitle').textContent = user ? 'Save These Answers to Your Profile' : 'Save Your Scent Profile';
    document.getElementById('aiSaveText').textContent = user
      ? 'Add them to your scent profile and your recommendations will reflect them on every visit.'
      : 'Create a free account and we’ll keep these answers, so personalized recommendations are waiting every time you visit.';
    document.getElementById('aiSaveBtn').textContent = user ? 'Save to My Profile' : 'Create Free Account';
    quizSaveBox.hidden = false;
  }

  /* Called by the quiz (app.js) when results are shown. Stored in
     localStorage so the answers survive an email-confirmation round trip. */
  window.ulOfferQuizProfile = (profile) => {
    ulWriteJSON(UL_QUIZ_PROFILE_KEY, profile);
    renderQuizSavePrompt();
  };
  const forgotBtn     = document.getElementById('forgotPasswordBtn');
  const prefsError    = document.getElementById('prefsError');
  const ordersEl      = document.getElementById('accountOrders');
  const recoveryView  = document.getElementById('accountRecoveryView');
  const recoveryForm  = document.getElementById('recoveryForm');
  const recoveryError = document.getElementById('recoveryError');

  let recoveryMode = false;      /* arrived from a password-reset email link */
  let appliedUserId;             /* undefined until the first session check completes */
  let sessionQueue = Promise.resolve();

  function showMessage(el, text) {
    el.textContent = text;
    el.hidden = false;
  }
  function setBusy(button, label) {
    button.dataset.label = button.textContent;
    button.textContent = label;
    button.disabled = true;
  }
  function clearBusy(button) {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
  }
  const submitBtn = (form) => form.querySelector('button[type="submit"]');

  function updateDot() {
    if (dot) dot.hidden = !ulUser;
  }

  /* `tab` ('signin' | 'signup') only matters while signed out; click
     handlers pass an Event here, which is ignored. */
  function openModal(tab) {
    modal.classList.add('open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    renderCurrentView();
    if (tab === 'signup' && !authView.hidden) switchTab('signup');
    if (tab === 'prefs' && ulCurrentUser()) showPrefsView(ulCurrentUser());
  }
  function closeModal() {
    modal.classList.remove('open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function showOnly(view) {
    [authView, prefsView, loggedInView, recoveryView].forEach((el) => { el.hidden = el !== view; });
  }

  function renderCurrentView() {
    if (recoveryMode) { showOnly(recoveryView); return; }
    const user = ulCurrentUser();
    if (!user) { showAuthView(); return; }
    if (!user.preferences) showPrefsView(user);
    else showLoggedInView(user);
  }

  function showAuthView() {
    showOnly(authView);
    switchTab('signin');
  }
  function showPrefsView(user) {
    showOnly(prefsView);
    prefsError.hidden = true;
    prefsWelcomeName.textContent = (user.name || '').split(' ')[0] || 'there';
    const quiz = pendingQuizProfile();
    if (prefsSub) {
      prefsSub.textContent = quiz
        ? 'We’ve pre-selected your quiz answers. Adjust anything you like, then save.'
        : prefsSubText;
    }
    buildPrefsChips(quiz ? withQuizAnswers(user.preferences, quiz) : (user.preferences || {}));
  }
  function showLoggedInView(user) {
    showOnly(loggedInView);
    accountNameEl.textContent = user.name;
    accountEmailEl.textContent = user.email;
    renderOrders();
  }

  function switchTab(tab) {
    const isSignIn = tab === 'signin';
    tabSignIn.classList.toggle('account-tab-active', isSignIn);
    tabSignUp.classList.toggle('account-tab-active', !isSignIn);
    tabSignIn.setAttribute('aria-selected', String(isSignIn));
    tabSignUp.setAttribute('aria-selected', String(!isSignIn));
    signInForm.hidden = !isSignIn;
    signUpForm.hidden = isSignIn;
    intro.hidden = isSignIn;
    signInError.hidden = true;
    signUpError.hidden = true;
  }
  tabSignIn.addEventListener('click', () => { clearNotice(); switchTab('signin'); });
  tabSignUp.addEventListener('click', () => { clearNotice(); switchTab('signup'); });

  /* ── resend confirmation email ────────────────────────── */
  let resendEmail = '';
  let resendTimer = null;

  function clearNotice() {
    notice.hidden = true;
    resendBtn.hidden = true;
  }
  function offerResend(email) {
    resendEmail = email;
    resendBtn.hidden = false;
  }
  /* Supabase allows one confirmation email per address about every 60s;
     count down instead of letting the customer hit that limit. */
  function startResendCooldown(seconds) {
    clearInterval(resendTimer);
    let left = seconds;
    resendBtn.disabled = true;
    const tick = () => {
      if (left <= 0) {
        clearInterval(resendTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = RESEND_LABEL;
        return;
      }
      resendBtn.textContent = `Resend available in ${left}s`;
      left -= 1;
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  }

  resendBtn.addEventListener('click', async () => {
    if (!resendEmail) return;
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending…';
    try {
      const client = await ulReady;
      if (!client) {
        showMessage(notice, UNAVAILABLE);
        resendBtn.disabled = false;
        resendBtn.textContent = RESEND_LABEL;
        return;
      }
      const { error } = await client.auth.resend({
        type: 'signup',
        email: resendEmail,
        options: { emailRedirectTo: confirmRedirect() }
      });
      if (error) {
        const wait = Number(/(\d+)\s*seconds?/i.exec(error.message)?.[1]);
        if (wait) {
          showMessage(notice, `Please wait ${wait} seconds before requesting another email.`);
          startResendCooldown(wait);
        } else {
          console.warn('Unable to resend confirmation:', error.message);
          showMessage(notice, 'We couldn’t resend the email right now. Please try again in a few minutes.');
          resendBtn.disabled = false;
          resendBtn.textContent = RESEND_LABEL;
        }
        return;
      }
      showMessage(notice, `A new confirmation link is on its way to ${resendEmail}. It can take a minute to arrive, so check your spam folder too.`);
      startResendCooldown(60);
    } catch (error) {
      console.warn('Resend confirmation failed:', error);
      showMessage(notice, UNAVAILABLE);
      resendBtn.disabled = false;
      resendBtn.textContent = RESEND_LABEL;
    }
  });

  /* ── session → profile, likes ─────────────────────────── */
  async function loadProfile(client, authUser) {
    const email = authUser.email || '';
    const metaName = String(authUser.user_metadata?.name || '').trim();
    let { data: profile, error } = await client.from('profiles')
      .select('name, preferences').eq('id', authUser.id).maybeSingle();
    if (error) console.warn('Unable to load account profile:', error.message);

    /* Normally created by a database trigger at sign-up; create it if missing. */
    if (!profile && !error) {
      profile = { name: metaName, preferences: null };
      const { error: createError } = await client.from('profiles').upsert({ id: authUser.id, name: metaName });
      if (createError) console.warn('Unable to create account profile:', createError.message);
    }

    let preferences = profile?.preferences || null;
    if (!preferences && !error) {
      /* Carry over taste preferences saved under the old device-only account. */
      const legacy = ulReadJSON(UL_LEGACY_PREFS_KEY, {});
      const rescued = legacy[email.toLowerCase()];
      if (rescued) {
        const { error: saveError } = await client.from('profiles')
          .update({ preferences: rescued, updated_at: new Date().toISOString() }).eq('id', authUser.id);
        if (!saveError) {
          preferences = rescued;
          delete legacy[email.toLowerCase()];
          ulWriteJSON(UL_LEGACY_PREFS_KEY, Object.keys(legacy).length ? legacy : null);
        }
      }
    }

    return {
      id: authUser.id,
      name: profile?.name || metaName || email.split('@')[0],
      email,
      preferences
    };
  }

  /* Likes made before signing in are added to the account; the device then
     shows the account's full list. */
  async function syncWishlist(client, userId) {
    if (!window.ulWishlist) return;
    const { data, error } = await client.from('wishlist_items').select('product_id');
    if (error) { console.warn('Unable to load liked fragrances:', error.message); return; }
    const remote = data.map((row) => row.product_id);
    const local = window.ulWishlist.ids();
    const missing = local.filter((id) => !remote.includes(id));
    if (missing.length) {
      const { error: pushError } = await client.from('wishlist_items').upsert(
        missing.map((product_id) => ({ user_id: userId, product_id })),
        { onConflict: 'user_id,product_id', ignoreDuplicates: true }
      );
      if (pushError) console.warn('Unable to save liked fragrances:', pushError.message);
    }
    window.ulWishlist.replace([...new Set([...remote, ...local])]);
  }

  /* Serialised so a sign-in and the auth event it triggers can't interleave. */
  function applySession(session, force = false) {
    sessionQueue = sessionQueue.then(async () => {
      const authUser = session?.user || null;
      const userId = authUser?.id || null;
      if (userId === appliedUserId && !force) return;
      appliedUserId = userId;

      if (authUser && ulClient) {
        ulSetUser(await loadProfile(ulClient, authUser));
        await syncWishlist(ulClient, authUser.id);
      } else {
        ulSetUser(null);
      }
      updateDot();
      renderRecommendations();
      renderQuizSavePrompt();
      if (modal.classList.contains('open')) renderCurrentView();
    }).catch((error) => console.warn('Unable to update account state:', error));
    return sessionQueue;
  }

  /* ── order history ────────────────────────────────────── */
  async function renderOrders() {
    ordersEl.replaceChildren();
    const client = await ulReady;
    if (!client || !ulUser) return;
    const { data, error } = await client.from('orders')
      /* '*' keeps history loading even before the shipping columns exist. */
      .select('*')
      .order('placed_at', { ascending: false })
      .limit(20);

    const message = (text) => {
      const p = document.createElement('p');
      p.className = 'account-orders-empty';
      p.textContent = text;
      ordersEl.replaceChildren(p);
    };
    if (error) { message('Unable to load your orders right now.'); return; }
    if (!data.length) { message('No orders yet. Orders you place while signed in will appear here.'); return; }

    /* Built with textContent: pickup details originate from customer input. */
    ordersEl.replaceChildren(...data.map((order) => {
      const row = document.createElement('article');
      row.className = 'account-order';
      const head = document.createElement('div');
      head.className = 'account-order-head';
      const ref = document.createElement('strong');
      ref.textContent = order.reference;
      const status = document.createElement('span');
      status.className = `account-order-status account-order-${order.status}`;
      status.textContent = ORDER_STATUS[order.status] || order.status;
      head.append(ref, status);
      const meta = document.createElement('span');
      meta.className = 'account-order-meta';
      const shipTo = order.fulfillment === 'shipping' ? order.shipping_address : null;
      meta.textContent = shipTo
        ? `Shipping to ${shipTo.city}, ${shipTo.state}`
        : `${order.pickup_store} · ${order.pickup_date}, ${order.pickup_time}`;
      const total = document.createElement('span');
      total.className = 'account-order-meta';
      total.textContent = `${order.item_count} ${order.item_count === 1 ? 'item' : 'items'} · $${Number(order.total).toFixed(2)}`;
      row.append(head, meta, total);
      return row;
    }));
  }

  /* ── sign in / sign up / reset ────────────────────────── */
  signInForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value;
    signInError.hidden = true;
    clearNotice();
    if (!email || !password) { showMessage(signInError, 'Enter your email and password.'); return; }

    const button = submitBtn(signInForm);
    setBusy(button, 'Signing In…');
    try {
      const client = await ulReady;
      if (!client) { showMessage(signInError, UNAVAILABLE); return; }
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        if (/not confirmed/i.test(error.message)) {
          showMessage(notice, 'Please confirm your email first. Check your inbox (and spam folder) for the confirmation link, or resend it below.');
          offerResend(email);
          return;
        }
        showMessage(signInError, /invalid login/i.test(error.message)
          ? 'Incorrect email or password.'
          : 'Unable to sign in right now. Please try again.');
        return;
      }
      signInForm.reset();
      await applySession(data.session);
    } catch (error) {
      console.warn('Sign in failed:', error);
      showMessage(signInError, UNAVAILABLE);
    } finally {
      clearBusy(button);
    }
  });

  signUpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name     = document.getElementById('signUpName').value.trim();
    const email    = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value;
    signUpError.hidden = true;
    clearNotice();

    if (!name || !email) { showMessage(signUpError, 'Please fill in every field.'); return; }
    if (password.length < 6) { showMessage(signUpError, 'Password must be at least 6 characters.'); return; }

    const button = submitBtn(signUpForm);
    setBusy(button, 'Creating Account…');
    try {
      const client = await ulReady;
      if (!client) { showMessage(signUpError, UNAVAILABLE); return; }
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { name }, emailRedirectTo: confirmRedirect() }
      });
      if (error) {
        showMessage(signUpError, /already registered/i.test(error.message)
          ? 'An account with this email already exists.'
          : /password/i.test(error.message)
            ? error.message
            : 'Unable to create your account right now. Please try again.');
        return;
      }
      /* With email confirmation on, Supabase hides whether an email is taken:
         it returns a user with no identities instead of an error. */
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        showMessage(signUpError, 'An account with this email already exists.');
        return;
      }
      signUpForm.reset();
      if (data.session) {
        await applySession(data.session);
      } else {
        switchTab('signin');
        document.getElementById('signInEmail').value = email;
        showMessage(notice, `Almost there. We sent a confirmation link to ${email}. Open it, then sign in. Didn’t get it? Check your spam folder.`);
        offerResend(email);
        startResendCooldown(60);
      }
    } catch (error) {
      console.warn('Sign up failed:', error);
      showMessage(signUpError, UNAVAILABLE);
    } finally {
      clearBusy(button);
    }
  });

  forgotBtn.addEventListener('click', async () => {
    const emailInput = document.getElementById('signInEmail');
    const email = emailInput.value.trim();
    signInError.hidden = true;
    clearNotice();
    if (!email || !emailInput.checkValidity()) {
      showMessage(signInError, 'Enter your email address above, then choose “Forgot password?”.');
      emailInput.focus();
      return;
    }
    setBusy(forgotBtn, 'Sending…');
    try {
      const client = await ulReady;
      if (!client) { showMessage(signInError, UNAVAILABLE); return; }
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: new URL('index.html', window.location.href).href
      });
      if (error) { showMessage(signInError, 'Unable to send a reset link right now. Please try again in a few minutes.'); return; }
      showMessage(notice, `If an account exists for ${email}, a password reset link is on its way.`);
    } catch (error) {
      console.warn('Password reset request failed:', error);
      showMessage(signInError, UNAVAILABLE);
    } finally {
      clearBusy(forgotBtn);
    }
  });

  recoveryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('recoveryPassword').value;
    recoveryError.hidden = true;
    if (password.length < 6) { showMessage(recoveryError, 'Password must be at least 6 characters.'); return; }

    const button = submitBtn(recoveryForm);
    setBusy(button, 'Saving…');
    try {
      const client = await ulReady;
      if (!client) { showMessage(recoveryError, UNAVAILABLE); return; }
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        showMessage(recoveryError, /password/i.test(error.message) ? error.message : 'Unable to save your new password. Please request a new reset link.');
        return;
      }
      recoveryMode = false;
      recoveryForm.reset();
      renderCurrentView();
      if (typeof showToast === 'function') showToast('Password updated', 'You are signed in with your new password.');
    } catch (error) {
      console.warn('Password update failed:', error);
      showMessage(recoveryError, UNAVAILABLE);
    } finally {
      clearBusy(button);
    }
  });

  /* ── preferences ──────────────────────────────────────── */
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

  prefsSave.addEventListener('click', async () => {
    const user = ulCurrentUser();
    if (!user) return;

    const preferences = {
      scents:   [...prefsScents.querySelectorAll('.chip-selected')].map((c) => c.dataset.scent),
      brands:   [...prefsBrands.querySelectorAll('.chip-selected')].map((c) => c.dataset.brand),
      genders:  [...prefsGender.querySelectorAll('.chip-selected')].map((c) => c.dataset.gender),
      bodyCare: prefsBodyCare.checked
    };

    prefsError.hidden = true;
    setBusy(prefsSave, 'Saving…');
    try {
      const client = await ulReady;
      if (!client) { showMessage(prefsError, UNAVAILABLE); return; }
      const { error } = await client.from('profiles')
        .upsert({ id: user.id, name: user.name, preferences, updated_at: new Date().toISOString() });
      if (error) {
        console.warn('Unable to save preferences:', error.message);
        showMessage(prefsError, 'We couldn’t save your preferences. Please try again.');
        return;
      }
      ulSetUser({ ...user, preferences });
      ulWriteJSON(UL_QUIZ_PROFILE_KEY, null);   /* quiz answers are now part of the profile */
      renderQuizSavePrompt();
      closeModal();
      renderRecommendations();
    } catch (error) {
      console.warn('Preferences save failed:', error);
      showMessage(prefsError, UNAVAILABLE);
    } finally {
      clearBusy(prefsSave);
    }
  });

  editPrefsBtn.addEventListener('click', () => {
    const user = ulCurrentUser();
    if (user) showPrefsView(user);
  });

  signOutBtn.addEventListener('click', async () => {
    setBusy(signOutBtn, 'Signing Out…');
    try {
      const client = await ulReady;
      if (client) await client.auth.signOut();
      await applySession(null, true);
      /* Don't leave this account's likes behind on a shared device. */
      window.ulWishlist?.replace([]);
      closeModal();
    } finally {
      clearBusy(signOutBtn);
    }
  });

  btns.forEach((btn) => btn.addEventListener('click', openModal));
  document.getElementById('personalizeCta')?.addEventListener('click', () => openModal('signup'));
  document.getElementById('personalizeSignIn')?.addEventListener('click', () => openModal('signin'));
  document.getElementById('aiSaveBtn')?.addEventListener('click', () => openModal(ulCurrentUser() ? 'prefs' : 'signup'));
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

  updateDot();
  renderRecommendations();

  ulReady.then((client) => {
    if (!client) return;
    client.auth.onAuthStateChange((event, session) => {
      /* Supabase forbids awaiting its own calls inside this callback, so defer. */
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') {
          recoveryMode = true;
          applySession(session).then(openModal);
          return;
        }
        applySession(session, event === 'USER_UPDATED');
      }, 0);
    });
  });
})();
