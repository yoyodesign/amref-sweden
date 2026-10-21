/* ============================================================
   AMREF — Story card line patterns

   Each .story-card carries a data-line attribute naming one of
   the five line patterns.  This script takes that pattern's SVG
   tiles and injects them into the card's .story-card__media box,
   so every card owns its own line + maze:

     <li class="story-card" data-line="yellow"> … </li>

   The SVGs come from js/story-patterns.js, which bundles the files
   in assets/svgs/ (so the page also works opened from Finder).
   After editing any of those SVGs, rebuild it:

     python3 tools/build-story-patterns.py

   Files per pattern (all in assets/svgs/):
     {name}.svg               desktop, in front of the portrait
     {name}-under.svg         desktop, behind the portrait
     mobile-{name}.svg        mobile, in front of the portrait
     mobile-{name}-under.svg  mobile, behind the portrait

   The logo lines (home-lines.svg / mobile-home-lines.svg) are
   filled in here too, into #home-lines-svg / #home-lines-mobile-svg.

   The pattern also sets the card's line + CTA colour (see the
   .story-card[data-line] rules in styles.css).  Stroke colours
   in the files are replaced with currentColor so CSS controls them.

   The "lead-in" (the straight line that connects to the previous
   card) is tagged here so the scroll engines can stretch it to
   meet the previous card — see scroll.js.

   Exposes window.storyLinesReady — a Promise both scroll engines
   wait on before measuring paths.
   ============================================================ */
(function () {
  'use strict';

  /* Where the portrait's left edge sits inside each desktop tile (SVG units).
     Taken from the original hand-placed layout so each maze sits on its
     photo exactly as before.  A new pattern needs an entry here.        */
  var PATTERNS = {
    purple: { photoX: 469 },
    yellow: { photoX: 524 },
    blue: { photoX: 549 },
    green: { photoX: 549 },
    terracotta: { photoX: 551 },
  };

  var bundle = window.STORY_PATTERNS || {};

  function load(file) {
    if (!bundle[file]) {
      throw new Error(file + ' is not in js/story-patterns.js — run tools/build-story-patterns.py');
    }
    return bundle[file];
  }

  /* Copy a bundled logo SVG's viewBox + paths into the page's placeholder
     <svg>, keeping its id (CSS + the scroll engines look it up by id). */
  function fillLogo(id, file) {
    var target = document.getElementById(id);
    if (!target) return;
    var doc = new DOMParser().parseFromString(load(file), 'image/svg+xml');
    var src = doc.documentElement;
    target.setAttribute('viewBox', src.getAttribute('viewBox'));
    while (target.firstChild) target.removeChild(target.firstChild);
    Array.prototype.forEach.call(src.childNodes, function (node) {
      target.appendChild(document.importNode(node, true));
    });
  }

  /* Parse an SVG file and return a cleaned <svg> element */
  function buildSvg(text, className) {
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    var svg = document.importNode(doc.documentElement, true);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('class', 'story-lines ' + className);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('overflow', 'visible');

    var paths = svg.querySelectorAll('path');
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      p.setAttribute('stroke', 'currentColor');
      var d = p.getAttribute('d').trim();

      /* Desktop lead-in: starts at the tile's left edge (x = 0) */
      if (/^M\s*0[\s,]/.test(d)) {
        p.setAttribute('data-lead', 'start');
        p.setAttribute('data-d', d);
      }

      /* Mobile lead-in: ends at the tile's top edge (y = 0).
         Normalise a trailing "L x 0" to "V0" so it can be rewritten. */
      var endL = d.match(/L\s*(-?[\d.]+)[\s,]+(-?[\d.e-]+)\s*$/i);
      if (endL && Math.abs(parseFloat(endL[2])) < 0.5) {
        d = d.slice(0, endL.index) + 'V0';
        p.setAttribute('d', d);
      }
      if (/V\s*0\s*$/.test(d)) {
        p.setAttribute('data-lead', 'end');
        p.setAttribute('data-d', d);
      }
    }
    return svg;
  }

  function setupCard(card) {
    var name = card.getAttribute('data-line');
    var pattern = PATTERNS[name];
    var media = card.querySelector('.story-card__media');
    if (!media) return;
    if (!pattern) {
      console.warn('Unknown story line pattern "' + name + '" — add it to PATTERNS in story-lines.js');
      return;
    }

    media.style.setProperty('--line-x', pattern.photoX);

    var files = [
      [name + '-under.svg', 'story-lines--desktop story-lines--under'],
      [name + '.svg', 'story-lines--desktop story-lines--top'],
      ['mobile-' + name + '-under.svg', 'story-lines--mobile story-lines--under'],
      ['mobile-' + name + '.svg', 'story-lines--mobile story-lines--top'],
    ];

    files.forEach(function (f) {
      media.appendChild(buildSvg(load(f[0]), f[1]));
    });
  }

  /* Everything is bundled, so this runs synchronously; the Promise is kept
     so the scroll engines have one place to wait. */
  try {
    fillLogo('home-lines-svg', 'home-lines.svg');
    fillLogo('home-lines-mobile-svg', 'mobile-home-lines.svg');
    document.querySelectorAll('.story-card[data-line]').forEach(setupCard);

    /* "5 STORIES ONE MISSION" — the number follows the number of story cards */
    var count = String(document.querySelectorAll('.story-card').length);
    document.querySelectorAll('[data-story-count]').forEach(function (el) {
      el.textContent = count;
    });
  } catch (err) {
    /* Lines are decorative — the page still works without them */
    console.warn('Story lines failed to load:', err);
  }
  window.storyLinesReady = Promise.resolve();
})();
