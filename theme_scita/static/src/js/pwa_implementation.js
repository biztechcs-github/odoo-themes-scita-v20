/** @odoo-module **/
// Odoo 20 removed @web/legacy/js/public/lazyloader. On 19 this code waited for
// `lazyloader.allScriptsLoaded`, i.e. every deferred script having run after the
// window load event; waiting for `load` (plus a tick for deferred bundles such as
// the theme's jQuery) gives the same timing.

function whenAllScriptsLoaded(fn) {
    const run = () => setTimeout(fn, 0);
    if (document.readyState === "complete") {
        run();
    } else {
        window.addEventListener("load", run, { once: true });
    }
}

whenAllScriptsLoaded(function () {
    "use strict";
    const $ = window.jQuery;
    const popups = () => document.querySelectorAll(".mobile-deive-popup");
    const show = (els) => els.forEach((el) => (el.style.display = "block"));
    const hide = (els) => els.forEach((el) => (el.style.display = "none"));

    const isIos = () => {
        const userAgent = window.navigator.userAgent.toLowerCase();
        return /iphone|ipad|ipod/.test(userAgent);
    };

    const isInStandaloneMode = () => "standalone" in window.navigator && window.navigator.standalone;

    if (isIos() && !isInStandaloneMode()) {
        show(popups());
        popups().forEach((el) =>
            el.addEventListener("click", () => {
                hide(popups());
                localStorage.setItem("iphone_pwa_msg", "false");
            })
        );
    }
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/service_worker").catch(() => {});
    }
    document.addEventListener("click", (e) => {
        const closeBtn = e.target.closest(".sct_pwa_iphone_close");
        if (!closeBtn) {
            return;
        }
        const popup = closeBtn.closest(".mobile-deive-popup");
        if (popup) {
            if ($) {
                $(popup).hide("fast"); // same animation as 19
            } else {
                popup.style.display = "none";
            }
        }
        localStorage.setItem("iphone_pwa_msg", "false");
    });
    if (localStorage.getItem("iphone_pwa_msg") == "false") {
        popups().forEach((el) => el.classList.add("o_hidden"));
    }
});
