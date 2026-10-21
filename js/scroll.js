/* ============================================================
   AMREF — Scroll engine  (desktop >1024px only)

   Dark section immediately follows the hero.
   SVG + cards pan left together at 1:1 scroll ratio.
   Pan distance = full SVG rendered width − viewport width.
   No easing, no lerp.

   The resize listener is always attached so that loading at a
   mobile size and then expanding to desktop initialises correctly.
   ============================================================ */
(function () {
  'use strict';

  var darkSection = document.getElementById('dark-section');
  var linesBg = document.getElementById('lines-bg');
  var track = document.getElementById('stories-track');
  var darkText = document.getElementById('dark-section-text');

  if (!darkSection || !track || !linesBg) return;

  /* SVG coordinate constants for the text overlay */
  var TEXT_LOGO_LEFT = 255; /* left edge of text container in SVG units */
  var TEXT_LOGO_W = 1135; /* width of container in SVG units          */
  var TEXT_TOP_SVG = 613; /* top of text block in SVG units           */
  var TEXT_FONT_SVG = 80; /* font size in SVG units — tune here       */

  /* SVG_W — total design width in SVG units.  Recalculated in init() from the
     number of story cards (see cardsDesignWidth), so adding a card extends the
     pan automatically.                                                       */
  var SVG_W = 7160;
  var SVG_H = 1130;

  /* Story card layout in SVG units (must match .story-card in styles.css) */
  var CARDS_LEFT = 1670; /* first card's left edge, from the logo SVG's origin */
  var CARD_W = 1040; /* card width */
  var CARDS_TAIL = 290; /* design width past the last card (line maths only) */

  /* Lead-in lines: the straight line at the start of each card's under-tile
     is stretched (or trimmed) so it starts a set gap after the previous card.
     LOGO_EXIT_X — where the logo's line leaves the logo SVG (home-lines.svg).
     LEAD_GAP    — space in px between the previous card's photo and the start
                   of the next line.  0 = touching; negative = tucked behind. */
  var LOGO_EXIT_X = 1389;
  var LEAD_GAP = 32;
  /* LOGO_OVERLAP — card 1's line starts this many SVG units under the end of
     the logo line, so there's no hairline seam where the two meet. */
  var LOGO_OVERLAP = 6;



  function cardsDesignWidth() {
    return CARDS_LEFT + CARD_W * track.querySelectorAll('.story-card').length + CARDS_TAIL;
  }
  var svgScale = 1;
  var initialLeft = 0;
  var panDur = 0;
  var panDelay = 0; /* scroll px the design holds still while lines draw in */
  var holdEndX = 0; /* SVG x the logo draw-front reaches as the hold ends (see init) */

  /* Pan speed — how much horizontal distance the design moves per scroll px.
     1.0 = 1:1 with scroll (fast); lower values slow the pan and lengthen the
     section proportionally so the full SVG is still reachable.
     ↑ toward 1.0 = faster pan, shorter page
     ↓ toward 0.5 = slower pan, longer page                                   */
  var PAN_SPEED = 0.7;

  var active = false; /* true when desktop scroll engine is running */
  var darkTextTriggered = false; /* true once text char-rise has fired */

  /* ── Stroke-draw ─────────────────────────────────────────── */
  /* Draw-front technique: a "draw front" advances from SVG x=0  */
  /* to x=SVG_W as the user scrolls.  Each path shows only the   */
  /* portion whose SVG x-position lies to the LEFT of the front.  */
  /* Because all paths reference the same physical x-coordinate,  */
  /* adjacent segments always meet perfectly — no gaps.           */
  /*                                                               */
  /* Path direction is detected per-path so that L→R paths draw   */
  /* from their start and R→L paths reveal their physical left     */
  /* portion (tail) as the front advances.                         */

  var strokePaths = []; /* { el, len, bboxX, bboxW, ltr }                    */
  var strokeFrontMin = 0; /* SVG x where the initial draw-front starts (= leftmost path bboxX in the initial view) */
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Timing constants ───────────────────────────────────────────────
   *
   *  PAN_SPEED  (module-level, line ~35)
   *    How fast the horizontal pan moves per scroll pixel.
   *    ↑ toward 1.0 = faster pan / shorter page
   *    ↓ toward 0.5 = slower pan / longer page
   *
   *  PAUSE_MULT  (in init())
   *    Sets the logo draw pace; the hold (panDelay) then lasts exactly
   *    until the logo lines finish at LOGO_EXIT_X.
   *    ↑ increase = slower initial draw / longer hold
   *    ↓ decrease = quicker initial draw / pan begins sooner
   *
   *  MIN_WIN  (strokePanX pixels)
   *    Minimum draw window per path.  Raise if any path draws too fast.
   * ─────────────────────────────────────────────────────────────── */

  function initStrokes() {
    clearStrokes();
    if (prefersReducedMotion) return;

    /* Initial viewport right edge in SVG coordinates (panX = 0) */
    var vpRight = (window.innerWidth - initialLeft) / svgScale;
    var minX = Infinity;

    var homeSvg = document.getElementById('home-lines-svg');
    var homeLeft = homeSvg ? homeSvg.getBoundingClientRect().left : initialLeft;

    alignTilesToLogo(homeSvg);
    stretchLeadIns(homeLeft);

    /* Logo SVG + every card's desktop tiles.  Card tiles have their own
       coordinate space, so each one's x offset (in logo-SVG units) is added
       to its paths' bbox — the draw logic below then treats all paths as if
       they were in one long SVG, which keeps the joins seamless.          */
    var svgs = [homeSvg].concat(Array.from(track.querySelectorAll('.story-lines--desktop')));

    var cardEls = track.querySelectorAll('.story-card');
    var lastCard = cardEls[cardEls.length - 1];

    for (var s = 0; s < svgs.length; s++) {
      var svg = svgs[s];
      if (!svg) continue;
      var inLastCard = s > 0 && svg.closest('.story-card') === lastCard;
      var offsetX = s === 0 ? 0 : (svg.getBoundingClientRect().left - homeLeft) / svgScale;
      var paths = svg.querySelectorAll('path[stroke]');
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i];
        var len = p.getTotalLength();
        var lb = p.getBBox();
        var bbox = { x: lb.x + offsetX, y: lb.y, width: lb.width, height: lb.height };

        /* Detect path direction: does the parametric start sit on the
           left side of the bounding box (L→R) or the right side (R→L)? */
        var startX = p.getPointAtLength(0).x + offsetX;
        var ltr = startX <= bbox.x + bbox.width * 0.5;

        /* Vertical entry lines vs logo decorations:
           The three big paths that descend from the top of the SVG (startY < 200)
           are the coloured vertical lines — they start drawing immediately.
           Smaller decorative elements that sit entirely within the logo area
           (bboxX < LOGO_THRESHOLD but startY ≥ 200) are given a later start.
           LOGO_THRESHOLD — SVG x boundary for the logo zone.
           LOGO_DELAY     — fraction (0–1) of hold phase to wait. ↑ = later  */
        var LOGO_THRESHOLD = 900;
        var LOGO_DELAY = 0.5;
        var startY = p.getPointAtLength(0).y;
        /* Paths that start near the top of the SVG (y < 200) are the five
           vertical entry lines — no delay and flagged so their draw-front
           is anchored to strokeFrontMin (see updateStrokes).              */
        var isVertical = s === 0 && startY < 200;

        /* The vertical entry lines always draw from their start (the top of
           the screen) — their bbox can sit either side of the start point, so
           the left/right guess above isn't reliable for them. */
        if (isVertical) ltr = true;
        var pathDelay = bbox.x < LOGO_THRESHOLD && !isVertical ? LOGO_DELAY : 0;

        /* Every path in a card's tiles uses the card trigger (draws as it
           reaches the viewport centre).  Card 1's lead-in starts at the logo's
           exit (x 1389), inside the initial view, so without this it would be
           classed as an initial path and draw during the hold phase — before
           it's on screen.  forceCard keeps it, and any card path at wide
           viewports, on the viewport-relative trigger.                      */
        var forceCard = s > 0;

        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len; /* start invisible */

        strokePaths.push({
          el: p,
          len: len,
          bboxX: bbox.x,
          bboxW: bbox.width,
          bboxH: bbox.height,
          ltr: ltr,
          delay: pathDelay,
          isVertical: isVertical,
          forceCard: forceCard,
          inLastCard: inLastCard,
        });

        /* Track the leftmost path that sits within the initial viewport —
           the draw-front will start here so lines begin on first scroll. */
        if (bbox.x < vpRight && bbox.x < minX) minX = bbox.x;
      }
    }

    strokeFrontMin = minX === Infinity ? 0 : Math.max(0, minX);

    /* Dash offsets are set — safe to show the card tiles */
    track.querySelectorAll('.story-lines--desktop').forEach(function (el) {
      el.classList.add('is-ready');
    });

    /* Sort left→right so the sequential card gate (updateStrokes) processes
       paths in the correct order — connectors must update maxConnCompletion
       before the bars that follow them are evaluated.                        */
    strokePaths.sort(function (a, b) {
      return a.bboxX - b.bboxX;
    });
  }

  /* ── Fit each card's lead-in to the previous card ─────────────
     Card 1 joins the logo's exit line; every other card's line starts
     LEAD_GAP px after the previous card's photo.  Run while the track is
     at translateX(0) so rects are in their natural positions.        */
  /* ── Line the card tiles up with the logo's exit line ──────────
     CSS places each tile from its photo, but the photo's height on screen
     doesn't scale exactly with the logo SVG, so on large screens the two
     drift a few px apart.  Here every card's desktop tiles are moved so
     their lead-in sits at exactly the logo exit line's height.         */
  function alignTilesToLogo(homeSvg) {
    if (!homeSvg) return;
    var exit = null;
    homeSvg.querySelectorAll('path').forEach(function (p) {
      var end = p.getPointAtLength(p.getTotalLength());
      if (Math.abs(end.x - LOGO_EXIT_X) < 1) exit = end;
    });
    if (!exit) return;
    var homeTop = homeSvg.getBoundingClientRect().top;
    var exitPx = homeTop + exit.y * svgScale;

    track.querySelectorAll('.story-card').forEach(function (card) {
      var media = card.querySelector('.story-card__media');
      var lead = card.querySelector('.story-lines--desktop [data-lead="start"]');
      if (!media || !lead) return;
      var leadY = parseFloat(lead.getAttribute('data-d').match(/^M\s*0[\s,]+(-?[\d.]+)/)[1]);
      /* Where the tile's box needs to start on screen for its lead-in to sit
         exactly on the logo line.  Browsers round each SVG box to the pixel
         grid separately, so the box is placed a whole number of px from the
         logo SVG's box (both then round the same way), and the leftover
         fraction is applied inside the SVG by shifting its viewBox.      */
      var wantTop = exitPx - leadY * svgScale;
      var boxTop = homeTop + Math.round(wantTop - homeTop);
      var shiftUnits = (wantTop - boxTop) / svgScale;
      var mediaTop = media.getBoundingClientRect().top;
      card.querySelectorAll('.story-lines--desktop').forEach(function (svg) {
        var vb = svg.getAttribute('data-viewbox') || svg.getAttribute('viewBox');
        svg.setAttribute('data-viewbox', vb);
        var v = vb.split(/[\s,]+/).map(Number);
        svg.setAttribute('viewBox', [v[0], v[1] - shiftUnits, v[2], v[3]].join(' '));
        svg.style.top = boxTop - mediaTop + 'px';
      });
    });
  }

  function stretchLeadIns(homeLeft) {
    var cards = track.querySelectorAll('.story-card');
    for (var i = 0; i < cards.length; i++) {
      var under = cards[i].querySelector('.story-lines--desktop.story-lines--under');
      var lead = under && under.querySelector('[data-lead="start"]');
      if (!lead) continue;

      var prevMedia = i > 0 ? cards[i - 1].querySelector('.story-card__media') : null;
      var targetPx = prevMedia
        ? prevMedia.getBoundingClientRect().right + LEAD_GAP
        : homeLeft + (LOGO_EXIT_X - LOGO_OVERLAP) * svgScale;

      var startX = (targetPx - under.getBoundingClientRect().left) / svgScale;
      lead.setAttribute(
        'd',
        lead.getAttribute('data-d').replace(/^M\s*0/, 'M' + startX.toFixed(2)),
      );
    }
  }

  function updateStrokes(strokePanX) {
    if (strokePaths.length === 0) return;

    var VW = window.innerWidth;
    var VH = window.innerHeight;

    /* Pan position — mirrors the calculation in onScroll */
    var sy = Math.max(0, strokePanX - VH);
    var px = clamp((sy - panDelay) * PAN_SPEED, 0, panDur);
    var panAdvanceSVG = px / svgScale;

    /* Viewport right edge in SVG coordinates */
    var vpRightAtRest = (VW - initialLeft) / svgScale; /* right edge at panX=0  */
    var actualVpRight = vpRightAtRest + panAdvanceSVG; /* current right edge     */
    var actualVpRightMax = vpRightAtRest + panDur / svgScale; /* max right edge (end of pan) */

    /* ── Two-front draw system ─────────────────────────────────────────────
       Paths are split into two groups based on their SVG x position:

       INITIAL paths (bboxX < vpRightAtRest ≈ 1714):
         The central logo-connector lines.  Draw front sweeps strokeFrontMin
         → holdEndX (the logo's exit) over the full hold window (section entry +
         stationary panDelay).  Lines begin the instant the section appears at
         the viewport bottom and complete exactly as the pan begins.

         Tuning: PAUSE_MULT in init() sets the draw pace and hold length.
           ↑ PAUSE_MULT = more scroll before pan / longer draw window
           ↓ PAUSE_MULT = shorter hold / quicker pan start

       CARD paths (bboxX ≥ vpRightAtRest):
         Two sub-types, distinguished by bboxH (SVG bounding-box height):

         All card paths use the same trigger: a group starts drawing when its
           left bboxX reaches the viewport centre (actualVpRight = bboxX +
           vpHalfWidth), and draws 1:1 so it completes when its right edge
           reaches the centre.  The sequential gate ensures the order is always
           connector → bars → next connector, never drawing ahead.             */

    /* — Initial lines — */
    var totalRamp = VH + panDelay;
    var holdFrac = totalRamp > 0 ? clamp(strokePanX / totalRamp, 0, 1) : 1;
    var vpHalfWidth = VW / (2 * svgScale); /* half-viewport width in SVG units */

    /* — Card lines: end-of-pan compression —
       Card paths draw as they cross the viewport centre.  The pan stops with
       the last card centred, so its maze would otherwise never cross the
       centre.  From the moment the last card's lead-in starts drawing, the
       draw-front is sped up just enough that everything finishes exactly as
       the pan ends — still in order (lead-in → maze), just a little quicker. */
    var tailStart = Infinity; /* front position where the last card starts drawing */
    var needEnd = actualVpRightMax; /* front position at which every card path is complete */
    for (var t = 0; t < strokePaths.length; t++) {
      var it = strokePaths[t];
      if (!it.forceCard) continue;
      needEnd = Math.max(needEnd, it.bboxX + it.bboxW + vpHalfWidth);
      if (it.inLastCard) tailStart = Math.min(tailStart, it.bboxX + vpHalfWidth);
    }
    function cardFront(x) {
      if (needEnd <= actualVpRightMax) return x; /* everything fits naturally */
      if (tailStart >= actualVpRightMax) return x + (needEnd - actualVpRightMax);
      if (x <= tailStart) return x;
      return tailStart + ((x - tailStart) * (needEnd - tailStart)) / (actualVpRightMax - tailStart);
    }
    var cardFrontX = cardFront(actualVpRight);

    for (var i = 0; i < strokePaths.length; i++) {
      var item = strokePaths[i];
      var fraction;

      if (item.bboxX >= vpRightAtRest || item.forceCard) {
        /* Trigger: path begins drawing when its left edge reaches the viewport
           centre (front = bboxX + vpHalfWidth) and draws 1:1, so it completes
           when its right edge passes the centre.  cardFrontX is the front with
           the end-of-pan compression applied (see above).
           forceCard paths (all card tiles) always use this branch, even when
           their bboxX falls inside the initial view.                         */
        var naturalStart = item.bboxX + vpHalfWidth;
        if (naturalStart > cardFrontX) {
          item.el.style.strokeDasharray = item.len;
          item.el.style.strokeDashoffset = item.len;
          continue;
        }
        fraction = clamp((cardFrontX - naturalStart) / (item.bboxW > 0 ? item.bboxW : 1), 0, 1);
      } else {
        /* Initial path — per-path delayed draw front.
           Logo/maze paths (delay > 0) wait until the hold phase is
           partly through before their draw front begins advancing.
           Vertical entry lines use eBboxX = strokeFrontMin so all five
           lines start drawing simultaneously regardless of their actual bboxX. */
        var pHoldFrac =
          item.delay > 0 ? clamp((holdFrac - item.delay) / (1 - item.delay), 0, 1) : holdFrac;
        var eBboxX = item.isVertical ? strokeFrontMin : item.bboxX;
        var eBboxW = item.bboxX + item.bboxW - eBboxX;
        var pFront = clamp(
          strokeFrontMin + (holdEndX - strokeFrontMin) * pHoldFrac + panAdvanceSVG,
          0,
          SVG_W,
        );
        fraction = eBboxW > 0 ? clamp((pFront - eBboxX) / eBboxW, 0, 1) : pFront >= eBboxX ? 1 : 0;
      }

      var visLen = item.len * fraction;
      var invLen = item.len - visLen;

      if (item.ltr) {
        /* L→R path: draw the first `visLen` parametric units from start */
        item.el.style.strokeDasharray = item.len;
        item.el.style.strokeDashoffset = invLen;
      } else {
        /* R→L path: the physical left portion is the parametric tail.
           Skip `invLen` units then draw `visLen` units.                */
        item.el.style.strokeDasharray = '0,' + invLen + ',' + visLen + ',99999';
        item.el.style.strokeDashoffset = 0;
      }
    }
  }

  function clearStrokes() {
    for (var i = 0; i < strokePaths.length; i++) {
      strokePaths[i].el.style.strokeDasharray = '';
      strokePaths[i].el.style.strokeDashoffset = '';
    }
    track.querySelectorAll('.story-lines--desktop').forEach(function (el) {
      el.classList.remove('is-ready');
      el.style.top = '';
    });
    strokePaths = [];
    strokeFrontMin = 0;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /* ── Clear all inline styles set by the desktop engine ─── */
  function teardown() {
    darkSection.style.height = '';
    track.style.paddingLeft = '';
    track.style.transform = '';
    linesBg.style.transform = '';
    clearStrokes();
    /* Restore all card links to naturally focusable on mobile */
    var links = track.querySelectorAll('a[href], button');
    for (var i = 0; i < links.length; i++) {
      links[i].tabIndex = 0;
    }
    focusedCardIdx = -1;
    /* Remove desktop-only sentinel */
    if (sentinel && sentinel.parentNode) {
      sentinel.parentNode.removeChild(sentinel);
      sentinel = null;
    }
    storyCards = [];
    cardRevealed = [];
    cardTriggerPanX = [];
  }

  /* ── Card reveal state ──────────────────────────────────── */
  var storyCards = []; /* .story-card elements (populated in init) */
  var cardRevealed = []; /* parallel boolean array, prevents double-reveal */
  var cardTriggerPanX = []; /* refined per-card trigger thresholds (computed in init) */

  function revealCard(card) {
    card.classList.add('is-revealed');
    card.querySelectorAll('[data-rollup]').forEach(function (el) {
      el.classList.add('is-revealed');
    });
    card.querySelectorAll('[data-reveal-text]').forEach(function (el) {
      var delay = prefersReducedMotion ? 0 : Number(el.getAttribute('data-reveal-text-delay') || 0);
      delay
        ? setTimeout(function () {
            el.classList.add('is-revealed');
          }, delay)
        : el.classList.add('is-revealed');
    });
    card.querySelectorAll('[data-reveal-media]').forEach(function (el) {
      var delay = prefersReducedMotion
        ? 0
        : Number(el.getAttribute('data-reveal-media-delay') || 0);
      delay
        ? setTimeout(function () {
            el.classList.add('is-revealed');
          }, delay)
        : el.classList.add('is-revealed');
    });
  }

  /* ── Keyboard navigation state ──────────────────────────── */
  var cardCenters = []; /* panX value that centres each card (computed in init) */
  var dsTop = 0; /* dark-section's document-relative top (cached in init) */
  var focusedCardIdx = -1; /* which card CTA is currently keyboard-focused (-1 = none) */
  var sentinel = null; /* visually-hidden entry button injected on desktop */

  /* ── Compute the panX that centres each card ─────────────────
     Called during init() while track is at translateX(0), so
     getBoundingClientRect().left reflects the card's natural
     horizontal position with no transform offset.              */
  function computeCardCenters() {
    var VW = window.innerWidth;
    var scrollY = window.pageYOffset || document.documentElement.scrollTop;
    /* Cache dark-section document top: constant regardless of scroll */
    dsTop = darkSection.getBoundingClientRect().top + scrollY;

    cardCenters = [];
    cardTriggerPanX = [];
    var cards = track.querySelectorAll('.story-card');
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      /* At panX=0 (translateX(0)) rect.left IS the natural left.
         panX needed to centre card = natural_centre − VW/2        */
      var centre = rect.left + rect.width / 2;
      var centerPanX = clamp(centre - VW / 2, 0, panDur);
      cardCenters.push(centerPanX);

      /* Trigger 35% of VW before card reaches centre, but never before the
         card's left edge has entered the viewport. */
      var enterPanX = Math.max(0, rect.left - VW);
      var trigger = clamp(centre - VW / 2 - VW * 0.35, enterPanX, panDur);
      cardTriggerPanX.push(trigger);
    }
  }

  /* ── Keyboard: focus a specific card by index ───────────────
     Scroll the window so the card is already in the viewport,
     re-sync transforms via onScroll(), then focus with
     preventScroll:true.  Because the element is genuinely
     visible at this scroll position, the browser's internal
     scrollIntoView algorithm sees it as already on-screen and
     does nothing — no scroll jump, no display glitch.          */
  function focusCard(idx) {
    var cards = track.querySelectorAll('.story-card');
    if (idx < 0 || idx >= cards.length) return;
    var cta = cards[idx].querySelector('a[href], button');
    if (!cta) return;

    /* Remove sentinel from Tab order while navigating cards so that
       Shift+Tab from card 0 skips it and exits the section naturally.
       It is restored once focus leaves dark-section (see focusout).  */
    if (sentinel) sentinel.tabIndex = -1;

    /* 1. Move window to the scroll position that shows this card.
          Divide by PAN_SPEED because panX = (sy-panDelay) * PAN_SPEED. */
    window.scrollTo(0, dsTop + panDelay + Math.round(cardCenters[idx] / PAN_SPEED));

    /* 2. Re-sync transforms immediately (don't wait for scroll event) */
    onScroll();

    /* 3. Focus — element is now in viewport so scrollIntoView is no-op */
    cta.tabIndex = 0; /* allow focus (normally -1 on desktop) */
    cta.focus({ preventScroll: true });
    focusedCardIdx = idx;

    /* 4. Remove from tab order again so natural Tab doesn't reach it */
    cta.tabIndex = -1;
  }

  /* ── Layout ─────────────────────────────────────────────── */
  function init() {
    var VH = window.innerHeight;
    var VW = window.innerWidth;

    svgScale = VH / SVG_H;
    SVG_W = cardsDesignWidth();
    initialLeft = VW / 2 - 810 * svgScale;

    /* Offset card track so card 1 aligns with first SVG connector group */
    var pl = initialLeft + CARDS_LEFT * svgScale + 'px';
    track.style.paddingLeft = pl;

    /* panDur — total horizontal pan.  The pan ends with the last card centred
       on screen, then the page carries on scrolling down to the stats.
       Card width = calc(1040/1130 * 100vh) from CSS; with N cards the last card
       centre is at paddingLeft + (N − 0.5) * cardWidth.
       END_OFFSET — px to stop short of (−) or past (+) centre; 0 = centred. */
    var END_OFFSET = 0;
    var cardWidth = (CARD_W / SVG_H) * VH;
    var plPx = initialLeft + CARDS_LEFT * svgScale;
    var cardCount = track.querySelectorAll('.story-card').length;
    var lastCardCentre = plPx + (cardCount - 0.5) * cardWidth;
    panDur = Math.max(0, lastCardCentre - VW / 2 + END_OFFSET);

    linesBg.style.transform = 'translateX(' + initialLeft + 'px)';
    linesBg.style.opacity = '1';

    /* Position the text overlay in SVG coordinate space */
    if (darkText) {
      darkText.style.display = 'grid';
      darkText.style.top = TEXT_TOP_SVG * svgScale + 'px';
      darkText.style.left = TEXT_LOGO_LEFT * svgScale + 'px';
      darkText.style.width = TEXT_LOGO_W * svgScale + 'px';
      darkText.style.fontSize = TEXT_FONT_SVG * svgScale + 'px';
    }
    track.style.transform = 'translateX(0)';
    initStrokes();

    /* panDelay — scroll px the design holds stationary before the
       horizontal pan begins.  The logo lines draw during this hold.
       Draw pace is set by PAUSE_MULT: the front would cross the whole
       initial view (strokeFrontMin → viewport right edge) over
       VW × PAUSE_MULT scroll px.  The hold ends as soon as the front
       reaches the logo's exit (LOGO_EXIT_X), so the pan starts the
       moment the last logo line finishes — no dead scroll.
       ↑ increase PAUSE_MULT (e.g. 2.0) for a slower draw / longer hold
       ↓ decrease (e.g. 1.0) for a quicker draw / pan start            */
    var PAUSE_MULT = 1.5;
    var vpRightAtRest = (VW - initialLeft) / svgScale;
    var fullRamp = VH + Math.max(0, VW * PAUSE_MULT - VH);
    holdEndX = Math.min(LOGO_EXIT_X, vpRightAtRest);
    var holdShare =
      vpRightAtRest > strokeFrontMin
        ? clamp((holdEndX - strokeFrontMin) / (vpRightAtRest - strokeFrontMin), 0, 1)
        : 1;
    panDelay = Math.max(0, Math.round(fullRamp * holdShare - VH));

    /* panDur is divided by PAN_SPEED so the full SVG remains reachable
       even when the pan moves slower than 1:1 with scroll.            */
    darkSection.style.height = Math.round(panDur / PAN_SPEED) + VH + panDelay + 'px';

    /* Compute card centres while track is at translateX(0) */
    computeCardCenters();

    /* Set up per-card reveal tracking */
    storyCards = Array.from(track.querySelectorAll('.story-card'));
    cardRevealed = storyCards.map(function () {
      return false;
    });
    if (prefersReducedMotion) {
      storyCards.forEach(function (card) {
        revealCard(card);
      });
    }

    /* Remove all card CTAs from Tab order on desktop —
       keyboard navigation is handled entirely by focusCard().  */
    var links = track.querySelectorAll('a[href], button');
    for (var i = 0; i < links.length; i++) {
      links[i].tabIndex = -1;
    }

    /* Inject a visually-hidden sentinel button as the sole Tab entry-point
       into this section.  It sits outside the sticky stage so scrollIntoView
       targets the top of dark-section (harmless), then focusin immediately
       redirects to the correct card via focusCard().
       Direction is detected from relatedTarget position in the DOM:
       coming from above → card 0; coming from below → last card.    */
    if (!sentinel) {
      sentinel = document.createElement('button');
      sentinel.className = 'visually-hidden';
      sentinel.type = 'button';
      sentinel.setAttribute('aria-label', 'Story cards — use Tab / Shift+Tab to navigate');
      sentinel.addEventListener('focus', function (e) {
        if (!active || !cardCenters.length) return;
        var from = e.relatedTarget;
        var idx = 0; /* default: entering from above → card 0 */
        if (from && !darkSection.contains(from)) {
          /* DOCUMENT_POSITION_FOLLOWING means darkSection comes AFTER `from`
             → user is tabbing forward from above the section → card 0.
             Otherwise they are shift-tabbing backward from below → last card. */
          var pos = from.compareDocumentPosition(darkSection);
          if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) idx = cardCenters.length - 1;
        }
        focusCard(idx);
      });
      var stage = document.getElementById('dark-stage');
      darkSection.insertBefore(sentinel, stage || darkSection.firstChild);
    }
  }

  /* ── Scroll handler — direct 1:1, no easing ────────────── */
  function onScroll() {
    if (!active) return;

    /* raw: how far the dark section has scrolled past the viewport top
       (negative = not yet reached top; positive = past it).
       sy:  same but clamped to 0 so we never get negative pan.        */
    var raw = -darkSection.getBoundingClientRect().top;
    var sy = Math.max(0, raw);

    /* panX is delayed by panDelay (hold phase) and scaled by PAN_SPEED
       so the pan moves slower than 1:1 with scroll.                  */
    var panX = clamp((sy - panDelay) * PAN_SPEED, 0, panDur);

    track.style.transform = 'translateX(' + -panX + 'px)';
    linesBg.style.transform = 'translateX(' + (initialLeft - panX) + 'px)';

    /* strokePanX starts a full VH before sy=0 (when dark section first
       appears at the bottom of the viewport), so lines can begin drawing
       as soon as the section comes into view.                           */
    var strokePanX = Math.max(0, raw + window.innerHeight);
    updateStrokes(strokePanX);

    /* Trigger text when lines are ~50% through the hold phase.
       Adjust the 0.5 multiplier to fire earlier (lower) or later (higher). */
    if (!darkTextTriggered && darkText && !prefersReducedMotion) {
      var holdTotal = window.innerHeight + panDelay;
      if (strokePanX >= holdTotal * 0.5) {
        darkTextTriggered = true;
        darkText.classList.add('is-revealed');
      }
    }

    /* Reveal each story card at its pre-computed trigger threshold */
    for (var ci = 0; ci < storyCards.length; ci++) {
      if (!cardRevealed[ci] && cardTriggerPanX[ci] !== undefined && panX >= cardTriggerPanX[ci]) {
        cardRevealed[ci] = true;
        revealCard(storyCards[ci]);
      }
    }
  }

  /* ── Tab guard ────────────────────────────────────────────
     All card CTAs are tabindex=-1 on desktop, so Tab never
     naturally reaches them and the browser never calls
     scrollIntoView on them.  These two handlers intercept Tab
     at the keyboard level and drive focusCard() instead.

     A) Document keydown (capture) — Tab arriving FROM OUTSIDE
        while the user is scrolled into the dark-section zone.
     B) Section keydown — Tab cycling between cards once one
        is already focused.                                    */

  /* A — Tab entering dark-section from outside */
  document.addEventListener(
    'keydown',
    function (e) {
      if (!active || e.key !== 'Tab') return;
      if (darkSection.contains(document.activeElement)) return; /* B handles this */
      if (!cardCenters.length) return;

      /* Only intercept when user is inside the dark-section scroll zone
       (sticky stage means section top ≤ 0 while user is inside it)  */
      var dsRect = darkSection.getBoundingClientRect();
      if (dsRect.top > 0 || dsRect.bottom <= 0) return;

      /* Find the card nearest to the current scroll position */
      var sy = Math.max(0, -dsRect.top);
      var curPanX = clamp((sy - panDelay) * PAN_SPEED, 0, panDur);
      var nearest = 0;
      var minDist = Infinity;
      for (var i = 0; i < cardCenters.length; i++) {
        var d = Math.abs(cardCenters[i] - curPanX);
        if (d < minDist) {
          minDist = d;
          nearest = i;
        }
      }

      e.preventDefault();
      focusCard(nearest);
    },
    true /* capture — fires before browser moves focus */,
  );

  /* B — Tab between cards while focus is inside dark-section */
  darkSection.addEventListener('keydown', function (e) {
    if (!active || e.key !== 'Tab') return;
    if (focusedCardIdx === -1) return; /* not on a card CTA */

    var next = e.shiftKey ? focusedCardIdx - 1 : focusedCardIdx + 1;

    if (next < 0 || next >= cardCenters.length) {
      /* Tab out of the section — let the browser move focus naturally */
      focusedCardIdx = -1;
      return;
    }

    e.preventDefault();
    focusCard(next);
  });

  /* When focus leaves dark-section entirely, reset state and
     restore the sentinel so it can be Tab-reached next time.  */
  darkSection.addEventListener('focusout', function (e) {
    if (!darkSection.contains(e.relatedTarget)) {
      focusedCardIdx = -1;
      if (sentinel) sentinel.tabIndex = 0;
    }
  });

  /* ── Listeners — always attached ───────────────────────── */
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Card line SVGs are injected by js/story-lines.js — wait for them
     before measuring anything. */
  var linesReady = window.storyLinesReady || Promise.resolve();
  var linesLoaded = false;
  linesReady.then(function () {
    linesLoaded = true;
  });

  window.addEventListener('resize', function () {
    if (!linesLoaded) return; /* the initial setup below will run init() */
    if (window.innerWidth <= 1024 || prefersReducedMotion) {
      if (active) {
        teardown();
        active = false;
      }
      return;
    }
    active = true;
    init();
    onScroll();
  });

  /* ── Initial setup ──────────────────────────────────────────
     The desktop scroll-jack pan is itself the motion effect the
     reduced-motion preference exists to remove, so reduced-motion
     users get the same stacked mobile layout regardless of viewport
     width (see the matching CSS media query in styles.css).       */
  linesReady.then(function () {
    if (window.innerWidth > 1024 && !prefersReducedMotion) {
      active = true;
      init();
      onScroll();
    }
  });

  /* The webfont and images can change the card text height after init,
     which nudges the photos (and their line tiles) up or down.  Re-align
     the tiles to the logo line once everything has loaded.            */
  function realignTiles() {
    if (active) alignTilesToLogo(document.getElementById('home-lines-svg'));
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(realignTiles);
  window.addEventListener('load', realignTiles);

  /* Text trigger is handled inside onScroll() via darkTextTriggered flag */
})();

