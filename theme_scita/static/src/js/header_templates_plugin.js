import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { patch } from "@web/core/utils/patch";
import { HeaderTemplateChoice } from "@website/builder/plugins/options/header/header_template_option";
import { HeaderTemplateConfigAction } from "@website/builder/plugins/options/header/header_option_plugin";

/**
 * Scita Headers 1-5 in Header > Template, registered like Odoo's own headers (they used to be
 * extra items of the template list only). Odoo's header options read this list:
 * Navigation > Desktop Menu alignment enables "<header view>_align_center/_right" for the
 * active header only when it is in it, so the alignment buttons did nothing on Scita headers.
 */
const SCITA_HEADERS = [
    { n: 1, img: "header-1.png" },
    { n: 2, img: "header-2.png", defaultAlignment: { desktop: "center" } },
    { n: 3, img: "grocery-header.png", allCategories: true },
    { n: 4, img: "Automobile-header.png", allCategories: true },
    { n: 5, img: "header_5.svg", allCategories: true },
];

export class ScitaHeaderTemplatesPlugin extends Plugin {
    static id = "scitaHeaderTemplates";

    /** @type {import("plugins").WebsiteResources} */
    resources = {
        header_templates_providers: [
            () =>
                SCITA_HEADERS.map(({ n, img, defaultAlignment, allCategories }) => ({
                    key: `scita_header_${n}`,
                    Component: HeaderTemplateChoice,
                    props: {
                        id: `scita_header_${n}_opt`,
                        title: `Scita Header ${n}`,
                        imgSrc: `/theme_scita/static/src/img/snippet_icon/${img}`,
                        varName: `scita_header_${n}`,
                        menuShadowClass: "shadow-sm",
                        views: [
                            `theme_scita.option_header_${n}`,
                            "theme_scita.scita_header_cart_link",
                            "theme_scita.scita_header_wishlist_link",
                            "theme_scita.scita_header_search_box_icon",
                            "theme_scita.scita_header_mobile",
                            ...(allCategories ? ["theme_scita.scita_header_all_category_mobile"] : []),
                        ],
                        defaultAlignment,
                    },
                })),
        ],
    };
}

registry.category("website-plugins").add(ScitaHeaderTemplatesPlugin.id, ScitaHeaderTemplatesPlugin);

// Changing the header template rebuilds the website's whole style bundle (header-template is a SCSS
// value). With ?debug=assets that takes more than the builder's 10 s operation timeout: it rolled
// the editor back and showed "A technical issue occurred in the builder" although the header was
// switched. No timeout for it, as Odoo does for the theme switch (SwitchThemeAction).
patch(HeaderTemplateConfigAction.prototype, {
    setup() {
        super.setup(...arguments);
        this.canTimeout = false;
    },
});
