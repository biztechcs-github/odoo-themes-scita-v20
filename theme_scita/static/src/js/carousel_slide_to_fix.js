import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";

/**
 * While a page is edited, Odoo removes `data-bs-slide-to` from the carousel indicators and
 * `data-bs-slide` from its prev / next arrows, and puts them back when the editor closes
 * (website.carousel_edit). A header option that reloads the page (Template, Scroll Effect,
 * Show/Hide Elements...) saves it in between, so the page can be stored without them:
 * - indicators: Bootstrap never marks one active and, at the second automatic slide, fails with
 *   "Cannot read properties of null (reading 'classList')": an error dialog for every visitor
 *   (seen on the Fashion Testimonials block);
 * - arrows: a click on them did nothing (seen on Banner Slider 1, the home page hero).
 *
 * Give them back on the website: n-th indicator = n-th slide, arrows by their class.
 */
export class CarouselSlideToFix extends Interaction {
    static selector = ".carousel";

    setup() {
        for (const [cls, direction] of [["carousel-control-prev", "prev"], ["carousel-control-next", "next"]]) {
            for (const arrowEl of this.el.querySelectorAll(`.${cls}`)) {
                if (arrowEl.closest(".carousel") === this.el && !arrowEl.hasAttribute("data-bs-slide")) {
                    arrowEl.setAttribute("data-bs-slide", direction);
                }
            }
        }
        const indicatorsEl = [...this.el.querySelectorAll(".carousel-indicators")].find(
            (el) => el.closest(".carousel") === this.el
        );
        if (!indicatorsEl) {
            return;
        }
        const indicatorEls = [...indicatorsEl.children];
        if (!indicatorEls.some((el) => !el.hasAttribute("data-bs-slide-to"))) {
            return;
        }
        indicatorEls.forEach((el, index) => {
            if (!el.hasAttribute("data-bs-slide-to")) {
                el.setAttribute("data-bs-slide-to", index);
            }
        });
        // the indicator of the slide shown first, as Bootstrap expects one to be active
        const items = [...this.el.querySelectorAll(".carousel-item")].filter(
            (el) => el.closest(".carousel") === this.el
        );
        const activeIndex = Math.max(0, items.findIndex((el) => el.classList.contains("active")));
        if (!indicatorsEl.querySelector(":scope > .active") && indicatorEls[activeIndex]) {
            indicatorEls[activeIndex].classList.add("active");
            indicatorEls[activeIndex].setAttribute("aria-selected", "true");
        }
    }
}

registry.category("public.interactions").add("theme_scita.carousel_slide_to_fix", CarouselSlideToFix);