/* ============================================================
   STATS  —  Red line draw-on
   Uses the same strokeDashoffset draw-front technique as the
   story lines, but driven vertically.  The drawing tip tracks
   the viewport centre as it descends through the canvas:

     fraction = 0  when viewport centre is at the canvas top
     fraction = 1  when viewport centre is at the canvas bottom

   This keeps the drawing tip roughly centred in the viewport
   throughout the scroll, matching the feel of the story lines.
   ============================================================ */
(function () {
  'use strict';

  var svg = document.getElementById('stats-lines-svg');
  var canvas = document.querySelector('.stats__canvas');
  if (!svg || !canvas) return;

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var SVG_W = 685;
  var SVG_H = 1200;

  /* ---- Tuning ----
     LINE_SPEED controls how quickly the lines draw relative to scroll.
     1.0 = animation spans the full canvas height.
     2.0 = draws twice as fast (finishes halfway through the canvas).
     Try values between 1.5 and 3.0. */
  var LINE_SPEED = 1.7;

  /* ── Boxes fit their numbers ───────────────────────────────────────
     The red line is one zig-zag route; three stretches of it form a box
     around each number.  The route is rebuilt from where each number
     actually sits, so every box fits its own number.  Coordinates are in
     the boxes' own flat (untilted) space — SVG units rotated by --tilt.

     Spacing around each number (matches the original artwork):
       PAD_LEFT / PAD_RIGHT  — left / right of the number
       PAD_TOP / PAD_BOTTOM  — above / below it
     ROUTE — the fixed distances of the connecting lines (see buildRoute). */
  var TILT = (14.5 * Math.PI) / 180;
  var PAD_LEFT = [17, 14, 18];
  var PAD_RIGHT = 22;
  var PAD_TOP = [3, 5, 3];
  var PAD_BOTTOM = [3, 1, 3];
  var ROUTE = {
    leadIn: 45, /* line comes down this far above box 1 */
    overhang: 69, /* box 1's top runs on past its right edge, then drops */
    overhang2: 40, /* …and always clears box 2's right edge by at least this */
    channel: 46, /* that drop turns left this far above box 2 */
    outer: 61, /* the long drop on the left sits this far left of box 3 */
    tail: 251, /* the last line turns right this far below box 3 */
    spiralX: 281, /* where the end spiral sits */
  };
  var HALF = 6; /* half the stroke width — segments overlap by this at corners */

  var ux = Math.cos(TILT);
  var uy = -Math.sin(TILT);
  var vx = Math.sin(TILT);
  var vy = Math.cos(TILT);

  /* flat box space ↔ SVG units */
  function toSvg(p) {
    return [p[0] * ux + p[1] * vx, p[0] * uy + p[1] * vy];
  }
  function toFlat(p) {
    return [p[0] * ux + p[1] * uy, p[0] * vx + p[1] * vy];
  }

  /* Each number's box in flat space.  Items are rotated about their own
     centre, which in flat space is just an offset (rotation is the same). */
  function numberBoxes() {
    var scale = canvas.clientWidth / SVG_W;
    function offset(el) {
      var x = 0;
      var y = 0;
      while (el && el !== canvas) {
        x += el.offsetLeft;
        y += el.offsetTop;
        el = el.offsetParent;
      }
      return [x / scale, y / scale];
    }
    return Array.from(canvas.querySelectorAll('.stats__item')).map(function (item) {
      var io = offset(item);
      var c = [io[0] + item.offsetWidth / scale / 2, io[1] + item.offsetHeight / scale / 2];
      var fc = toFlat(c);
      var dx = fc[0] - c[0];
      var dy = fc[1] - c[1];
      var num = item.querySelector('.stats__number');
      var o = offset(num);
      return [o[0] + dx, o[1] + dy, o[0] + num.offsetWidth / scale + dx, o[1] + num.offsetHeight / scale + dy];
    });
  }

  /* The route as 16 straight segments (sp1–sp16, in draw order) plus where
     the spiral (sp17) starts. */
  function buildRoute(n) {
    var L1 = n[0][0] - PAD_LEFT[0], T1 = n[0][1] - PAD_TOP[0], R1 = n[0][2] + PAD_RIGHT, B1 = n[0][3] + PAD_BOTTOM[0];
    var L2 = n[1][0] - PAD_LEFT[1], T2 = n[1][1] - PAD_TOP[1], R2 = n[1][2] + PAD_RIGHT, B2 = n[1][3] + PAD_BOTTOM[1];
    var L3 = n[2][0] - PAD_LEFT[2], T3 = n[2][1] - PAD_TOP[2], R3 = n[2][2] + PAD_RIGHT, B3 = n[2][3] + PAD_BOTTOM[2];
    var D = Math.max(R1 + ROUTE.overhang, R2 + ROUTE.overhang2);
    var C2 = T2 - ROUTE.channel;
    var O3 = L3 - ROUTE.outer;
    var E = B3 + ROUTE.tail;
    var S = Math.max(ROUTE.spiralX, R3 + ROUTE.overhang2);
    /* Each segment runs HALF past its corners so joins are filled */
    var segs = [
      [[R1, T1 - ROUTE.leadIn], [R1, B1 + HALF]], /* 1  down into box 1 (its right side) */
      [[R1 + HALF, B1], [L1 - HALF, B1]], /*         2  box 1 bottom */
      [[L1, B1 + HALF], [L1, T1 - HALF]], /*         3  box 1 left */
      [[L1 - HALF, T1], [D + HALF, T1]], /*          4  box 1 top, running on */
      [[D, T1 - HALF], [D, C2 + HALF]], /*           5  drop past box 1 */
      [[D + HALF, C2], [L2 - HALF, C2]], /*          6  across above box 2 */
      [[L2, C2 - HALF], [L2, B2 + HALF]], /*         7  box 2 left */
      [[L2 - HALF, B2], [R2 + HALF, B2]], /*         8  box 2 bottom */
      [[R2, B2 + HALF], [R2, T2 - HALF]], /*         9  box 2 right */
      [[R2 + HALF, T2], [O3 - HALF, T2]], /*        10  box 2 top, running left */
      [[O3, T2 - HALF], [O3, B3 + HALF]], /*        11  the long drop on the left */
      [[O3 - HALF, B3], [R3 + HALF, B3]], /*        12  box 3 bottom */
      [[R3, B3 + HALF], [R3, T3 - HALF]], /*        13  box 3 right */
      [[R3 + HALF, T3], [L3 - HALF, T3]], /*        14  box 3 top */
      [[L3, T3 - HALF], [L3, E + HALF]], /*         15  box 3 left, then down */
      [[L3 - HALF, E], [S, E]], /*                  16  along to the spiral (which overlaps its end) */
    ];
    return { segs: segs, spiralStart: [S, E] };
  }

  /* The spiral keeps its shape; it's moved so it starts where line 16 ends */
  var spiralEl = document.getElementById('sp17');
  var spiralFlat = null;
  if (spiralEl) {
    var nums = spiralEl.getAttribute('d').match(/-?\d*\.?\d+/g).map(Number);
    spiralFlat = [];
    for (var si = 0; si < nums.length; si += 2) spiralFlat.push(toFlat([nums[si], nums[si + 1]]));
  }

  function d(points) {
    return points
      .map(function (p, i) {
        var q = toSvg(p);
        return (i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2);
      })
      .join('');
  }

  function layout() {
    var boxes = numberBoxes();
    if (boxes.length !== 3) return;
    var route = buildRoute(boxes);
    route.segs.forEach(function (seg, i) {
      var el = document.getElementById('sp' + (i + 1));
      if (el) el.setAttribute('d', d(seg));
    });
    if (spiralEl && spiralFlat) {
      /* Place the spiral so its first (downward) stroke forms a clean corner
         with the end of line 16: its right edge flush with the line's end
         and its top flush with the line's top — no lip */
      var dx = route.spiralStart[0] - HALF - spiralFlat[0][0];
      var dy = route.spiralStart[1] - HALF - spiralFlat[0][1];
      spiralEl.setAttribute(
        'd',
        d(spiralFlat.map(function (p) { return [p[0] + dx, p[1] + dy]; })),
      );
    }
  }

  svg.setAttribute('overflow', 'visible'); /* long numbers may push lines past the canvas */

  /* Reduced motion: lines fully drawn, numbers shown straight away (they are
     hidden in CSS until .is-revealed is added). */
  if (prefersReducedMotion) {
    layout();
    ['stat-num-1', 'stat-num-2', 'stat-num-3'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('is-revealed');
    });
    window.addEventListener('resize', layout, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
    return;
  }

  /* 17 individual paths in draw order (sp1 = first drawn, sp17 = last).
     triggerEl fires its stat number the first time that path hits fraction=1.
       box 1 → sp4  completes (its top)
       box 2 → sp10 completes (its top)
       box 3 → sp15 completes (its left side)                          */
  var paths = [
    { id: 'sp1' },
    { id: 'sp2' },
    { id: 'sp3' },
    { id: 'sp4', triggerEl: document.getElementById('stat-num-1') },
    { id: 'sp5' },
    { id: 'sp6' },
    { id: 'sp7' },
    { id: 'sp8' },
    { id: 'sp9' },
    { id: 'sp10', triggerEl: document.getElementById('stat-num-2') },
    { id: 'sp11' },
    { id: 'sp12' },
    { id: 'sp13' },
    { id: 'sp14' },
    { id: 'sp15', triggerEl: document.getElementById('stat-num-3') },
    { id: 'sp16' },
    { id: 'sp17' },
  ].map(function (p) {
    p.el = document.getElementById(p.id);
    p.triggered = false;
    return p;
  });

  /* Rebuild the route, then measure lengths and assign sequential yStart/yEnd. */
  function measure() {
    layout();
    var totalLen = 0;
    paths.forEach(function (p) {
      p.len = p.el ? p.el.getTotalLength() : 0;
      totalLen += p.len;
    });
    var cursor = 0;
    paths.forEach(function (p) {
      p.yStart = cursor;
      cursor += (p.len / totalLen) * SVG_H;
      p.yEnd = cursor;
      if (p.el) p.el.style.strokeDasharray = p.len;
    });
    update();
  }

  function update() {
    var cRect = canvas.getBoundingClientRect();
    var VH = window.innerHeight;
    var scale = cRect.height / SVG_H;
    /* SVG y-coordinate currently at the viewport centre, scaled by LINE_SPEED */
    var revealY = ((VH / 2 - cRect.top) / scale) * LINE_SPEED;

    paths.forEach(function (p) {
      if (!p.el) return;
      var frac = Math.max(0, Math.min(1, (revealY - p.yStart) / (p.yEnd - p.yStart)));
      p.el.style.strokeDashoffset = p.len * (1 - frac);

      if (!p.triggered && frac >= 1 && p.triggerEl) {
        p.triggered = true;
        p.triggerEl.classList.add('is-revealed');
      }
    });
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  measure();
  /* Number widths depend on the web font — rebuild once it's loaded */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
})();

/* ============================================================
   DONATE CTA  —  Donate lines + "Now it's / your turn" reveal
   Lines draw sequentially (time-based, not scroll-driven).
   Text and button reveal once all lines complete.
   ============================================================ */
(function () {
  'use strict';

  /* Reduced motion: lines stay fully drawn; reveal heading and button
     immediately (both are hidden in CSS until .is-revealed is added). */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.footer-cta__canvas').forEach(function (canvas) {
      var heading = canvas.querySelector('.site-footer__cta-heading');
      var btn = canvas.querySelector('.btn');
      if (heading) heading.classList.add('is-revealed');
      if (btn) btn.classList.add('is-revealed');
    });
    return;
  }

  var DURATION = 1500; /* ms — total time for all lines to draw */

  function initCanvas(canvas) {
    var heading = canvas.querySelector('.site-footer__cta-heading');
    var btn = canvas.querySelector('.btn');
    if (!heading || !btn) return;

    var paths = Array.prototype.slice
      .call(canvas.querySelectorAll('.footer-cta__lines path'))
      .map(function (el) {
        return { el: el };
      });

    var totalLen = 0;
    paths.forEach(function (p) {
      p.len = p.el.getTotalLength();
      totalLen += p.len;
      p.el.style.strokeDasharray = p.len;
      p.el.style.strokeDashoffset = p.len;
    });

    var cursor = 0;
    paths.forEach(function (p) {
      p.tStart = cursor;
      cursor += p.len / totalLen;
      p.tEnd = cursor;
    });

    var startTime = null;
    var done = false;

    function animate(timestamp) {
      if (!startTime) startTime = timestamp;
      var t = Math.min(1, (timestamp - startTime) / DURATION);

      paths.forEach(function (p) {
        var frac = Math.max(0, Math.min(1, (t - p.tStart) / (p.tEnd - p.tStart)));
        p.el.style.strokeDashoffset = p.len * (1 - frac);
      });

      if (t < 1) {
        requestAnimationFrame(animate);
      } else if (!done) {
        done = true;
        heading.classList.add('is-revealed');
        btn.classList.add('is-revealed');
      }
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            observer.unobserve(canvas);
            requestAnimationFrame(animate);
          }
        });
      },
      { rootMargin: '-25% 0px -25% 0px', threshold: 0 },
    );

    observer.observe(canvas);
  }

  document.querySelectorAll('.footer-cta__canvas').forEach(initCanvas);
})();

