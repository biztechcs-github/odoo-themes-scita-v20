/** @odoo-module **/
// Odoo 20 ships no jQuery: same behaviour as before, in plain DOM.

function onReady(fn) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
        fn();
    }
}

onReady(() => {
    document.addEventListener("click", (ev) => {
        if (ev.target.closest(".ab-category-close")) {
            document.body.classList.remove("sct_shop_box_overlay");
        } else if (ev.target.closest(".ab-category")) {
            document.body.classList.add("sct_shop_box_overlay");
        }
    });
    if (document.querySelector("div.ab-mob-view")) {
        document.getElementById("wrapwrap")?.classList.add("ab-btm-cat");
    }
});
