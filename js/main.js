/* Homepage interactions. Optional hooks are enhanced only when present. */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var compact = window.matchMedia('(max-width: 833px)');
  var nav = document.querySelector('[data-nav]');
  var toggle = document.querySelector('[data-nav-toggle]');
  var menu = document.querySelector('[data-nav-menu]');
  var dialog = document.querySelector('#search-dialog');
  var menuOpen = false;
  var scrollOwners = new Set();
  var scrollState = null;
  var backgroundState = [];
  var focusableSelector = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

  function watchMedia(query, callback) {
    if (query.addEventListener) query.addEventListener('change', callback);
    else query.addListener(callback);
  }

  function canFocus(element) {
    return element instanceof HTMLElement && element.isConnected &&
      !element.matches(':disabled') && !element.closest('[hidden], [inert]') &&
      element.getClientRects().length > 0 &&
      window.getComputedStyle(element).visibility === 'visible';
  }

  function focusWithoutScroll(element) {
    if (canFocus(element)) element.focus({ preventScroll: true });
  }

  function saveStyles(element, properties) {
    return properties.map(function (property) {
      return [property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)];
    });
  }

  function restoreStyles(element, styles) {
    styles.forEach(function (style) {
      if (style[1]) element.style.setProperty(style[0], style[1], style[2]);
      else element.style.removeProperty(style[0]);
    });
  }

  /* One lock can be handed from the menu to search without losing scroll or
     overwriting the page's original inline styles. The root lock prevents
     wheel/touch scrolling without moving a sticky header's layout anchor. */
  function lockScroll(owner) {
    if (scrollOwners.has(owner)) return;
    scrollOwners.add(owner);
    if (scrollOwners.size > 1) return;

    var body = document.body;
    var root = document.documentElement;
    var gutter = Math.max(0, window.innerWidth - root.clientWidth);
    var padding = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    scrollState = {
      x: window.scrollX,
      y: window.scrollY,
      body: saveStyles(body, ['overflow', 'overflow-x', 'overflow-y', 'padding-right']),
      root: saveStyles(root, ['overflow', 'overflow-x', 'overflow-y', 'scroll-behavior'])
    };

    body.style.setProperty('overflow', 'hidden');
    if (gutter) body.style.setProperty('padding-right', padding + gutter + 'px');
  }

  // Keep the root scroll container intact so sticky navigation continues to
  // anchor at the viewport edge while an overlay is open. Prevent the input
  // gestures instead of turning the root into a nested scroll container.
  document.addEventListener('wheel', function (event) {
    if (scrollOwners.size) event.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', function (event) {
    if (scrollOwners.size) event.preventDefault();
  }, { passive: false });

  function unlockScroll(owner, restorePositionOnClose) {
    if (!scrollOwners.delete(owner) || scrollOwners.size || !scrollState) return;
    var saved = scrollState;
    scrollState = null;
    restoreStyles(document.body, saved.body);
    restoreStyles(document.documentElement, saved.root);

    function restorePosition() {
      var root = document.documentElement;
      var behavior = saveStyles(root, ['scroll-behavior'])[0];
      // The page uses smooth scrolling, but restoring an overlay must never
      // animate through a different scroll position while layout settles.
      root.style.setProperty('scroll-behavior', 'auto');
      root.scrollLeft = saved.x;
      root.scrollTop = saved.y;
      document.body.scrollLeft = saved.x;
      document.body.scrollTop = saved.y;
      window.scrollTo(saved.x, saved.y);
      if (behavior[1]) root.style.setProperty(behavior[0], behavior[1], behavior[2]);
      else root.style.removeProperty(behavior[0]);
    }

    if (restorePositionOnClose !== false) {
      // The fixed-body handoff can leave Chromium's root scroll offset at the
      // position it calculated while the overlay was open. Restore twice: once
      // now and once after the menu/dialog has completed its layout transition.
      restorePosition();
      window.requestAnimationFrame(function () {
        if (!scrollOwners.size) restorePosition();
      });
    }
  }

  function setBackgroundInert(inert) {
    if (!('inert' in HTMLElement.prototype)) return;
    if (inert) {
      if (backgroundState.length) return;
      document.querySelectorAll('main, footer').forEach(function (element) {
        // A nonstandard layout may place the header inside main.
        if (element.contains(toggle) || element.contains(menu)) return;
        backgroundState.push([element, element.getAttribute('inert')]);
        element.inert = true;
      });
    } else {
      backgroundState.forEach(function (state) {
        if (state[1] === null) state[0].removeAttribute('inert');
        else state[0].setAttribute('inert', state[1]);
      });
      backgroundState = [];
    }
  }

  function modalIsOpen() {
    return Boolean(document.querySelector('dialog[open]'));
  }

  /* ---- Nav scroll state ------------------------------------------------ */
  if (nav) {
    var ticking = false;
    var syncNav = function () {
      var y = scrollState ? scrollState.y : window.scrollY;
      nav.setAttribute('data-scrolled', y > 6 ? 'true' : 'false');
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(syncNav);
      }
    }, { passive: true });
    syncNav();
  }

  /* ---- Mobile menu ----------------------------------------------------- */
  function setMenu(open, restoreFocus) {
    if (!toggle || !menu) return;
    open = Boolean(open && compact.matches && !modalIsOpen());
    menuOpen = open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.setAttribute('data-open', open ? 'true' : 'false');
    menu.toggleAttribute('inert', compact.matches && !open);
    document.body.setAttribute('data-menu-open', open ? 'true' : 'false');

    if (open) {
      lockScroll('menu');
      setBackgroundInert(true);
    } else {
      setBackgroundInert(false);
      unlockScroll('menu');
      if (restoreFocus) focusWithoutScroll(toggle);
    }
  }

  function menuFocusables() {
    var scope = nav || menu;
    var elements = Array.prototype.slice.call(scope.querySelectorAll(focusableSelector));
    if (!scope.contains(toggle)) elements.push(toggle);
    return elements.filter(function (element) {
      return element.tabIndex >= 0 && canFocus(element);
    }).sort(function (a, b) {
      // Match native tab order if the HTML supplies positive tabindex values.
      if (a.tabIndex === b.tabIndex) return 0;
      return (a.tabIndex || Infinity) - (b.tabIndex || Infinity);
    });
  }

  if (toggle && menu) {
    if (!menu.id) menu.id = 'globalnav-menu';
    toggle.setAttribute('aria-controls', menu.id);
    setMenu(false);

    toggle.addEventListener('click', function () {
      setMenu(!menuOpen);
      if (menuOpen) {
        var firstLink = Array.prototype.find.call(menu.querySelectorAll('.globalnav__list a[href], a[href]'), canFocus);
        focusWithoutScroll(firstLink || toggle);
      }
    });

    (nav || menu).addEventListener('click', function (event) {
      if (menuOpen && event.target instanceof Element && event.target.closest('a[href]')) setMenu(false);
    });

    document.addEventListener('keydown', function (event) {
      if (!menuOpen || !compact.matches || modalIsOpen() || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(false, true);
      } else if (event.key === 'Tab') {
        var items = menuFocusables();
        var first = items[0] || toggle;
        var last = items[items.length - 1] || toggle;
        var active = document.activeElement;
        if (!items.length || items.indexOf(active) === -1 ||
            (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
          event.preventDefault();
          focusWithoutScroll(event.shiftKey ? last : first);
        }
      }
    });

    document.addEventListener('focusin', function (event) {
      if (!menuOpen || modalIsOpen()) return;
      var scope = nav || menu;
      if (!scope.contains(event.target) && event.target !== toggle) {
        focusWithoutScroll(menuFocusables()[0] || toggle);
      }
    });

    watchMedia(compact, function () {
      var focusWasInMenu = menu.contains(document.activeElement);
      setMenu(false);
      if (compact.matches && focusWasInMenu) focusWithoutScroll(toggle);
    });
  }

  /* ---- Native product search ------------------------------------------- */
  var input = dialog && dialog.querySelector('#site-search');
  var results = dialog && dialog.querySelector('[data-search-results]');
  var status = dialog && dialog.querySelector('[data-search-status]');
  var openers = Array.prototype.slice.call(document.querySelectorAll('[data-search-open]'));

  if (dialog && typeof dialog.showModal === 'function' && input && results && status) {
    var products = [
      { label: 'iPhone', id: 'iphone', category: 'Phone', detail: 'Explore iPhone and its advanced cameras.', aliases: 'phone smartphone mobile ios' },
      { label: 'MacBook Air', id: 'mac', category: 'Mac', detail: 'A remarkably light laptop for work and everyday creativity.', aliases: 'mac macbook notebook laptop computer' },
      { label: 'iPad Air', id: 'ipad', category: 'iPad', detail: 'Power and portability for work, play, and creativity.', aliases: 'ipad tablet pencil' },
      { label: 'MacBook Pro', id: 'macbook-pro', category: 'Mac', detail: 'Pro performance for demanding creative work.', aliases: 'mac macbook notebook laptop computer' },
      { label: 'AirPods Pro 3', id: 'airpods', category: 'Audio', detail: 'Immersive sound with Active Noise Cancellation.', aliases: 'airpods headphones earbuds earphones audio' },
      { label: 'Apple Watch Series 11', id: 'watch', category: 'Watch', detail: 'Health, fitness, and everyday connection on your wrist.', aliases: 'watch smartwatch wearable fitness' },
      { label: 'iPad Pro', id: 'ipad-pro', category: 'iPad', detail: 'An advanced display and performance for your biggest ideas.', aliases: 'ipad tablet pencil' },
      { label: 'Apple Trade In', id: 'trade-in', category: 'Trade In', detail: 'Trade in an eligible device for credit toward your next one.', aliases: 'trade trade-in tradein exchange upgrade' },
      { label: 'Apple Card', id: 'apple-card', category: 'Card', detail: 'Explore Apple Card and Daily Cash rewards.', aliases: 'card credit card daily cash finance' }
    ];
    var searchTrigger = null;
    var searchActive = false;
    var pointerStartedOutside = false;
    var pendingSearchRestore = undefined;

    function normalize(value) {
      return value.toLowerCase().replace(/[-\s]+/g, ' ').trim();
    }

    products.forEach(function (product) {
      product.searchText = normalize([product.label, product.category, product.detail, product.aliases].join(' '));
    });

    if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
      dialog.setAttribute('aria-label', 'Search apple.com');
    }
    if (!input.labels.length && !input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby')) {
      input.setAttribute('aria-label', 'Search products');
    }
    if (!results.id) results.id = 'site-search-results';
    if (!status.id) status.id = 'site-search-status';
    input.setAttribute('aria-controls', results.id);
    var descriptions = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (descriptions.indexOf(status.id) === -1) descriptions.push(status.id);
    input.setAttribute('aria-describedby', descriptions.join(' '));
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    openers.forEach(function (opener) {
      opener.setAttribute('aria-haspopup', 'dialog');
      opener.setAttribute('aria-controls', dialog.id);
    });

    function renderSearch() {
      var query = input.value.trim();
      var terms = normalize(query).split(' ').filter(Boolean);
      var matches = terms.length ? products.filter(function (product) {
        return terms.every(function (term) { return product.searchText.indexOf(term) !== -1; });
      }) : products.slice(0, 5);
      var fragment = document.createDocumentFragment();

      matches.forEach(function (product) {
        var link = document.createElement('a');
        link.className = 'search-result';
        link.setAttribute('href', '#' + product.id);
        [['label', product.label], ['detail', product.detail], ['arrow', '↗']].forEach(function (part) {
          var span = document.createElement('span');
          span.className = 'search-result__' + part[0];
          span.textContent = part[1];
          if (part[0] === 'arrow') span.setAttribute('aria-hidden', 'true');
          link.appendChild(span);
        });
        fragment.appendChild(link);
      });

      if (!matches.length) {
        var empty = document.createElement('p');
        empty.className = 'search-empty';
        empty.textContent = 'No matches yet. Try iPhone, Mac, iPad, or Watch.';
        fragment.appendChild(empty);
      }
      results.replaceChildren(fragment);
      status.textContent = terms.length ? matches.length + ' result' + (matches.length === 1 ? '' : 's') + ' for “' + query + '”.' : '5 suggestions.';
    }

    function finishSearchClose(restoreFocus, restorePositionOnClose) {
      if (!searchActive) return;
      searchActive = false;
      pointerStartedOutside = false;
      unlockScroll('search', restorePositionOnClose);
      var trigger = searchTrigger;
      searchTrigger = null;
      if (restoreFocus) {
        focusWithoutScroll(canFocus(trigger) ? trigger : openers.find(canFocus) || toggle);
      }
    }

    function closeSearch(restoreFocus, restorePositionOnClose) {
      pendingSearchRestore = restorePositionOnClose;
      if (dialog.open) dialog.close();
      finishSearchClose(restoreFocus !== false, restorePositionOnClose);
      pendingSearchRestore = undefined;
    }

    function openSearch(trigger) {
      if (dialog.open) {
        focusWithoutScroll(input);
        return;
      }
      // Acquire before releasing the menu's lock; restore inert backgrounds
      // before showModal so a dialog nested inside main works as well.
      searchTrigger = trigger || document.activeElement;
      lockScroll('search');
      setMenu(false);
      input.value = '';
      renderSearch();
      try {
        dialog.showModal();
      } catch (error) {
        unlockScroll('search');
        searchTrigger = null;
        return;
      }
      searchActive = true;
      focusWithoutScroll(input);
    }

    openers.forEach(function (opener) {
      opener.addEventListener('click', function () { openSearch(opener); });
    });
    dialog.querySelectorAll('[data-search-close]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        closeSearch();
      });
    });
    // Let native Escape/cancel behavior and its focus trap operate normally.
    dialog.addEventListener('close', function () {
      if (!dialog.open) {
        finishSearchClose(true, pendingSearchRestore);
        pendingSearchRestore = undefined;
      }
    });

    function outsideDialog(event) {
      var box = dialog.getBoundingClientRect();
      return event.target === dialog &&
        (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
    }

    dialog.addEventListener('pointerdown', function (event) {
      pointerStartedOutside = outsideDialog(event);
    });
    dialog.addEventListener('pointercancel', function () { pointerStartedOutside = false; });
    dialog.addEventListener('click', function (event) {
      var dismiss = pointerStartedOutside && outsideDialog(event);
      pointerStartedOutside = false;
      if (dismiss) closeSearch();
    });

    input.addEventListener('input', renderSearch);

    function activateFirstResult() {
      var first = results.querySelector('.search-result');
      if (first) first.click();
    }

    function dialogFocusables() {
      return Array.prototype.slice.call(dialog.querySelectorAll(focusableSelector)).filter(function (element) {
        return element.tabIndex >= 0 && canFocus(element);
      });
    }

    // Native dialog focus trapping is intentionally reinforced here. It keeps
    // keyboard behavior consistent in Chromium versions that briefly return
    // focus to <body> when a live result list is replaced.
    dialog.addEventListener('keydown', function (event) {
      if (!searchActive || event.key !== 'Tab' || event.defaultPrevented) return;
      var items = dialogFocusables();
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;
      if (!items.length) return;
      if (!dialog.contains(active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        focusWithoutScroll(event.shiftKey ? last : first);
      }
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        activateFirstResult();
      }
    });
    var form = input.closest('form');
    if (form && dialog.contains(form)) {
      form.addEventListener('submit', function (event) {
        if (event.submitter && event.submitter.matches('[data-search-close]')) return;
        event.preventDefault();
        activateFirstResult();
      });
    }

    results.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      var link = event.target instanceof Element && event.target.closest('a.search-result');
      if (!link || !results.contains(link)) return;
      var href = link.getAttribute('href');
      var target = document.getElementById(href.slice(1));
      // Let the product section own the next scroll position. A closing
      // overlay normally restores its launch position, but doing that here
      // would race the result's smooth scroll on the following frame.
      closeSearch(!target, target ? false : undefined);
      if (!target) return; // Preserve ordinary anchor behavior if a section is missing.
      event.preventDefault();
      if (window.location.hash !== href) window.history.pushState(null, '', href);
      var temporaryTabindex = !target.hasAttribute('tabindex') && target.tabIndex < 0;
      if (temporaryTabindex) target.setAttribute('tabindex', '-1');
      focusWithoutScroll(target);
      if (temporaryTabindex) {
        if (document.activeElement === target) {
          target.addEventListener('blur', function () { target.removeAttribute('tabindex'); }, { once: true });
        } else target.removeAttribute('tabindex');
      }
      target.scrollIntoView({ behavior: reduceMotion.matches ? 'instant' : 'smooth', block: 'start' });
    });

    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.isComposing || event.altKey ||
          !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      var target = event.target;
      var activeTarget = document.activeElement;
      var candidates = [activeTarget, target];
      var editingTarget = candidates.find(function (element) {
        return element instanceof HTMLElement &&
          (element.isContentEditable || element.matches('input, textarea, select, [role="textbox"]'));
      });
      var editing = Boolean(editingTarget);
      if (editing && editingTarget !== input) {
        // Do not let the browser's own command palette/search shortcut move
        // focus while the user is typing in an unrelated field.
        lastTypingTarget = editingTarget;
        event.preventDefault();
        return;
      }
      event.preventDefault();
      openSearch(document.activeElement === document.body ? openers.find(canFocus) : document.activeElement);
    });

    var lastTypingTarget = null;
    document.addEventListener('keyup', function (event) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || !lastTypingTarget) return;
      var target = lastTypingTarget;
      lastTypingTarget = null;
      if (canFocus(target)) focusWithoutScroll(target);
    });

    renderSearch();
  }

  /* ---- Optional finish selection (labels and pressed state only) -------- */
  var finishes = Array.prototype.slice.call(document.querySelectorAll('button[data-finish]'));
  var finishLabel = document.querySelector('[data-finish-label]');

  function selectFinish(selected) {
    finishes.forEach(function (button) {
      button.setAttribute('aria-pressed', button === selected ? 'true' : 'false');
    });
    var name = selected.getAttribute('data-finish') || '';
    if (finishLabel) finishLabel.textContent = name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');
  }

  if (finishes.length) {
    selectFinish(finishes.find(function (button) { return button.getAttribute('aria-pressed') === 'true'; }) || finishes[0]);
    finishes.forEach(function (button) {
      button.addEventListener('click', function () { selectFinish(button); });
    });
  }

  /* ---- Restrained, optional reveals ------------------------------------ */
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if (!reveals.length) return;
  var observer = null;
  var firstSection = document.querySelector('main section');

  function showReveal(element, immediately) {
    if (immediately) {
      element.style.transitionDelay = '0ms';
      element.style.transitionDuration = '0ms';
    }
    element.classList.add('is-visible');
    if (observer) observer.unobserve(element);
  }

  function showAllReveals() {
    reveals.forEach(function (element) { showReveal(element, true); });
    if (observer) observer.disconnect();
  }

  if (reduceMotion.matches || !('IntersectionObserver' in window)) {
    showAllReveals();
  } else {
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) showReveal(entry.target, false);
      });
    }, { rootMargin: '0px 0px 80px 0px', threshold: 0.01 });

    reveals.forEach(function (element) {
      // Critical content and product media never wait or move into place.
      var critical = element.getBoundingClientRect().top < window.innerHeight ||
        (firstSection && firstSection.contains(element));
      var media = element.matches('img, picture, figure, video') || element.querySelector('img, picture, video');
      element.style.transitionDelay = '0ms';
      if (critical || media) showReveal(element, true);
      else observer.observe(element);
    });
  }

  watchMedia(reduceMotion, function () {
    if (reduceMotion.matches) showAllReveals();
  });
})();
