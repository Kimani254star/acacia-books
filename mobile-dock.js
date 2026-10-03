/* Mobile tools button.
   On screens 1100px wide or less the right-hand panel (Notebook, Webinar, Team Status, Google...)
   is hidden so it can't cover the page. This adds a floating tools button that opens it as a drawer.
   Add once to index.html, after app-3.js:   <script src="mobile-dock.js"></script>
   Works with style.css (class acx-dock-open). No effect on laptops. */
(function () {
  'use strict';
  var B = document.body;
  function close() { document.body.classList.remove('acx-dock-open'); }
  function build() {
    if (document.getElementById('acxDockToggle')) return true;
    var rs = document.getElementById('rightSidebar');
    if (!rs || !document.body) return false;

    var t = document.createElement('button');
    t.id = 'acxDockToggle'; t.type = 'button'; t.title = 'Tools'; t.setAttribute('aria-label', 'Open tools');
    t.textContent = '\uD83E\uDDF0';
    t.onclick = function (e) {
      e.stopPropagation();
      document.body.classList.remove('acx-nav-open');
      document.body.classList.add('acx-dock-open');
    };
    document.body.appendChild(t);

    var x = document.createElement('button');
    x.id = 'acxDockClose'; x.type = 'button'; x.setAttribute('aria-label', 'Close tools'); x.textContent = '\u2715';
    x.onclick = function (e) { e.stopPropagation(); close(); };
    rs.appendChild(x);
    return true;
  }
  /* tapping the dim backdrop, a tool, or pressing Esc closes the drawer */
  document.addEventListener('click', function (e) {
    if (!document.body.classList.contains('acx-dock-open')) return;
    var t = e.target;
    if (t && (t.id === 'acxNavBackdrop' || (t.closest && t.closest('#rightSidebar button:not(#acxDockClose)')))) close();
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  /* opening the left menu closes the tools drawer */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#acxNavToggle')) close();
  }, true);
  window.addEventListener('resize', function () { if (window.innerWidth > 1100) close(); });

  var tries = 0;
  (function wait() { if (!build() && tries++ < 60) setTimeout(wait, 500); })();
})();
