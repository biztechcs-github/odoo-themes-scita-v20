/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { CarouselOptionPlugin } from "@website/builder/plugins/carousel_option_plugin";

/**
 * Theme Scita carousels saved before the Odoo 20 migration use Bootstrap 4 indicators
 * (`<ol class="carousel-indicators"><li class="active">`). Odoo 20's "Add Slide" / "Remove
 * Slide" look for Bootstrap 5 ones (`<button class="active">`) and crash without them.
 * Upgrade the markup of such a carousel in place before those actions run (the templates
 * already use the Bootstrap 5 markup for newly dropped blocks).
 */
function upgradeIndicators(carouselEl) {
    const root = carouselEl?.closest(".carousel") || carouselEl;
    const listEl = root?.querySelector(".carousel-indicators");
    if (!listEl) {
        return;
    }
    // Odoo 20 also needs role="tab" + aria-selected on the buttons (see carousel_slider.js)
    listEl.setAttribute("role", "tablist");
    for (const button of listEl.querySelectorAll(":scope > button")) {
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", button.classList.contains("active") ? "true" : "false");
        button.removeAttribute("aria-current");
    }
    if (!listEl.querySelector(":scope > li")) {
        resetStaleCarousel(root, listEl);
        return;
    }
    const doc = listEl.ownerDocument;
    // Convert the <li>s inside the existing list. Replacing the list element itself (<ol> ->
    // <div>) left Bootstrap's Carousel instance - created when the page opened in the editor -
    // pointing at the detached old list: the next slide (e.g. "Remove Slide") found no active
    // indicator there and crashed ("Cannot read properties of null (reading 'classList')").
    const items = [...listEl.querySelectorAll(":scope > li")];
    const slides = root.querySelectorAll(".carousel-item").length;
    items.forEach((li, index) => {
        if (index >= slides) {
            li.remove(); // indicator without a slide
            return;
        }
        const button = doc.createElement("button");
        for (const { name, value } of li.attributes) {
            button.setAttribute(name, value);
        }
        button.setAttribute("type", "button");
        button.setAttribute("aria-label", `Slide ${index + 1}`);
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", li.classList.contains("active") ? "true" : "false");
        li.replaceWith(button);
    });
    resetStaleCarousel(root, listEl);
}

/**
 * Safety net: if a Bootstrap Carousel instance still references another indicators list than
 * the one in the page (e.g. a carousel upgraded by an earlier version of this patch), dispose
 * it so Odoo creates a fresh one on its next slide.
 */
function resetStaleCarousel(root, listEl) {
    const Carousel = root.ownerDocument.defaultView?.Carousel;
    const instance = Carousel?.getInstance?.(root);
    if (instance && instance._indicatorsElement && instance._indicatorsElement !== listEl) {
        instance.dispose();
    }
}

patch(CarouselOptionPlugin.prototype, {
    async addSlide(editingElement) {
        upgradeIndicators(editingElement);
        return super.addSlide(...arguments);
    },
    async removeSlide(editingElement) {
        upgradeIndicators(editingElement);
        return super.removeSlide(...arguments);
    },
});
