import { browser } from "@web/core/browser/browser";
import { patch } from "@web/core/utils/patch";
import { AnchorPlugin } from "@html_builder/core/anchor/anchor_plugin";

// The block's "Create and copy a link" button writes with navigator.clipboard, which browsers only
// give secure pages (https or localhost). Opened as http://<server-ip>:8069 the button stopped with an
// error before showing its "Anchor copied" notification. Copy the old way there.
function copyText(text) {
    const doc = browser.document || document;
    const textarea = doc.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position: fixed; top: 0; left: 0; opacity: 0;";
    const activeEl = doc.activeElement;
    doc.body.appendChild(textarea);
    textarea.select();
    try {
        doc.execCommand("copy");
    } finally {
        textarea.remove();
        activeEl?.focus?.({ preventScroll: true });
    }
}

patch(AnchorPlugin.prototype, {
    async createOrEditAnchorLink() {
        const nav = browser.navigator;
        if (nav.clipboard?.writeText) {
            return super.createOrEditAnchorLink(...arguments);
        }
        // only for this call: the rest of Odoo keeps seeing no Clipboard API
        Object.defineProperty(nav, "clipboard", {
            configurable: true,
            value: { writeText: async (text) => copyText(text) },
        });
        try {
            return await super.createOrEditAnchorLink(...arguments);
        } finally {
            delete nav.clipboard;
        }
    },
});
