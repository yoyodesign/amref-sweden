/* ============================================================
   AMREF — Story title frame (stretches to fit any title)

   The maze frame around a story page's title is built from three
   fixed pieces (assets/svgs/title-left.svg, title-step.svg,
   title-right.svg, bundled in js/story-patterns.js) with straight
   "zone" lines drawn between them:

     [ left ]—— zone 1 ——[ step ]—— zone 2 ——[ right ]

     zone 1  stretches to the width of title line 1, so the step (where
             the top edge drops down to line 2) sits just after line 1.
     zone 2  stretches by however much longer line 2 is, so the right
             piece sits just after the second line.

   Each zone line runs from a line end ("stub") on one piece's edge to
   the matching stub on the next piece, so the pieces only need their
   lines to leave/enter at matching heights.

   Opt in by adding .story-hero__art--fit to .story-hero__art and a
   .title-frame wrapper around .story-hero__text (see Coumba's page).
   Colour comes from --story-accent.  Works at any breakpoint — the frame
   is sized from the heading's font size, and shrinks the title if it
   would run past the hero.
   ============================================================ */
(function () {
  'use strict';

  var art = document.querySelector('.story-hero__art--fit');
  var frame = art && art.querySelector('.title-frame');
  var text = frame && frame.querySelector('.story-hero__text');
  var heading = text && text.querySelector('.story-hero__heading');
  var subtitle = text && text.querySelector('.story-hero__subtitle');
  var bundle = window.STORY_PATTERNS || {};
  if (!heading || !bundle['title-left.svg']) return;

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Layout constants (frame units — the pieces' own SVG units) ──────
     Measured from the original hand-placed hero so the default title
     sits exactly where it did.                                         */
  var ANGLE = -14.5; /* tilt, degrees */
  var FONT_UNITS = 78.4; /* heading font size in frame units */
  var INNER_CORNER = [132, 56]; /* inner top-left corner of the left piece */
  var TEXT_ORIGIN = [151.5, 74.1]; /* where the heading's top-left sits */
  var STEP_AFTER_LINE1 = 9; /* step piece starts this far past line 1 */
  var RIGHT_AFTER_LINE2 = -10; /* right piece starts this far past line 2 */
  var POLE_X = 41; /* the right piece's vertical line, from its left edge */
  var MIN_ZONE = 24; /* zone lines are never shorter than this, so pieces never
                        butt straight onto each other (that leaves hairline seams) */
  var SUBTITLE_INSET = 15; /* subtitle ends this far before the pole */
  var SUBTITLE_Y = 271.9; /* subtitle top */
  var EDGE_TOL = 1.5; /* how close to a piece edge a line end must be */
  var MATCH_TOL = 4; /* max height difference when pairing line ends */
  var JOIN_OVERLAP = 1.5; /* zone lines run this far into each piece, hiding seams */
  var TOP_MARGIN = 0; /* px the frame may come to the top of the hero art */
  var TOP_CORNER = [56, 26]; /* the right piece's outer top-right corner — the
                                frame's highest point, kept inside the hero */

  /* Where the inner corner sits in the hero art, as a fraction of its size
     (desktop / mobile ≤540px — matches the original artwork). */
  var ANCHOR_DESKTOP = [273 / 992, 168.3 / 1257];
  var ANCHOR_MOBILE = [60.25 / 303, 80.14 / 544];

  /* Draw-in: one continuous line traced from the top of the pole round the
     frame, like the original artwork (300 units/s, eased out).          */
  var DRAW_SPEED = 600; /* frame units per second (original artwork: 300) — higher = faster */
  var DRAW_DELAY = 150; /* ms before the line starts */
  var JOIN_TOL = 7; /* how close a line end must be to another line to chain on */

  /* Line down the page: the pole drops from the frame, jogs across to the
     middle of the hero video, runs down behind it and comes out below into
     the tail piece (title-tail.svg).
     JOG_AT            — where the jog happens, between the frame (0) and the
                         top of the video (1)
     TAIL_CORNER_BELOW — px below the video's bottom edge for the tail's corner
     VIDEO_CLIP_BOTTOM — the video's clip-path lifts its bottom edge by this
                         much of its height (average across its width)  */
  var JOG_AT = 0.5;
  var TAIL_CORNER_BELOW = 28;
  var VIDEO_CLIP_BOTTOM = 0.0135;
  var HALF_STROKE = 6;

  /* ── Pieces ─────────────────────────────────────────────────────────── */
  function parsePiece(file) {
    var doc = new DOMParser().parseFromString(bundle[file], 'image/svg+xml');
    var svg = doc.documentElement;
    var vb = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
    var w = vb[2];
    var stubs = { left: [], right: [] };

    /* Collect line ends that touch the piece's left/right edges.  Figma
       exports absolute M/L/H/V commands, which is all this needs. */
    svg.querySelectorAll('path').forEach(function (p) {
      var tokens = p.getAttribute('d').match(/[MLHVZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
      var x = 0;
      var y = 0;
      var cmd = '';
      var pts = [];
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (/^[MLHVZ]$/i.test(t)) {
          cmd = t.toUpperCase();
          continue;
        }
        if (cmd === 'H') x = parseFloat(t);
        else if (cmd === 'V') y = parseFloat(t);
        else if (cmd === 'M' || cmd === 'L') {
          x = parseFloat(t);
          y = parseFloat(tokens[++i]);
        }
        pts.push([x, y]);
      }
      pts.forEach(function (pt) {
        if (Math.abs(pt[0]) <= EDGE_TOL) addStub(stubs.left, pt[1]);
        if (Math.abs(pt[0] - w) <= EDGE_TOL) addStub(stubs.right, pt[1]);
      });
    });

    return { svg: svg, width: w, height: vb[3], stubs: stubs };
  }

  function addStub(list, y) {
    for (var i = 0; i < list.length; i++) if (Math.abs(list[i] - y) < 0.5) return;
    list.push(y);
  }

  var LEFT = parsePiece('title-left.svg');
  var STEP = parsePiece('title-step.svg');
  var RIGHT = parsePiece('title-right.svg');
  var TAIL = bundle['title-tail.svg'] ? parsePiece('title-tail.svg') : null;
  var HEIGHT = LEFT.height;

  /* ── Build ──────────────────────────────────────────────────────────── */
  var NS = 'http://www.w3.org/2000/svg';
  var linesSvg = null;
  var drawn = false;

  function lineWidthEm(line) {
    var chars = line.querySelectorAll('.char');
    if (!chars.length) return 0;
    var first = chars[0];
    var last = chars[chars.length - 1];
    return (last.offsetLeft + last.offsetWidth - first.offsetLeft) / parseFloat(getComputedStyle(heading).fontSize);
  }

  function pieceGroup(piece, x, y) {
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', 'translate(' + x + ' ' + (y || 0) + ')');
    Array.prototype.forEach.call(piece.svg.childNodes, function (n) {
      g.appendChild(document.importNode(n, true));
    });
    return g;
  }

  /* Zone lines: pair each stub on piece A's right edge with the nearest
     stub on piece B's left edge.  Slightly different heights are joined
     with a gently sloped line so there's no visible step. */
  function zoneLines(fromStubs, x1, toStubs, x2) {
    var out = [];
    if (x2 - x1 < 0.5) return out;
    fromStubs.forEach(function (y1) {
      var best = null;
      toStubs.forEach(function (y2) {
        if (Math.abs(y2 - y1) <= MATCH_TOL && (best === null || Math.abs(y2 - y1) < Math.abs(best - y1))) best = y2;
      });
      if (best === null) return;
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M' + (x1 - JOIN_OVERLAP) + ' ' + y1 + 'L' + (x2 + JOIN_OVERLAP) + ' ' + best);
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '12');
      out.push(p);
    });
    return out;
  }

  function build() {
    var mobile = window.matchMedia('(max-width: 540px)').matches;
    var anchor = mobile ? ANCHOR_MOBILE : ANCHOR_DESKTOP;

    /* Font size from CSS (clear any shrink from a previous build first) */
    heading.style.fontSize = '';
    if (subtitle) subtitle.style.fontSize = '';
    var cssFont = parseFloat(getComputedStyle(heading).fontSize);
    var cssSubFont = subtitle ? parseFloat(getComputedStyle(subtitle).fontSize) : 0;

    var lines = heading.querySelectorAll('.story-hero__heading-line');
    var l1 = lines[0] ? lineWidthEm(lines[0]) * FONT_UNITS : 0;
    var l2 = lines[1] ? lineWidthEm(lines[1]) * FONT_UNITS : 0;

    /* Piece positions (frame units) */
    var stepX = Math.max(LEFT.width + MIN_ZONE, TEXT_ORIGIN[0] + l1 + STEP_AFTER_LINE1);
    var rightX = Math.max(stepX + STEP.width + MIN_ZONE, TEXT_ORIGIN[0] + l2 + RIGHT_AFTER_LINE2);
    var width = rightX + RIGHT.width;

    /* Units → px, shrinking if the frame would run past the hero */
    var artW = art.clientWidth;
    var artH = art.clientHeight;
    var rad = (ANGLE * Math.PI) / 180;
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    var u = cssFont / FONT_UNITS;
    var cx = INNER_CORNER[0] * cos - INNER_CORNER[1] * sin;
    var cy = INNER_CORNER[0] * sin + INNER_CORNER[1] * cos;
    /* Long titles: keep the frame inside the art's right edge (bottom-right
       corner) and top edge (the top-right corner rises with the tilt). */
    var topX = rightX + TOP_CORNER[0];
    var maxRight = ((1 - anchor[0]) * artW) / (width * cos - HEIGHT * sin - cx);
    var maxTop = (anchor[1] * artH - TOP_MARGIN) / (cy - (topX * sin + TOP_CORNER[1] * cos));
    u = Math.min(u, maxRight, maxTop);
    var shrink = u / (cssFont / FONT_UNITS);
    if (shrink < 1) {
      heading.style.fontSize = cssFont * shrink + 'px';
      if (subtitle) subtitle.style.fontSize = cssSubFont * shrink + 'px';
    }

    /* Place the frame: rotate about its origin, then move it so the inner
       corner lands on the anchor point in the hero art. */
    var tx = anchor[0] * artW - cx * u;
    var ty = anchor[1] * artH - cy * u;
    frame.style.width = width * u + 'px';
    frame.style.height = HEIGHT * u + 'px';
    frame.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) rotate(' + ANGLE + 'deg)';

    /* Heading + subtitle */
    text.style.left = TEXT_ORIGIN[0] * u + 'px';
    text.style.top = TEXT_ORIGIN[1] * u + 'px';
    if (subtitle) {
      var subRight = rightX + POLE_X - SUBTITLE_INSET; /* frame units */
      subtitle.style.top = (SUBTITLE_Y - TEXT_ORIGIN[1]) * u + 'px';
      subtitle.style.left = 'auto';
      subtitle.style.right = text.offsetWidth - (subRight - TEXT_ORIGIN[0]) * u + 'px';
      /* Long subtitles wrap within the frame's width (right-aligned) */
      subtitle.style.maxWidth = subRight * u + 'px'; /* frame's left edge → subtitle end */
    }

    /* Lines */
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'title-frame__lines');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + HEIGHT);
    svg.setAttribute('width', width * u);
    svg.setAttribute('height', HEIGHT * u);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('overflow', 'visible');

    var groups = [
      [pieceGroup(LEFT, 0)],
      zoneLines(LEFT.stubs.right, LEFT.width, STEP.stubs.left, stepX),
      [pieceGroup(STEP, stepX)],
      zoneLines(STEP.stubs.right, stepX + STEP.width, RIGHT.stubs.left, rightX),
      [pieceGroup(RIGHT, rightX)],
    ];
    var offsets = [0, 0, stepX, 0, rightX]; /* zone lines are already absolute */
    groups.forEach(function (els, i) {
      els.forEach(function (el) {
        el.setAttribute('data-x', offsets[i]);
        svg.appendChild(el);
      });
    });
    svg.querySelectorAll('[stroke]').forEach(function (el) {
      el.setAttribute('stroke', 'currentColor');
    });
    var segs = splitSegments(svg);
    addTail(svg, segs, rightX, tx, ty, u, cos, sin);
    segments = chainRoute(segs);

    if (linesSvg) frame.replaceChild(svg, linesSvg);
    else frame.insertBefore(svg, frame.firstChild);
    linesSvg = svg;

    if (!drawn) {
      drawn = true;
      drawIn();
    }
    applyDraw();
    frame.classList.add('is-ready');
  }

  /* ── Route ──────────────────────────────────────────────────────────
     Every path is split into simple polylines (one per M…), so each can be
     drawn on its own.  They're then chained into one route: starting at the
     top of the pole, each polyline starts drawing when the line before it
     reaches its end, so the frame traces in as one continuous line.      */
  var segments = [];

  function polylines(d) {
    var tokens = d.match(/[MLHVZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
    var out = [];
    var cur = null;
    var x = 0;
    var y = 0;
    var cmd = '';
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (/^[MLHVZ]$/i.test(t)) {
        cmd = t.toUpperCase();
        if (cmd === 'Z' && cur) cur.push(cur[0].slice());
        continue;
      }
      if (cmd === 'H') x = parseFloat(t);
      else if (cmd === 'V') y = parseFloat(t);
      else {
        x = parseFloat(t);
        y = parseFloat(tokens[++i]);
      }
      if (cmd === 'M') {
        cur = [];
        out.push(cur);
        cmd = 'L'; /* further pairs after M are line-tos */
      }
      cur.push([x, y]);
    }
    return out.filter(function (pts) { return pts.length > 1; });
  }

  function splitSegments(root) {
    var segs = [];
    root.querySelectorAll('path').forEach(function (path) {
      var holder = path.closest('[data-x]');
      var ox = Number(holder.getAttribute('data-x'));
      var oy = Number(holder.getAttribute('data-y') || 0);
      polylines(path.getAttribute('d')).forEach(function (pts) {
        var p = path.cloneNode(false);
        p.setAttribute('d', 'M' + pts.join('L'));
        path.parentNode.insertBefore(p, path);
        segs.push({ el: p, local: pts, ox: ox, oy: oy, pts: pts.map(function (q) { return [q[0] + ox, q[1] + oy]; }) });
      });
      path.parentNode.removeChild(path);
    });
    return segs;
  }

  /* ── Line down the page ──────────────────────────────────────────────
     The right piece's pole carries on past the frame (clipped in the file).
     Unclip it and route it: down to the jog, across to the middle of the
     video, down behind the video, then into the tail piece.  Everything is
     in frame units; (tx, ty) and u place the frame in the hero art.     */
  function addTail(svg, segs, rightX, tx, ty, u, cos, sin) {
    var media = document.querySelector('.story-hero__media');
    if (!TAIL || !media) return;

    /* Frame units ↔ hero art px */
    function toArt(X, Y) {
      return [tx + (X * cos - Y * sin) * u, ty + (X * sin + Y * cos) * u];
    }
    function fromArt(x, y) {
      var dx = x - tx;
      var dy = y - ty;
      return [(dx * cos + dy * sin) / u, (-dx * sin + dy * cos) / u];
    }

    /* The pole: the line in the right piece that runs below the frame */
    var pole = null;
    var k = -1;
    segs.forEach(function (sg) {
      if (sg.ox !== rightX) return;
      sg.local.forEach(function (q, i) {
        if (q[1] > HEIGHT && i > 0) {
          pole = sg;
          k = i;
        }
      });
    });
    if (!pole) return;

    var artRect = art.getBoundingClientRect();
    var m = media.getBoundingClientRect();
    var vTop = m.top - artRect.top;
    var vBottom = m.bottom - m.height * VIDEO_CLIP_BOTTOM - artRect.top;
    var vCentre = m.left + m.width / 2 - artRect.left;

    /* 1. Jog height: between the bottom of the frame and the top of the video */
    var a = pole.pts[k - 1];
    var b = pole.pts[k];
    var pdx = b[0] - a[0];
    var pdy = b[1] - a[1];
    function poleAtArtY(y) {
      var t = ((y - ty) / u - (a[0] * sin + a[1] * cos)) / (pdx * sin + pdy * cos);
      return [a[0] + t * pdx, a[1] + t * pdy];
    }
    var frameBottom = toArt(a[0] + ((HEIGHT - a[1]) / pdy) * pdx, HEIGHT)[1];
    if (vTop <= frameBottom) return; /* no room above the video — keep the pole clipped */
    var jog = poleAtArtY(frameBottom + (vTop - frameBottom) * JOG_AT);

    /* 2. Where the line runs down: it enters the video at its horizontal centre */
    var downX = fromArt(vCentre, vTop)[0];

    /* 3. Tail: its top line end (title-tail.svg) is where the line from above
          joins; the next point down that line is its corner. */
    var join = null;
    var cornerY = 0;
    TAIL.svg.querySelectorAll('path').forEach(function (path) {
      polylines(path.getAttribute('d')).forEach(function (pts) {
        [0, pts.length - 1].forEach(function (i) {
          if (!join && pts[i][1] <= EDGE_TOL) {
            join = pts[i];
            cornerY = pts[i === 0 ? 1 : pts.length - 2][1];
          }
        });
      });
    });
    if (!join) return;
    /* Corner sits TAIL_CORNER_BELOW px under the video's bottom edge */
    var cornerFrameY = ((vBottom + TAIL_CORNER_BELOW - ty) / u - downX * sin) / cos;
    var tailX = downX - join[0];
    var tailY = cornerFrameY - cornerY;

    /* Unclip and cut the pole at the jog (half a stroke past, to fill the corner) */
    var clipped = pole.el.closest('[clip-path]');
    if (clipped) clipped.removeAttribute('clip-path');
    var end = [jog[0] + (HALF_STROKE / pdy) * pdx, jog[1] + HALF_STROKE];
    pole.pts[k] = end;
    pole.local[k] = [end[0] - pole.ox, end[1] - pole.oy];
    pole.el.setAttribute('d', 'M' + pole.local.join('L'));

    /* The jog across and the drop behind the video */
    var dir = downX < jog[0] ? -1 : 1;
    var run = document.createElementNS(NS, 'path');
    run.setAttribute(
      'd',
      'M' + (jog[0] - dir * HALF_STROKE) + ' ' + jog[1] +
        'L' + downX + ' ' + jog[1] +
        'L' + downX + ' ' + (tailY + join[1] + 1),
    );
    run.setAttribute('stroke', 'currentColor');
    run.setAttribute('stroke-width', '12');
    run.setAttribute('stroke-linejoin', 'miter');
    run.setAttribute('data-x', 0);
    svg.appendChild(run);

    var g = pieceGroup(TAIL, tailX, tailY);
    g.setAttribute('data-x', tailX);
    g.setAttribute('data-y', tailY);
    g.querySelectorAll('[stroke]').forEach(function (el) {
      el.setAttribute('stroke', 'currentColor');
    });
    svg.appendChild(g);

    [run, g].forEach(function (el) {
      splitSegments(el.tagName === 'path' ? wrap(el) : el).forEach(function (sg) {
        sg.tail = el === g; /* the tail draws separately, when it scrolls into view */
        segs.push(sg);
      });
    });
    tailEl = g;
  }

  /* splitSegments works on a container — give a lone path one */
  function wrap(el) {
    var g = document.createElementNS(NS, 'g');
    el.parentNode.insertBefore(g, el);
    g.appendChild(el);
    return g;
  }

  function lengths(pts) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    return cum;
  }

  /* Distance along a polyline to the point closest to q, and how far away it is */
  function project(seg, q) {
    var best = { gap: Infinity, along: 0 };
    for (var i = 1; i < seg.pts.length; i++) {
      var a = seg.pts[i - 1];
      var b = seg.pts[i];
      var dx = b[0] - a[0];
      var dy = b[1] - a[1];
      var l2 = dx * dx + dy * dy || 1;
      var t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
      var gap = Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]);
      if (gap < best.gap) best = { gap: gap, along: seg.cum[i - 1] + t * Math.sqrt(l2) };
    }
    return best;
  }

  function orient(seg, fromEnd) {
    if (fromEnd) {
      seg.pts.reverse();
      seg.local.reverse();
      seg.el.setAttribute('d', 'M' + seg.local.join('L'));
    }
    seg.cum = lengths(seg.pts);
    seg.len = seg.cum[seg.cum.length - 1];
  }

  function chainRoute(segs) {
    if (!segs.length) return segs;
    segs.forEach(function (sg) { sg.cum = lengths(sg.pts); sg.len = sg.cum[sg.cum.length - 1]; });

    /* Start at the highest line end — the top of the pole */
    var first = null;
    var fromEnd = false;
    segs.forEach(function (sg) {
      [0, sg.pts.length - 1].forEach(function (k) {
        var p = sg.pts[k];
        if (!first || p[1] < (fromEnd ? first.pts[first.pts.length - 1] : first.pts[0])[1]) {
          first = sg;
          fromEnd = k > 0;
        }
      });
    });

    var done = [];
    var todo = segs.slice();
    function schedule(sg, start, rev) {
      orient(sg, rev);
      sg.start = start;
      done.push(sg);
      todo.splice(todo.indexOf(sg), 1);
    }
    schedule(first, 0, fromEnd);

    /* Repeatedly take the not-yet-drawn line whose end touches the route
       soonest (Dijkstra-style); lines that touch nothing join wherever
       they're closest. */
    while (todo.length) {
      var pick = null;
      todo.forEach(function (sg) {
        [0, sg.pts.length - 1].forEach(function (k) {
          done.forEach(function (d) {
            var pr = project(d, sg.pts[k]);
            var at = d.start + pr.along;
            var touching = pr.gap <= JOIN_TOL;
            if (
              !pick ||
              (touching && !pick.touching) ||
              (touching === pick.touching && (touching ? at < pick.at : pr.gap < pick.gap))
            ) {
              pick = { sg: sg, at: at, rev: k > 0, touching: touching, gap: pr.gap };
            }
          });
        });
      });
      schedule(pick.sg, pick.at, pick.rev);
    }
    return segs;
  }

  /* ── Draw-in ──────────────────────────────────────────────────────────
     Two parts: the frame and the line down to the video draw on page load;
     the tail waits until it scrolls into view (TAIL_TRIGGER of the way up
     the screen), then carries the line on from under the video.          */
  var TAIL_TRIGGER = 0.85;
  var TAIL_MIN_MS = 500; /* the tail is short — don't let it flash in */
  var tailEl = null;
  var mainStart = null; /* performance.now() when the main draw began; null = finished */
  var mainEnd = 0;
  var tailState = 'off'; /* off (show) | waiting | drawing | done */
  var tailStart = 0;
  var ticking = false;

  function ease(t) {
    return 1 - (1 - t) * (1 - t); /* ease out, like GSAP power2.out */
  }

  function setVisible(sg, vis) {
    sg.el.style.strokeDasharray = sg.len + ' ' + sg.len;
    sg.el.style.strokeDashoffset = sg.len - vis;
  }
  function clearDash(sg) {
    sg.el.style.strokeDasharray = '';
    sg.el.style.strokeDashoffset = '';
  }

  /* Set each line's visible length for the current point in the animation */
  function applyDraw() {
    var now = performance.now();
    var main = segments.filter(function (sg) { return !sg.tail; });
    var tail = segments.filter(function (sg) { return sg.tail; });

    if (mainStart !== null) {
      var total = 0;
      main.forEach(function (sg) { total = Math.max(total, sg.start + sg.len); });
      var duration = (total / DRAW_SPEED) * 1000;
      mainEnd = mainStart + duration;
      var t = Math.max(0, Math.min(1, (now - mainStart) / duration));
      var front = total * ease(t);
      main.forEach(function (sg) { setVisible(sg, Math.max(0, Math.min(sg.len, front - sg.start))); });
      if (t >= 1) {
        mainStart = null;
        main.forEach(clearDash);
      }
    } else {
      main.forEach(clearDash);
    }

    if (tailState === 'waiting') {
      tail.forEach(function (sg) { setVisible(sg, 0); });
    } else if (tailState === 'drawing' && tail.length) {
      var from = Infinity;
      var to = 0;
      tail.forEach(function (sg) {
        from = Math.min(from, sg.start);
        to = Math.max(to, sg.start + sg.len);
      });
      var dur = Math.max(TAIL_MIN_MS, ((to - from) / DRAW_SPEED) * 1000);
      var t2 = Math.max(0, Math.min(1, (now - tailStart) / dur));
      var front2 = from + (to - from) * ease(t2);
      tail.forEach(function (sg) { setVisible(sg, Math.max(0, Math.min(sg.len, front2 - sg.start))); });
      if (t2 >= 1) {
        tailState = 'done';
        tail.forEach(clearDash);
      }
    } else {
      tail.forEach(clearDash);
    }
  }

  function animating() {
    return mainStart !== null || tailState === 'drawing';
  }

  function tick() {
    checkTail();
    applyDraw();
    if (animating()) requestAnimationFrame(tick);
    else ticking = false;
  }
  function startTicking() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(tick);
  }

  /* Start the tail once it's on screen (and the main line has reached it) */
  function checkTail() {
    if (tailState !== 'waiting' || !tailEl) return;
    if (tailEl.getBoundingClientRect().top < window.innerHeight * TAIL_TRIGGER) {
      tailState = 'drawing';
      tailStart = Math.max(performance.now(), mainStart !== null ? mainEnd : 0);
      startTicking();
    }
  }

  function drawIn() {
    if (prefersReducedMotion) return;
    mainStart = performance.now() + DRAW_DELAY;
    tailState = 'waiting';
    window.addEventListener('scroll', checkTail, { passive: true });
    startTicking();
  }

  /* Build once the web font is in (line widths depend on it), and again
     whenever the layout changes size. */
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 1500); })]).then(function () {
    build();
    if (window.ResizeObserver) {
      var last = art.clientWidth;
      new ResizeObserver(function () {
        if (art.clientWidth !== last) {
          last = art.clientWidth;
          build();
        }
      }).observe(art);
    }
    fontsReady.then(build);
  });
})();
