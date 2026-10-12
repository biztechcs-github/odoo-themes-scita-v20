/** @odoo-module **/

import { rpcBus } from "@web/core/network/rpc";

/**
 * Scita's dynamic blocks (product / category / blog / deal sliders...) ship an editor
 * placeholder (`.category-slider-placeholder`, a sample screenshot) that their widget replaces
 * with the data it fetches. Visitors must not see that sample, but hiding the whole block until
 * the data arrives made every such block grow from 0px once loaded and shove the page down
 * (layout shift). So the placeholder keeps its space while invisible (snippets.scss), and only
 * blocks still showing it once the page's requests are done (not configured, no published
 * products...) are hidden here.
 */

const SETTLE_DELAY = 1000;
let pending = 0;
let timer = null;

function check() {
    if (pending || document.body.classList.contains("editor_enable")) {
        return;
    }
    for (const sectionEl of document.querySelectorAll("#wrapwrap section")) {
        if (sectionEl.classList.contains("o_scita_dyn_wait") || sectionEl.querySelector(".o_scita_dyn_wait")) {
            continue; // not started yet (below the screen), see compat/public_widget.js
        }
        const empty = !!sectionEl.querySelector(":scope .category-slider-placeholder");
        // a block filled after it was hidden (late request) shows again
        sectionEl.classList.toggle("o_scita_dyn_empty", empty && !sectionEl.querySelector("section"));
    }
}

function schedule() {
    clearTimeout(timer);
    timer = setTimeout(check, SETTLE_DELAY);
}

rpcBus.addEventListener("RPC:REQUEST", () => {
    pending++;
    clearTimeout(timer);
});
rpcBus.addEventListener("RPC:RESPONSE", () => {
    pending = Math.max(0, pending - 1);
    if (!pending) {
        schedule();
    }
});

if (document.readyState === "complete") {
    schedule();
} else {
    window.addEventListener("load", schedule, { once: true });
}
