/** @odoo-module alias=@web/public/lazyloader default=false */
// Copy of Odoo 20's web/static/src/public/lazyloader.js (replaces it in the minimal bundle of the
// websites using Theme Scita, see __manifest__.py); only when the lazy JS starts loading differs.
import { BUTTON_HANDLER_SELECTOR, makeAsyncHandler, makeButtonHandler } from "@web/public/utils";

// Track when all JS files have been lazy loaded. Will allow to unblock the
// related DOM sections when the whole JS have been loaded and executed.
let allScriptsLoadedResolve = null;
const _allScriptsLoaded = new Promise(resolve => {
    allScriptsLoadedResolve = resolve;
}).then(stopWaitingLazy);

const retriggeringWaitingProms = [];
const bufferedClicks = new Map();
/**
 * Function to use as an event handler to replay the incoming event after the
 * whole lazy JS has been loaded. Note that blocking the incoming event is left
 * up to the caller (i.e. a potential wrapper, @see waitLazy).
 *
 * @param {Event} ev
 * @returns {Promise}
 */
async function waitForLazyAndRetrigger(ev) {
    // Wait for the lazy JS to be loaded before re-triggering the event.
    const targetEl = ev.target;
    if (ev.type === "click" && !bufferedClicks.has(targetEl)) {
        bufferedClicks.set(targetEl, ev);
    }
    await _allScriptsLoaded;
    // Loaded scripts were able to add a delay to wait for before re-triggering
    // events: we wait for it here.
    await Promise.all(retriggeringWaitingProms);

    // At the end of the current execution queue, retrigger the event. Note that
    // the event is reconstructed: this is necessary in some cases, e.g. submit
    // buttons. Probably because the event was originally defaultPrevented.
    setTimeout(() => {
        // Extra safety check: the element might have been removed from the DOM
        if (targetEl.isConnected) {
            targetEl.dispatchEvent(new ev.constructor(ev.type, ev));
        }
    }, 0);
}

const loadingEffectHandlers = [];
/**
 * Adds the given event listener and saves it for later removal.
 *
 * @param {HTMLElement} el
 * @param {string} type
 * @param {Function} handler
 */
function registerLoadingEffectHandler(el, type, handler) {
    el.addEventListener(type, handler, {capture: true});
    loadingEffectHandlers.push({el, type, handler});
}

let waitingLazy = false;

/**
 * Automatically adds a loading effect on clicked buttons (that were not marked
 * with a specific class). Once the whole JS has been loaded, the events will be
 * triggered again.
 *
 * For forms, we automatically prevent submit events (since can be triggered
 * without click on a button) but we do not retrigger them (could be duplicate
 * with re-trigger of a click on a submit button otherwise). However, submitting
 * a form in any way should most of the time simulate a click on the submit
 * button if any anyway.
 *
 * @see stopWaitingLazy
 */
function waitLazy() {
    if (waitingLazy) {
        return;
    }
    waitingLazy = true;

    document.body.classList.add('o_lazy_js_waiting');

    // TODO should probably find the wrapwrap another way but in future versions
    // the element will be gone anyway.
    const mainEl = document.getElementById('wrapwrap') || document.body;
    const loadingEffectButtonEls = [...mainEl.querySelectorAll(BUTTON_HANDLER_SELECTOR)]
        // We target all buttons but...
        .filter(el => {
            // ... we allow to disable the effect by adding a specific class if
            // needed. Note that if some non-lazy loaded code is adding an event
            // handler on some buttons, it means that if they do not have that
            // class, they will show a loading effect and not do anything until
            // lazy JS is loaded anyway. This is not ideal, especially since
            // this was added as a stable fix/imp, but this is a compromise: on
            // next page visits, the cache should limit to effect of the lazy
            // loading anyway.
            return !el.classList.contains('o_no_wait_lazy_js')
                // ... we also allow do not consider links with a href which is
                // not "#". They could be linked to handlers that prevent their
                // default behavior but we consider that following the link
                // should still be relevant in that case.
                && !(el.nodeName === 'A' && el.href && el.getAttribute('href') !== '#');
        });
    // Note: this is a limitation/a "risk" to only block and retrigger those
    // specific event types.
    const loadingEffectEventTypes = ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click', 'mouseout', 'mouseleave'];
    for (const buttonEl of loadingEffectButtonEls) {
        for (const eventType of loadingEffectEventTypes) {
            const loadingEffectHandler = eventType === 'click'
                    ? makeButtonHandler(waitForLazyAndRetrigger, true)
                    : makeAsyncHandler(waitForLazyAndRetrigger, true);
            registerLoadingEffectHandler(buttonEl, eventType, loadingEffectHandler);
        }
    }

    for (const formEl of document.querySelectorAll('form:not(.o_no_wait_lazy_js)')) {
        registerLoadingEffectHandler(formEl, 'submit', ev => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
        });
    }

    // Theme Scita: Bootstrap controls that are not buttons (the arrows of Scita's banner sliders
    // are <div>s) are held and replayed the same way: a tap before the JS was loaded was lost.
    registerLoadingEffectHandler(document, 'click', ev => {
        const controlEl = ev.target.closest && ev.target.closest(SCITA_BS_CONTROLS);
        if (!controlEl || loadingEffectButtonEls.includes(controlEl)) {
            return;
        }
        ev.preventDefault();
        ev.stopImmediatePropagation();
        waitForLazyAndRetrigger(ev);
    });
}
const SCITA_BS_CONTROLS = '[data-bs-slide], [data-bs-slide-to], .carousel-control-prev, .carousel-control-next, [data-bs-toggle]';
/**
 * Undo what @see waitLazy did.
 */
