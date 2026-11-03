/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { renderToElement } from "@web/core/utils/render";
import { BuilderAction } from "@html_builder/core/builder_action";
import { _t } from "@web/core/l10n/translation";

// The dialogs used to insert whatever was typed as raw HTML (any markup or script ended up
// in the page). Accept only a Google Maps embed: the <iframe> code of "Share > Embed a map"
// or its https://www.google.com/maps/embed?... link, and rebuild a clean iframe from it.
const MAP_HOST = /^(www\.|maps\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

function buildMapIframe(code) {
    let src = (code || "").trim();
    if (src.startsWith("<")) {
        const doc = new DOMParser().parseFromString(src, "text/html");
        const frames = doc.body.querySelectorAll("iframe");
        if (frames.length !== 1) {
            return null;
        }
        src = frames[0].getAttribute("src") || "";
    }
    let url;
    try {
        url = new URL(src);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || !MAP_HOST.test(url.hostname) || !url.pathname.startsWith("/maps")) {
        return null;
    }
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", url.href);
    iframe.setAttribute("width", "100%");
    iframe.setAttribute("height", "450");
    iframe.setAttribute("style", "border:0;");
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
    return iframe;
}

// Flags the field in the dialog and keeps the dialog open; returns the iframe when valid.
function validMapIframe(textarea) {
    const iframe = buildMapIframe(textarea.value);
    let feedback = textarea.parentElement.querySelector(".o_scita_map_feedback");
    if (iframe) {
        textarea.classList.remove("is-invalid");
        feedback?.remove();
        return iframe;
    }
    textarea.classList.add("is-invalid");
    if (!feedback) {
        feedback = document.createElement("div");
        feedback.className = "invalid-feedback d-block o_scita_map_feedback";
        feedback.textContent = _t("Paste the embed code of Google Maps (Share > Embed a map) or its https://www.google.com/maps/embed link.");
        textarea.after(feedback);
    }
    textarea.focus();
    return null;
}

// Esc closes it like the editor's own dialogs (and the other Scita block dialogs): the focus
// stays in the editor, so Bootstrap's keyboard handling (on the modal itself) never sees the key.
// Consumed, or the editor would also take it.
function closeOnEscape(modalEl, modal) {
    const onKey = (ev) => {
        if (ev.key === "Escape" && modalEl.classList.contains("show")) {
            ev.preventDefault();
            ev.stopPropagation();
            modal.hide();
        }
    };
    document.addEventListener("keydown", onKey, true);
    modalEl.addEventListener("hidden.bs.modal", () => document.removeEventListener("keydown", onKey, true));
}

// ------------------------------------------------------
// Shared Modal Openers
// ------------------------------------------------------
async function openGoogleMapModal(snippetEl) {
    const modalEl = renderToElement("theme_scita.s_google_map_modal");
    document.body.appendChild(modalEl);

    const modal = new Modal(modalEl);
    closeOnEscape(modalEl, modal);
    modal.show();

    const setBtn = modalEl.querySelector("#set_map_data");
    const textarea = modalEl.querySelector("#address_html_code");
    // Modify re-opens on the map in place
    textarea.value = snippetEl.querySelector("iframe")?.getAttribute("src") || "";

    setBtn.addEventListener("click", () => {
        const iframe = validMapIframe(textarea);
        if (!iframe) {
            return;
        }
        snippetEl.replaceChildren(iframe);
        modal.hide();
    });

    modalEl.addEventListener("hidden.bs.modal", () => {
        modalEl.remove();
    });
}

async function openGoogleMapContentModal(snippetEl) {
    const modalEl = renderToElement("theme_scita.s_google_map_content_modal");
    document.body.appendChild(modalEl);

    const modal = new Modal(modalEl);
    closeOnEscape(modalEl, modal);
    modal.show();

    const setBtn = modalEl.querySelector("#set_map_data_content");
    const textarea = modalEl.querySelector("#address_content_html_code");
    textarea.value = snippetEl.querySelector(".map_data_container iframe")?.getAttribute("src") || "";

    setBtn.addEventListener("click", () => {
        const iframe = validMapIframe(textarea);
        if (!iframe) {
            return;
        }
        const container = snippetEl.querySelector(".map_data_container");
        if (container) {
            container.replaceChildren(iframe);
        }
        modal.hide();
    });

    modalEl.addEventListener("hidden.bs.modal", () => {
        modalEl.remove();
    });
}

// ------------------------------------------------------
// Drop Plugin for Google Map V1
// ------------------------------------------------------
class GoogleMapSnippetPlugin extends Plugin {
    static id = "googleMapSnippet";
    static dependencies = [];

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
        so_content_addition_selector: [".google_map_v1"],
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("google_map_v1")) {
            return;
        }
        snippetEl.innerHTML = "<div class='map_container'><span>Google Map Address</span></div>";
        openGoogleMapModal(snippetEl);
    }
}
registry.category("website-plugins").add(GoogleMapSnippetPlugin.id, GoogleMapSnippetPlugin);

// ------------------------------------------------------
// Drop Plugin for Google Map V2 (with content)
// ------------------------------------------------------
class GoogleMapContentSnippetPlugin extends Plugin {
    static id = "googleMapContentSnippet";
    static dependencies = [];

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
        so_content_addition_selector: [".google_map_v2"],
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("google_map_v2")) {
            return;
        }
        openGoogleMapContentModal(snippetEl);
    }
}
registry.category("website-plugins").add(GoogleMapContentSnippetPlugin.id, GoogleMapContentSnippetPlugin);

// ------------------------------------------------------
// Modify Button Actions
// ------------------------------------------------------
export class GoogleMapModifyBtnAction extends BuilderAction {
    static id = "googleMapModifyBtn";

    apply({ editingElement, params: { mainParam } }) {
        if (mainParam === "open") {
            openGoogleMapModal(editingElement);
        }
    }
    isApplied() { return false; }
}

export class GoogleMapContentModifyBtnAction extends BuilderAction {
    static id = "googleMapContentModifyBtn";

    apply({ editingElement, params: { mainParam } }) {
        if (mainParam === "open") {
            openGoogleMapContentModal(editingElement);
        }
    }
    isApplied() { return false; }
}

// ------------------------------------------------------
// Register Modify Plugins
// ------------------------------------------------------
class GoogleMapModifyPlugin extends Plugin {
    static id = "googleMapModifyPlugin";
    static dependencies = [];

    resources = {
        so_content_addition_selector: [".google_map_v1"],
        builder_actions: { GoogleMapModifyBtnAction },
    };
}
registry.category("website-plugins").add(GoogleMapModifyPlugin.id, GoogleMapModifyPlugin);

class GoogleMapContentModifyPlugin extends Plugin {
    static id = "googleMapContentModifyPlugin";
    static dependencies = [];

    resources = {
        so_content_addition_selector: [".google_map_v2"],
        builder_actions: { GoogleMapContentModifyBtnAction },
    };
}
registry.category("website-plugins").add(GoogleMapContentModifyPlugin.id, GoogleMapContentModifyPlugin);