/* ============================================================
   PROMO  —  "Beyond / the Stories" heading reveal
   Fires the char-rise animation when the promo title enters
   the viewport, with "Beyond" first then "the Stories".
   ============================================================ */
(function () {
  'use strict';

  var title = document.querySelector('.promo__title');
  if (!title) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    title.classList.add('is-revealed');
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          title.classList.add('is-revealed');
          observer.unobserve(title);
        }
      });
    },
    { rootMargin: '-20% 0px -20% 0px', threshold: 0 },
  );

  observer.observe(title);
})();

/* ============================================================
   MOBILE LINES — scroll-driven strokeDashoffset
   Mirrors the desktop dark-section line animation but driven
   vertically.  Each path draws as the viewport centre reaches
   its y-position, measured in the 375-wide mobile SVG units of
   the logo SVG (home-lines-mobile-svg).

   Each story card carries its own 375×740 tiles (injected by
   js/story-lines.js).  Their y offset from the logo SVG is
   re-measured on every update, so cards of any height — or any
   number of cards — stay in sync.

   reverse flag — paths that start at the BOTTOM of their bbox
   use the RTL dash trick to reveal top-down instead of
   bottom-up (same approach as desktop RTL paths).

   Active only on ≤1024px (or reduced motion); tears down on
   resize to desktop.
   ============================================================ */
