/* Runs inside each hero background scene (hero-scenes/*.html), before the
   design's own script. The scene sits in an iframe behind the homepage hero;
   hero-spotlight.js talks to it with postMessage:
     play / pause            only the scene on screen animates
     pointer {x, y}          the mouse, when it is over the hero's content
     panel {open}            open or close the design's Atmosphere panel
   and hears back:
     ready                   the scene has drawn its first frame
     panel {open}            the panel opened or closed (the hero then brings
                             the scene forward so the panel can be used) */
(function sceneBridge() {
  if (window.parent === window) return;   /* opened on its own: run as designed */
  const origin = location.origin;
  const send = (message) => window.parent.postMessage(message, origin);

  /* Paused until the hero says play. The design's first frame is still drawn
     (its onload calls render() directly), so a paused scene shows a still. */
  let playing = false;
  let waiting = [];
  const nativeFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    if (playing) return nativeFrame(callback);
    waiting.push(callback);
    return 0;
  };
  const play = () => {
    if (playing) return;
    playing = true;
    const callbacks = waiting;
    waiting = [];
    callbacks.forEach((callback) => nativeFrame(callback));
  };

  const panelOpen = () => !document.getElementById('ambientPopover')?.classList.contains('hidden');

  window.addEventListener('message', (event) => {
    if (event.origin !== origin || event.source !== window.parent) return;
    const message = event.data || {};
    if (message.type === 'play') play();
    else if (message.type === 'pause') playing = false;
    else if (message.type === 'pointer') {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: message.x, clientY: message.y }));
    } else if (message.type === 'panel' && Boolean(message.open) !== panelOpen()) {
      if (message.open) document.getElementById('toggleControlsBtn')?.click();
      else document.getElementById('closeControlsBtn')?.click();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panelOpen()) document.getElementById('closeControlsBtn')?.click();
  });

  window.addEventListener('load', () => {
    const popover = document.getElementById('ambientPopover');
    if (popover) {
      new MutationObserver(() => send({ type: 'panel', open: panelOpen() }))
        .observe(popover, { attributes: true, attributeFilter: ['class'] });
    }
    /* After the design's own onload (resize + first frame). */
    setTimeout(() => send({ type: 'ready' }), 0);
  });
})();
