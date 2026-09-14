(function () {
  // The client-facing loader script (DEPLOYMENT.md item #6). Draws nothing
  // itself — its only job is to mount an iframe pointing at our own
  // /embed/:clientId route, the same iframe demo/index.html hardcodes
  // directly for local testing. Reads its own <script> tag's src to figure
  // out which deployment to point the iframe at, so this file behaves
  // correctly whether it's loaded from production or a preview URL, with
  // no hardcoded domain to keep in sync.
  var script = document.currentScript;
  if (!script) return;

  var origin = new URL(script.src).origin;
  var clientId = script.getAttribute('data-client-id') || 'ecosolarusa';

  var iframe = document.createElement('iframe');
  iframe.src = origin + '/embed/' + encodeURIComponent(clientId);
  iframe.title = 'EcoSolar USA chat';
  iframe.setAttribute(
    'style',
    [
      'position:fixed',
      'bottom:0',
      'right:0',
      'width:360px',
      'height:555px',
      'max-width:100vw',
      'max-height:100vh',
      'border:none',
      'background:transparent',
      'z-index:999999',
    ].join(';')
  );

  // KNOWN LIMITATION, matching demo/index.html: this fixed-size rectangle
  // intercepts clicks/scroll on the host page underneath it, even across
  // its transparent areas when the chat is closed — there's no postMessage
  // resize handshake yet (DEPLOYMENT.md item #7). Acceptable per that same
  // doc's own fallback plan; not blocking this on that.
  function mount() {
    document.body.appendChild(iframe);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})();
