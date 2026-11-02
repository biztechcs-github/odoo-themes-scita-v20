import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";

/**
 * While a page is edited, Odoo removes `data-bs-slide-to` from the carousel indicators and puts
 * it back when the editor closes (website.carousel_edit). A header option that reloads the page
 * (Template, Scroll Effect, Show/Hide Elements...) saves it in between, so the page can be stored
 * with indicators that have none. Bootstrap then never marks an indicator active and, at the
 * second automatic slide, fails with "Cannot read properties of null (reading 'classList')":
 * an error dialog for every visitor (seen on the Fashion Testimonials block).
 *
 * Give such indicators their slide index back on the website (n-th indicator = n-th slide).
 */
export class CarouselSlideToFix extends Interaction {
    static selector = ".carousel .carousel-indicators";

    setup() {
        const indicatorEls = [...this.el.children];
        if (!indicatorEls.some((el) => !el.hasAttribute("data-bs-slide-to"))) {
            return;
        }
        indicatorEls.forEach((el, index) => {
            if (!el.hasAttribute("data-bs-slide-to")) {
                el.setAttribute("data-bs-slide-to", index);
            }
        });
        // the indicator of the slide shown first, as Bootstrap expects one to be active
        const carouselEl = this.el.closest(".carousel");
        const items = [...carouselEl.querySelectorAll(".carousel-item")];
        const activeIndex = Math.max(0, items.findIndex((el) => el.classList.contains("active")));
        if (!this.el.querySelector(":scope > .active") && indicatorEls[activeIndex]) {
            indicatorEls[activeIndex].classList.add("active");
            indicatorEls[activeIndex].setAttribute("aria-selected", "true");
        }
    }
}

registry.category("public.interactions").add("theme_scita.carousel_slide_to_fix", CarouselSlideToFix);
