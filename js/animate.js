(function () {
  'use strict';

  /* ── Heading rollup (data-rollup / .rollup-text) ── */
  (function initHeadingRollup() {
    var targets = document.querySelectorAll('[data-rollup], .rollup-text');
    if (!targets.length) return;

    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function wrapWord(word, delayStart, delayStep, state) {
      var wordWrap = document.createElement('span');
      wordWrap.className = 'rollup-word';
      for (var i = 0; i < word.length; i++) {
        var wrap = document.createElement('span');
        wrap.className = 'char-wrap';
        var inner = document.createElement('span');
        inner.className = 'char';
        inner.textContent = word[i];
        inner.style.animationDelay = delayStart + state.charIndex * delayStep + 'ms';
        wrap.appendChild(inner);
        wordWrap.appendChild(wrap);
        state.charIndex += 1;
      }
      return wordWrap;
    }

    function wrapTextNodeChars(node, delayStart, delayStep, state) {
      var text = node.nodeValue || '';
      var frag = document.createDocumentFragment();
      var tokens = text.match(/\s+|\S+/g) || [];
      tokens.forEach(function (token) {
        if (/^\s+$/.test(token)) {
          frag.appendChild(document.createTextNode(token));
          return;
        }
        frag.appendChild(wrapWord(token, delayStart, delayStep, state));
      });
      node.parentNode.replaceChild(frag, node);
    }

    function prepareTarget(el) {
      if (el.dataset.rollupPrepared === 'true') return;
      if (el.querySelector('.char-wrap')) {
        el.dataset.rollupPrepared = 'true';
        return;
      }
      var delayStart = Number(el.getAttribute('data-rollup-delay-start') || 0);
      var delayStep = Number(el.getAttribute('data-rollup-delay-step') || 60);
      var state = { charIndex: 0 };
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var textNodes = [];
      var node = walker.nextNode();
      while (node) {
        textNodes.push(node);
        node = walker.nextNode();
      }
      textNodes.forEach(function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return;
        wrapTextNodeChars(n, delayStart, delayStep, state);
      });
      el.dataset.rollupPrepared = 'true';
    }

    if (prefersReducedMotion) {
      targets.forEach(function (el) {
        prepareTarget(el);
        el.classList.add('is-revealed');
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          prepareTarget(el);
          el.classList.add('is-revealed');
          if (!el.hasAttribute('data-rollup-repeat')) observer.unobserve(el);
        });
      },
      { rootMargin: '-35% 0px -35% 0px', threshold: 0 },
    );

    targets.forEach(function (el) {
      prepareTarget(el);
      /* On desktop the scroll engine reveals story-card headings at card-centre;
         skip IntersectionObserver for those elements to avoid early triggering. */
      if (window.innerWidth >= 1024 && el.closest('.cards-pan')) return;
      /* Story-promo eyebrow/heading sit far from the section's top edge (the
         portrait overlaps them), so their own intersection fires later than
         the section's. Let the section reveal drive them instead, so they
         animate in together with the body & button, in document order. */
      if (el.closest('.story-promo__content')) return;
      observer.observe(el);
    });
  })();

  /* ── Line rollup (data-rollup-lines) ── */
  (function initLineRollup() {
    var targets = Array.from(document.querySelectorAll('[data-rollup-lines]'));
    if (!targets.length) return;

    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    targets.forEach(function (el) {
      var words = el.textContent.trim().split(/\s+/);
      el.innerHTML = words
        .map(function (w) {
          return '<span class="line-measure-word">' + w + '</span>';
        })
        .join(' ');
    });

    requestAnimationFrame(function () {
      targets.forEach(function (el) {
        var wordEls = Array.from(el.querySelectorAll('.line-measure-word'));
        var lineGroups = [];
        var lastTop = null;
        wordEls.forEach(function (wordEl) {
          var top = Math.round(wordEl.getBoundingClientRect().top);
          if (top !== lastTop) {
            lineGroups.push([]);
            lastTop = top;
          }
          lineGroups[lineGroups.length - 1].push(wordEl.textContent);
        });
        var delayStart = Number(el.getAttribute('data-rollup-delay-start') || 0);
        var delayStep = Number(el.getAttribute('data-rollup-delay-step') || 150);
        el.innerHTML = '';
        lineGroups.forEach(function (lineWords, i) {
          var mask = document.createElement('span');
          mask.className = 'line-mask';
          var inner = document.createElement('span');
          inner.className = 'line-inner';
          inner.textContent = lineWords.join(' ');
          inner.style.animationDelay = delayStart + i * delayStep + 'ms';
          mask.appendChild(inner);
          el.appendChild(mask);
        });
      });

      if (prefersReducedMotion) {
        targets.forEach(function (el) {
          el.classList.add('is-revealed');
        });
        return;
      }

      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          });
        },
        { rootMargin: '-35% 0px -35% 0px', threshold: 0 },
      );

      targets.forEach(function (el) {
        observer.observe(el);
      });
    });
  })();

  /* ── Section reveal (data-reveal-section) ── */
  (function initSectionReveal() {
    var sections = document.querySelectorAll('[data-reveal-section], .reveal-section');
    if (!sections.length) return;

    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function revealSection(section) {
      section.classList.add('is-revealed');
      /* Story-promo eyebrow/heading: revealed here (rather than via their own
         IntersectionObserver) so they stagger in alongside the body & button. */
      section.querySelectorAll('.story-promo__content [data-rollup]').forEach(function (el) {
        var delay = Number(el.getAttribute('data-reveal-text-delay') || 0);
        delay
          ? setTimeout(function () {
              el.classList.add('is-revealed');
            }, delay)
          : el.classList.add('is-revealed');
      });
      section.querySelectorAll('[data-reveal-text]').forEach(function (el) {
        var delay = Number(
          el.getAttribute('data-reveal-text-delay') ||
            section.getAttribute('data-reveal-text-delay') ||
            0,
        );
        delay
          ? setTimeout(function () {
              el.classList.add('is-revealed');
            }, delay)
          : el.classList.add('is-revealed');
      });
      section.querySelectorAll('[data-reveal-media]').forEach(function (el) {
        var delay = Number(
          el.getAttribute('data-reveal-media-delay') ||
            section.getAttribute('data-reveal-media-delay') ||
            0,
        );
        delay
          ? setTimeout(function () {
              el.classList.add('is-revealed');
            }, delay)
          : el.classList.add('is-revealed');
      });
    }

    if (prefersReducedMotion) {
      sections.forEach(revealSection);
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          revealSection(entry.target);
          if (!entry.target.hasAttribute('data-reveal-repeat')) observer.unobserve(entry.target);
        });
      },
      { rootMargin: '-35% 0px -35% 0px', threshold: 0 },
    );

    sections.forEach(function (s) {
      /* On desktop the scroll engine reveals story cards at card-centre;
         skip IntersectionObserver for those elements to avoid early triggering. */
      if (window.innerWidth >= 1024 && s.closest('.cards-pan')) return;
      observer.observe(s);
    });
  })();

  /* ── Body text fade-in (.fade-in-text) ── */
  (function initBodyTextFadeIn() {
    var targets = document.querySelectorAll('.fade-in-text');
    if (!targets.length) return;

    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      targets.forEach(function (el) {
        el.classList.add('is-revealed');
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '-35% 0px -35% 0px', threshold: 0 },
    );

    targets.forEach(function (el) {
      observer.observe(el);
    });
  })();
})();
