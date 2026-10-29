/* ── HERO SPOTLIGHT ──────────────────────────────────────────────
   One featured fragrance at a time, as a 3D bottle turning on a pedestal,
   centred. Selecting the bottle lifts it and shows its details and a Shop
   button below; selecting it again (or Escape) puts it back. Scrolling
   through the hero moves to the next one. Visitors see the women's
   or the men's set: their own choice (the For Her / For Him switch, the quiz,
   the New Arrivals filter), else their account's preference, else women's.
   Names, notes and prices come from products-data.js, so they always match
   the catalog. Models are web-compressed copies in models/web/.
   Each fragrance's animated background is a scene in hero-scenes/ (built from
   components/*bg.txt by tools/build-hero-scenes.mjs), shown in an iframe
   behind the content; only the scene on screen animates. */
(function initHeroSpotlight() {
  const section = document.getElementById('hero');
  if (!section?.classList.contains('spotlight') || typeof PRODUCTS === 'undefined') return;

  /* mood: the scene (hero-scenes/<mood>.html) and the colours in styles.css
     ([data-mood]) that stand for the fragrance's character. tone: whether the
     scene is dark or light, which sets the hero's text colours. */
  const FEATURED = {
    women: [
      { id: 948, model: 'models/web/chanel-coco-mademoiselle-crush.glb', mood: 'coco', tone: 'light' },
      { id: 413, model: 'models/web/good-girl-jasmine-absolue.glb', mood: 'good-girl', tone: 'dark' },
      { id: 630, model: 'models/web/prada-paradoxe-intense.glb', mood: 'paradoxe', tone: 'light' },
      { id: 592, model: 'models/web/marc-jacobs-perfect-absolute.glb', mood: 'perfect', tone: 'dark' }
    ],
    men: [
      { id: 1009, model: 'models/web/dior-sauvage-extrait.glb', mood: 'sauvage', tone: 'dark' },
      { id: 994, model: 'models/web/rabanne-1-million-black.glb', mood: 'million', tone: 'dark' },
      { id: 952, model: 'models/web/valentino-vendetta-uomo.glb', mood: 'vendetta', tone: 'dark' },
      { id: 949, model: 'models/web/ysl-myslf-intense.glb', mood: 'myslf', tone: 'dark' }
    ]
  };
  const STORAGE_KEY = 'ul-spotlight-audience';
  const AUDIENCES = ['women', 'men'];

  /* Where the bottle's base sits and how tall it stands, as fractions of the
     model area (0 = bottom, 1 = top). The pedestal top in styles.css sits at
     BASE, so every bottle stands on it whatever its shape. */
  const BASE = 0.19;
  const HEIGHT = 0.6;
  const FOOTPRINT = 0.6;
  const FIELD_OF_VIEW = 24;
  const POLAR = 82;   /* degrees from straight above: slightly above eye level, so the shadow shows */

  /* Without WebGL, or if a model fails or is slow, the product photo stands
     on the pedestal instead. */
  const FALLBACK_AFTER_MS = 12000;
  const canRender3d = (() => {
    try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')); }
    catch { return false; }
  })();

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const el = (id) => document.getElementById(id);
  const bgs = el('spotlightBgs');
  const models = el('spotlightModels');
  const dots = el('spotlightDots');
  const details = el('spotlightDetails');
  const atmosphere = el('spotlightAtmosphere');
  const audienceButtons = section.querySelectorAll('.spotlight-audience button');

  const byId = new Map(PRODUCTS.map((product) => [product.id, product]));
  let audience = null;
  let slides = [];
  let active = -1;
  let inView = true;
  let revealed = false;

  const readStored = () => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };
  const writeStored = (value) => { try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private mode */ } };

  function preferredAudience() {
    const stored = readStored();
    if (AUDIENCES.includes(stored)) return stored;
    const genders = (typeof ulCurrentUser === 'function' && ulCurrentUser()?.preferences?.genders) || [];
    const picked = AUDIENCES.filter((value) => genders.includes(value));
    return picked.length === 1 ? picked[0] : 'women';
  }

  const priceLabel = (product) => {
    const prices = (product.sizes?.length ? product.sizes.map((size) => size.price) : [product.price]).filter(Number.isFinite);
    const low = Math.min(...prices);
    return `${prices.some((price) => price !== low) ? 'From ' : ''}$${low.toLocaleString('en-US')}`;
  };
  const familyLabel = (product) => product.scents.map((scent) => scent.charAt(0).toUpperCase() + scent.slice(1)).join(' · ');
  const productUrl = (product) => `product.html?id=${product.id}`;

  /* Points the camera so the bottle's base is at BASE and its height fills
     HEIGHT of the model area, while staying inside the sides as it turns. */
  function frame(viewer) {
    if (!viewer.loaded) return;
    const size = viewer.getDimensions();
    const center = viewer.getBoundingBoxCenter();
    const aspect = viewer.clientWidth / Math.max(viewer.clientHeight, 1);
    const halfView = Math.tan((FIELD_OF_VIEW / 2) * Math.PI / 180);
    const turningRadius = Math.hypot(size.x, size.z) / 2;
    /* viewHalf: half the visible height, in metres, at the bottle. The
       second term keeps the turning footprint within the pedestal top
       (FOOTPRINT of the half-width), so wide bottles shrink to stand on it. */
    const viewHalf = Math.max(size.y / (2 * HEIGHT), turningRadius / (FOOTPRINT * aspect));
    const baseY = center.y - size.y / 2;
    const targetY = baseY + (1 - 2 * BASE) * viewHalf;
    viewer.cameraTarget = `${center.x}m ${targetY}m ${center.z}m`;
    viewer.cameraOrbit = `${viewer.getCameraOrbit().theta}rad ${POLAR}deg ${viewHalf / halfView}m`;
    viewer.jumpCameraToGoal();
  }

  function createViewer(item, product, index) {
    /* The bottle is a button: it reveals the details, whose Shop button
       goes to the product page. */
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'spotlight-model';
    link.setAttribute('aria-label', `${product.name} by ${product.brand}: show details`);
    link.setAttribute('aria-controls', 'spotlightDetails');
    link.setAttribute('aria-expanded', 'false');
    link.tabIndex = -1;
    link.addEventListener('click', () => setRevealed(!revealed));

    /* Without WebGL a plain placeholder stands in: model-viewer would only throw. */
    const viewer = document.createElement(canRender3d ? 'model-viewer' : 'div');
    viewer.dataset.src = item.model;
    viewer.setAttribute('alt', `${product.brand} ${product.name} bottle`);
    viewer.setAttribute('field-of-view', `${FIELD_OF_VIEW}deg`);
    viewer.setAttribute('min-field-of-view', `${FIELD_OF_VIEW}deg`);
    viewer.setAttribute('max-field-of-view', `${FIELD_OF_VIEW}deg`);
    viewer.setAttribute('min-camera-orbit', 'auto auto 0m');
    viewer.setAttribute('max-camera-orbit', 'auto auto 1000m');
    viewer.setAttribute('camera-orbit', `${index * 40 - 20}deg ${POLAR}deg auto`);
    viewer.setAttribute('interaction-prompt', 'none');
    viewer.setAttribute('disable-zoom', '');
    viewer.setAttribute('disable-pan', '');
    viewer.setAttribute('shadow-intensity', '1.1');
    viewer.setAttribute('shadow-softness', '0.85');
    viewer.setAttribute('exposure', '1.1');
    viewer.setAttribute('environment-image', 'neutral');
    viewer.setAttribute('rotation-per-second', '16deg');
    viewer.setAttribute('auto-rotate-delay', '0');
    viewer.setAttribute('loading', 'eager');
    if (!reducedMotion.matches) viewer.setAttribute('auto-rotate', '');
    viewer.addEventListener('load', () => {
      frame(viewer);
      link.classList.remove('is-failed');
      link.classList.add('is-loaded');
      preloadAround(active);
    });
    viewer.addEventListener('error', () => link.classList.add('is-failed'));

    const photo = document.createElement('img');
    photo.className = 'spotlight-photo';
    photo.alt = '';
    photo.decoding = 'async';
    photo.dataset.src = product.img;
    link.append(viewer, photo);
    return { link, viewer, photo };
  }

  /* Models load only when they are shown or next to the one shown. */
  function load(index) {
    const slide = slides[index];
    if (!slide || slide.started) return;
    slide.started = true;
    if (!canRender3d) return fallBack(slide);
    slide.viewer.setAttribute('src', slide.viewer.dataset.src);
    setTimeout(() => { if (!slide.viewer.loaded) fallBack(slide); }, FALLBACK_AFTER_MS);
  }
  function fallBack(slide) {
    if (!slide.photo.getAttribute('src')) slide.photo.src = slide.photo.dataset.src;
    slide.link.classList.add('is-failed');
  }
  function preloadAround(index) {
    if (!canRender3d || !slides[index]?.viewer.loaded) return;
    load(index + 1);
    load(index - 1);
  }

  /* ── Scenes: like the models, loaded when shown or next to the one shown. ── */
  function loadScene(index) {
    const slide = slides[index];
    if (!slide || slide.frame.getAttribute('src')) return;
    slide.frame.src = slide.frame.dataset.src;
  }
  const tell = (slide, message) => slide?.frame.contentWindow?.postMessage(message, location.origin);

  /* Only the scene on screen plays, and only while the hero is in view.
     With reduced motion each scene stays on its first, still frame. */
  function updatePlayback() {
    slides.forEach((slide, i) => {
      if (!slide.ready) return;
      const play = i === active && inView && !reducedMotion.matches && !document.hidden;
      tell(slide, { type: play ? 'play' : 'pause' });
    });
  }

  function setPanelOpen(open) {
    section.classList.toggle('is-atmosphere-open', open);
    atmosphere.setAttribute('aria-expanded', String(open));
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    const index = slides.findIndex((slide) => slide.frame.contentWindow === event.source);
    if (index === -1) return;
    const slide = slides[index];
    if (event.data?.type === 'ready') {
      slide.ready = true;
      slide.bg.classList.add('is-ready');
      if (index === active) atmosphere.disabled = false;
      updatePlayback();
      loadScene(active + 1);
      loadScene(active - 1);
    } else if (event.data?.type === 'panel' && index === active) {
      setPanelOpen(Boolean(event.data.open));
      /* Closed from inside the scene: keyboard focus comes back to the button. */
      if (!event.data.open && document.activeElement === slide.frame) atmosphere.focus({ preventScroll: true });
    }
  });

  atmosphere.addEventListener('click', () => {
    tell(slides[active], { type: 'panel', open: atmosphere.getAttribute('aria-expanded') !== 'true' });
  });

  /* Over the hero's own content (the bottle, the panel), pass the pointer on
     so the scene still follows it. Elsewhere the scene gets it directly. */
  let pointerQueued = null;
  section.addEventListener('pointermove', (event) => {
    const slide = slides[active];
    if (!slide?.ready) return;
    const wasQueued = pointerQueued;
    pointerQueued = event;
    if (wasQueued) return;
    requestAnimationFrame(() => {
      const box = slide.frame.getBoundingClientRect();
      tell(slide, { type: 'pointer', x: pointerQueued.clientX - box.left, y: pointerQueued.clientY - box.top });
      pointerQueued = null;
    });
  }, { passive: true });

  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    updatePlayback();
  }).observe(section);
  document.addEventListener('visibilitychange', updatePlayback);

  /* Lifts the bottle and shows the details, or puts it back. */
  function setRevealed(open) {
    revealed = open;
    section.classList.toggle('is-revealed', open);
    details.inert = !open;
    slides.forEach((slide) => slide.link.setAttribute('aria-expanded', String(open)));
    if (open) {
      /* Restart the details' fade so each reveal arrives fresh. */
      details.classList.remove('is-changing');
      void details.offsetWidth;
      details.classList.add('is-changing');
    }
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && revealed) {
      setRevealed(false);
      slides[active]?.link.focus({ preventScroll: true });
    }
  });

  function build() {
    slides = FEATURED[audience]
      .map((item) => ({ item, product: byId.get(item.id) }))
      .filter((slide) => slide.product);

    /* Each background: the mood's colours (styles.css) at once, then the
       scene fading in over them when it is ready. */
    slides.forEach((slide) => {
      const bg = document.createElement('div');
      bg.className = 'spotlight-bg';
      bg.dataset.mood = slide.item.mood;
      const frame = document.createElement('iframe');
      frame.className = 'spotlight-scene';
      frame.dataset.src = `hero-scenes/${slide.item.mood}.html`;
      frame.title = `${slide.product.name} background`;
      frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true');
      bg.append(frame);
      Object.assign(slide, { bg, frame, ready: false });
    });
    bgs.replaceChildren(...slides.map((slide) => slide.bg));
    slides.forEach((slide, index) => Object.assign(slide, createViewer(slide.item, slide.product, index)));
    models.replaceChildren(...slides.map((slide) => slide.link));

    dots.replaceChildren(...slides.map(({ product }, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'spotlight-dot';
      dot.setAttribute('aria-label', `${product.brand} ${product.name}`);
      dot.addEventListener('click', () => scrollToSlide(index));
      return dot;
    }));
    section.style.setProperty('--slides', slides.length);
    active = -1;
  }

  function show(index) {
    if (index === active || !slides[index]) return;
    const { product, item } = slides[index];
    if (slides[active]) tell(slides[active], { type: 'panel', open: false });
    setPanelOpen(false);
    setRevealed(false);   /* each fragrance arrives centred */
    active = index;
    section.dataset.mood = item.mood;
    section.dataset.tone = item.tone;
    /* The header takes on this scene's colours while over the hero. */
    document.body.dataset.heroTone = item.tone;
    document.body.dataset.heroMood = item.mood;
    atmosphere.disabled = !slides[index].ready;

    [...bgs.children].forEach((bg, i) => bg.classList.toggle('is-active', i === index));
    slides.forEach((slide, i) => {
      slide.link.classList.toggle('is-active', i === index);
      slide.link.tabIndex = i === index ? 0 : -1;
      slide.link.setAttribute('aria-hidden', String(i !== index));
    });
    [...dots.children].forEach((dot, i) => dot.setAttribute('aria-current', i === index ? 'true' : 'false'));

    el('spotlightFamily').textContent = familyLabel(product);
    el('spotlightCount').textContent = `${index + 1} / ${slides.length}`;
    el('spotlightHouse').textContent = product.brand;
    el('spotlightName').textContent = product.name;
    el('spotlightNotes').replaceChildren(...product.notes.map((note) => {
      const li = document.createElement('li');
      li.textContent = note;
      return li;
    }));
    el('spotlightPrice').textContent = priceLabel(product);
    const shop = el('spotlightShop');
    shop.href = productUrl(product);
    shop.setAttribute('aria-label', `Shop ${product.name} by ${product.brand}`);

    load(index);
    preloadAround(index);
    loadScene(index);
    updatePlayback();
  }

  /* ── Scroll: each fragrance gets an equal stretch of the section. ── */
  function progress() {
    const rect = section.getBoundingClientRect();
    const travel = section.offsetHeight - window.innerHeight;
    return travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
  }
  const slideAt = (value) => Math.min(slides.length - 1, Math.floor(value * slides.length));

  function scrollToSlide(index) {
    const travel = section.offsetHeight - window.innerHeight;
    const top = section.getBoundingClientRect().top + window.scrollY + travel * ((index + 0.5) / slides.length);
    window.scrollTo({ top, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  let queued = false;
  /* Whether the header is over the hero (it blends with the scene) or past it. */
  function updateHeader() {
    const header = document.getElementById('mainNav');
    const over = section.getBoundingClientRect().bottom > (header?.offsetHeight || 72);
    document.body.classList.toggle('nav-over-hero', over);
  }

  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      show(slideAt(progress()));
      updateHeader();
    });
  }

  function setAudience(value, { remember = false } = {}) {
    if (!AUDIENCES.includes(value)) return;
    if (remember) writeStored(value);
    if (value === audience) return;
    audience = value;
    section.dataset.audience = value;
    audienceButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.audience === value)));
    build();
    show(slideAt(progress()));
  }

  audienceButtons.forEach((button) => button.addEventListener('click', () => setAudience(button.dataset.audience, { remember: true })));
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => slides.forEach(({ viewer }) => frame(viewer)));
  reducedMotion.addEventListener?.('change', () => {
    slides.forEach(({ viewer }) => viewer.toggleAttribute('auto-rotate', !reducedMotion.matches));
    updatePlayback();
  });

  /* For the quiz and New Arrivals filter (app.js), and account changes (auth.js). */
  window.ulSpotlight = {
    choose: (value) => setAudience(value, { remember: true }),
    refresh: () => setAudience(preferredAudience())
  };

  setAudience(preferredAudience());
  updateHeader();
})();
