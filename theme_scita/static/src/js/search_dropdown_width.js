/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { SearchBarResults } from "@website/snippets/s_searchbar/search_bar_results";

// Odoo sizes the search dropdown with an inline `max-width: <search box width> !important`,
// which no stylesheet can override. For Scita's dropdown (the one with the suggestion /
// category columns) use a wider panel on desktop (search_dropdown.scss), centred under
// the search box but kept 16px inside the window.
patch(SearchBarResults.prototype, {
    setup() {
        super.setup(...arguments);
        const rootContent = this.dynamicContent._root;
        const getStyle = rootContent["t-att-style"];
        rootContent["t-att-style"] = () => {
            const style = getStyle();
            if (window.innerWidth >= 992 && this.el.querySelector(".searchbar_cat_right")) {
                const margin = 16;
                const formRect = this.searchBarEl.getBoundingClientRect();
                // never narrower than the search box itself (the search pop-up's bar is wider)
                const width = Math.min(Math.max(880, formRect.width), window.innerWidth - 2 * margin);
                const centredLeft = formRect.left + formRect.width / 2 - width / 2;
                const left = Math.min(
                    Math.max(centredLeft, margin),
                    window.innerWidth - margin - width
                );
                style["max-width"] = `${width}px !important`;
                style["width"] = `${width}px !important`;
                style["left"] = `${Math.round(left - formRect.left)}px !important`;
            }
            return style;
        };
    },
});