(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var svgTop = document.getElementById('home-lines-mobile-svg');
  var mobileText = document.getElementById('dark-section-text-mobile');
  var track = document.getElementById('stories-track');
  if (!svgTop) return;

  /* SVG coordinate constants for the mobile text overlay.
     Derived from original fill path bounding box (x≈95–260, y≈487–650).
     Figma Mobile/H2: 36px, line-height 32px.
     All in SVG units — multiply by scale to get screen pixels. */
  var MOB_TEXT_LEFT = 109; /* SVG units — tune left/right */
  var MOB_TEXT_W = 145; /* SVG units — just wider than longest word */
  var MOB_TEXT_TOP = 480; /* SVG units — top of text block */
  var MOB_TEXT_FONT = 36; /* SVG units — Figma Mobile/H2  */

  var SVG_W = 375;

  /* LOGO_EXIT_Y — where the logo's line leaves the logo SVG
     (mobile-home-lines.svg).  The first card's lead-in is stretched up
     to meet it.                                                       */
  var LOGO_EXIT_Y = 700;

  /* ── Tuning ──────────────────────────────────────────────────
     MOBILE_LINE_SPEED — increase to draw faster (default 1.0).
     MIN_WINDOW        — minimum y draw-window for flat paths.  */
  var MOBILE_LINE_SPEED = 1.0;
  var MIN_WINDOW = 60;

  var paths = [];
  var active = false;
  var initialised = false;

  var container = document.getElementById('lines-mobile-top');

  function cardSvgs() {
    return track ? Array.from(track.querySelectorAll('.story-lines--mobile')) : [];
  }

  function scaleOf() {
    return svgTop.getBoundingClientRect().width / SVG_W;
  }

  /* Stretch the first card's lead-in up to the logo's exit line.  Other
     cards keep their tile's own lead-in, which starts a fixed distance
     above the photo (i.e. in the gap below the previous card). */
  function stretchFirstLeadIn() {
    var first = track && track.querySelector('.story-lines--mobile.story-lines--under');
    var lead = first && first.querySelector('[data-lead="end"]');
    if (!lead) return;
    var sc = scaleOf();
    if (!sc) return;
    var exitY = svgTop.getBoundingClientRect().top + LOGO_EXIT_Y * sc;
    var startY = (exitY - first.getBoundingClientRect().top) / sc;
    lead.setAttribute('d', lead.getAttribute('data-d').replace(/V\s*0\s*$/, 'V' + startY.toFixed(2)));
  }

  function positionText() {
    if (!mobileText) return;
    var sc = scaleOf();
    mobileText.style.display = 'block';
    mobileText.style.top = MOB_TEXT_TOP * sc + 'px';
    mobileText.style.left = MOB_TEXT_LEFT * sc + 'px';
    mobileText.style.width = MOB_TEXT_W * sc + 'px';
    mobileText.style.fontSize = MOB_TEXT_FONT * sc + 'px';
  }

  function init() {
    paths = [];
    stretchFirstLeadIn();

    [svgTop].concat(cardSvgs()).forEach(function (svg) {
      var isLogo = svg === svgTop;
      var els = svg.querySelectorAll('path[stroke]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var bbox = el.getBBox();
        var len = el.getTotalLength();
        var startY = el.getPointAtLength(0).y;
        var centerY = bbox.y + bbox.height / 2;

        /* Logo entry lines (bboxY < 50) are complex multi-subpath paths
           that include both the downstroke from y=0 AND logo connectors.
           Their first subpath happens to start low, which would trigger
           reverse incorrectly — exclude them.
           Card paths that start at the bottom of their bbox (the lead-in
           paths, drawn maze → top) need reverse to draw top-down. */
        var isEntryLine = isLogo && bbox.y < 50;
        var reverse = !isEntryLine && startY > centerY + 10;

        el.style.strokeDasharray = len;
        el.style.strokeDashoffset = len; /* fully hidden */

        paths.push({
          el: el,
          svg: isLogo ? null : svg,
          len: len,
          yStart: bbox.y,
          yEnd: Math.max(bbox.y + bbox.height, bbox.y + MIN_WINDOW),
          reverse: reverse,
        });
      }
    });

    /* Show the SVGs — dashoffsets already set, no flash */
    if (container) container.style.opacity = '1';
    cardSvgs().forEach(function (svg) {
      svg.classList.add('is-ready');
    });

    positionText();
    initialised = true;

    if (prefersReducedMotion) {
      /* Reduced motion: show the line art fully drawn and the heading
         revealed immediately — no scroll-driven progressive draw. */
      paths.forEach(function (p) {
        p.el.style.strokeDasharray = '';
        p.el.style.strokeDashoffset = '';
      });
      if (mobileText) mobileText.classList.add('is-revealed');
      active = false;
      return;
    }

    active = paths.length > 0;
    update();
  }

  function teardown() {
    active = false;
    initialised = false;
    paths.forEach(function (p) {
      p.el.style.strokeDasharray = '';
      p.el.style.strokeDashoffset = '';
    });
    paths = [];
    if (container) container.style.opacity = '';
    cardSvgs().forEach(function (svg) {
      svg.classList.remove('is-ready');
    });
    if (mobileText) {
      mobileText.style.display = '';
      mobileText.classList.remove('is-revealed');
    }
  }

  function update() {
    if (!active) return;
    var rect = svgTop.getBoundingClientRect();
    var VH = window.innerHeight;
    var scale = rect.width / SVG_W;
    if (!scale) return;

    /* Viewport-centre formula — same as stats section.
       revealY = 0 when SVG enters from below (rect.top = VH),
       advances with scroll so drawing tracks the screen centre. */
    var revealY = Math.max(0, (VH / 2 - rect.top) / scale) * MOBILE_LINE_SPEED;

    /* Trigger mobile text when the logo area centre hits viewport centre */
    if (mobileText && !mobileText.classList.contains('is-revealed')) {
      if (revealY >= MOB_TEXT_TOP + MOB_TEXT_FONT) {
        mobileText.classList.add('is-revealed');
      }
    }

    /* Each card tile's offset from the logo SVG, in logo SVG units */
    var offsets = new Map();
    cardSvgs().forEach(function (svg) {
      offsets.set(svg, (svg.getBoundingClientRect().top - rect.top) / scale);
    });

    paths.forEach(function (p) {
      var off = p.svg ? offsets.get(p.svg) : 0;
      var yStart = p.yStart + off;
      var yEnd = p.yEnd + off;
      var frac = Math.max(0, Math.min(1, (revealY - yStart) / (yEnd - yStart)));
      var visLen = p.len * frac;
      var invLen = p.len - visLen;

      if (p.reverse) {
        /* Reveal the physical TOP portion first (parametric tail) */
        p.el.style.strokeDasharray = '0,' + invLen + ',' + visLen + ',99999';
        p.el.style.strokeDashoffset = 0;
      } else {
        /* Normal top-down draw from parametric start */
        p.el.style.strokeDasharray = p.len;
        p.el.style.strokeDashoffset = invLen;
      }
    });
  }

  var linesLoaded = false;

  window.addEventListener(
    'resize',
    function () {
      if (!linesLoaded) return;
      if (window.innerWidth <= 1024 || prefersReducedMotion) {
        /* Defer until after layout so getBoundingClientRect is accurate */
        requestAnimationFrame(function () {
          /* (Re)initialise — layout may have shifted, so the first lead-in,
             path lengths and text position are all re-measured. */
          init();
        });
      } else if (initialised) {
        teardown();
      }
    },
    { passive: true },
  );

  window.addEventListener('scroll', update, { passive: true });

  /* Card line SVGs are injected by js/story-lines.js — wait for them */
  (window.storyLinesReady || Promise.resolve()).then(function () {
    linesLoaded = true;
    if (window.innerWidth <= 1024 || prefersReducedMotion) {
      requestAnimationFrame(init);
    }
  });

  /* Layout settles once the webfont and images load — re-measure the first
     lead-in and path positions then. */
  function reinitIfMobile() {
    if (linesLoaded && (window.innerWidth <= 1024 || prefersReducedMotion)) init();
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reinitIfMobile);
  window.addEventListener('load', reinitIfMobile);
})();