function stopWaitingLazy() {
    if (!waitingLazy) {
        return;
    }
    waitingLazy = false;

    document.body.classList.remove('o_lazy_js_waiting');

    for (const { el, type, handler } of loadingEffectHandlers) {
        el.removeEventListener(type, handler, {capture: true});
    }
}

// Start waiting for lazy loading as soon as the DOM is available
if (document.readyState !== 'loading') {
    waitLazy();
} else {
    document.addEventListener('DOMContentLoaded', function () {
        waitLazy();
    });
}

// Theme Scita: Odoo starts loading the remaining JS (web.assets_frontend_lazy, ~700KB gzipped, about
// 0.5s of script evaluation on a mid-range phone) as soon as the page has loaded, i.e. while a phone
// is still drawing the first screen: the download competes with the first screen's images and the
// evaluation blocks the page (Lighthouse mobile: total blocking time ~400-600ms, the main image
// counted after it). On phones and tablets (the mobile header, below 992px) it starts at the
// visitor's first interaction (touch, scroll, key...) or 3s after the first paint, whichever comes
// first - right after the first paint when the first screen shows a block filled by that JS.
// Buttons tapped before that are held and replayed once it is loaded, as Odoo already does
// (waitLazy). Larger screens keep Odoo's behaviour (their top menu is laid out by that JS), as do
// pages shown in a frame (the website editor).
const DELAY_AFTER_FIRST_PAINT = 3000;
// The fields the visitor typed in before that JS is loaded (a phone may be typing already, the
// JS started at the touch on the field): Odoo's form empties its fields when it starts, the first
// letters were lost. website_form_keep_typed.js puts them back.
const typedFieldEls = new WeakSet();
document.addEventListener('input', (ev) => typedFieldEls.add(ev.target), true);
// Scita's dynamic blocks (placeholder until their data is loaded), Odoo's dynamic snippets
const FILLED_BY_JS = '.category-slider-placeholder, .s_dynamic';
const INTERACTION_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll', 'focusin'];
const INTERACTION_OPTIONS = { capture: true, passive: true };
let lazyStarted = false;
function startLazy() {
    if (lazyStarted) {
        return;
    }
    lazyStarted = true;
    for (const type of INTERACTION_EVENTS) {
        window.removeEventListener(type, startLazy, INTERACTION_OPTIONS);
    }
    setTimeout(_loadScripts, 0);
}
function onPageLoaded() {
    const smallScreen = window.matchMedia && window.matchMedia('(max-width: 991.98px)').matches;
    const paintSupported = typeof PerformanceObserver !== 'undefined'
        && (PerformanceObserver.supportedEntryTypes || []).includes('paint');
    if (!smallScreen || window.self !== window.top) {
        startLazy(); // Odoo's behaviour (also in the website editor's frame)
        return;
    }
    for (const type of INTERACTION_EVENTS) {
        window.addEventListener(type, startLazy, INTERACTION_OPTIONS);
    }
    // blocks filled by that JS (products, categories, blogs, videos...) on the first screen: no
    // waiting, it starts as soon as the page is painted
    const delay = [...document.querySelectorAll(FILLED_BY_JS)].some((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width && rect.bottom > 0 && rect.top < window.innerHeight;
    }) ? 0 : DELAY_AFTER_FIRST_PAINT;
    if (!paintSupported) {
        setTimeout(startLazy, delay);
        return;
    }
    const observer = new PerformanceObserver((list) => {
        if (list.getEntries().some((entry) => entry.name === 'first-contentful-paint')) {
            observer.disconnect();
            setTimeout(startLazy, delay);
        }
    });
    observer.observe({ type: 'paint', buffered: true });
}
if (document.readyState === 'complete') {
    onPageLoaded();
} else {
    window.addEventListener('load', onPageLoaded);
}

/**
 * @param {DOMElement[]} scripts
 * @param {integer} index
 */
function _loadScripts(scripts, index) {
    if (scripts === undefined) {
        scripts = document.querySelectorAll('script[data-src]');
    }
    if (index === undefined) {
        index = 0;
    }
    if (index >= scripts.length) {
        allScriptsLoadedResolve();
        return;
    }
    const script = scripts[index];
    script.addEventListener('load', _loadScripts.bind(this, scripts, index + 1));
    script.setAttribute('defer', 'defer'); // See LAZY_LOAD_DEFER
    script.src = script.dataset.src;
    script.removeAttribute('data-src');
}

export default {
    loadScripts: _loadScripts,
    allScriptsLoaded: _allScriptsLoaded,
    registerPageReadinessDelay: retriggeringWaitingProms.push.bind(retriggeringWaitingProms),
    typedFieldEls,
};
