/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { rpc } from "@web/core/network/rpc";
import { renderToElement } from "@web/core/utils/render";
import { BuilderAction } from "@html_builder/core/builder_action";

// --------------------------------------------------
// Modal Logic for Trending Products Snippet
// --------------------------------------------------
async function openTrendingProductsModal(snippetEl, onChange) {
    // Render modal
    const modalEl = renderToElement("theme_scita.scita_trending_products_modal");
    document.body.appendChild(modalEl);

    const myModal = new Modal(modalEl);

    // Esc closes it like the editor's own dialogs: the focus stays in the editor, so Bootstrap's
    // keyboard handling (on the modal itself) never sees the key. Consumed, or the editor would
    // also take it (Esc = fullscreen).
    const closeOnEscape = (ev) => {
        if (ev.key === "Escape" && modalEl.classList.contains("show")) {
            ev.preventDefault();
            ev.stopPropagation();
            myModal.hide();
        }
    };
    document.addEventListener("keydown", closeOnEscape, true);
    modalEl.addEventListener("hidden.bs.modal", () => document.removeEventListener("keydown", closeOnEscape, true));
    myModal.show();

    const sliderTypeSelect = modalEl.querySelector("#slider_type");
    const submitBtn = modalEl.querySelector("#trending_category_data_submit");
    const cancelBtn = modalEl.querySelector("#cancel");

    // Submit
    submitBtn.addEventListener("click", () => {
        const selectedOpt = sliderTypeSelect.options[sliderTypeSelect.selectedIndex];
        const type = selectedOpt && selectedOpt.value !== "0" ? selectedOpt.text : _t("Trending Products");

        snippetEl.setAttribute("data-cat-slider-id", sliderTypeSelect.value);
        
        // Use the original placeholder template structure to maintain consistency
        snippetEl.innerHTML = `
            <div class="retail_trending_products">
                <div class="container">
                    <div class="lns-inner latest-trendy-section">
                        <div class="row">
                            <div class="lns-post">
                                <div class="psb-inner">
                                    <div class="title-block">
                                        <h2 class="section-title style1"></h2>
                                    </div>
                                    <div class="category-slider-placeholder">
                                        <img src="/theme_scita/static/src/img/TreandingProduct1.png" alt="Trending Products" class="img-fluid"/>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // a record name is text, not HTML
        snippetEl.querySelector(".section-title").textContent = _t(type);
        // record the change (undo step), or the editor does not save it
        onChange?.();
        myModal.hide();
    });

    // Cancel handler
    cancelBtn?.addEventListener("click", () => {
        myModal.hide();
    });

    // Cleanup after close
    modalEl.addEventListener("hidden.bs.modal", () => {
        modalEl.remove();
    });

    // Apply stays off until the options are there: it would only close the dialog
    submitBtn.disabled = true;
    // Load trending category options
    const res = await rpc("/theme_scita/trending_category_get_options", {});
    sliderTypeSelect.innerHTML = `<option value="0">-- Select --</option>`;
    res.forEach(opt => {
        const option = document.createElement("option");
        option.value = opt.id;
        option.textContent = opt.name;
        sliderTypeSelect.appendChild(option);
    });

    // Pre-fill if exists
    const currentType = snippetEl.getAttribute("data-cat-slider-id");
    if (currentType) {
        sliderTypeSelect.value = currentType;
    }
    submitBtn.disabled = false;
}

// --------------------------------------------------
// Snippet Drop Plugin
// --------------------------------------------------
class TrendingProductsSnippetPlugin extends Plugin {
    static id = "trendingProductsSnippet";
    static dependencies = ["history"];

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("theme_scita_trending_products")) {
            return;
        }
        snippetEl.classList.remove("o_hidden");

        // open modal once after drop
        openTrendingProductsModal(snippetEl, () => this.dependencies.history.commit());
    }
}

registry.category("website-plugins").add(
    TrendingProductsSnippetPlugin.id,
    TrendingProductsSnippetPlugin
);

// --------------------------------------------------
// Modify Button Action
// --------------------------------------------------
export class TrendingProductsModifyBtnAction extends BuilderAction {
    static id = "trending_products_modifyBtn";
    static dependencies = ["history"];

    apply({ editingElement, params: { mainParam } }) {
        if (mainParam === "open") {
            openTrendingProductsModal(editingElement, () => this.dependencies.history.commit());
        }
    }

    isApplied() {
        return false;
    }
}

// --------------------------------------------------
// Register Modify Button Plugin
// --------------------------------------------------
class TrendingProductsModifyPlugin extends Plugin {
    static id = "trendingProductsModifyPlugin";
    static dependencies = [];
    selector = ".theme_scita_trending_products";

    resources = {
        builder_actions: {
            TrendingProductsModifyBtnAction,
        },
    };
}

registry.category("website-plugins").add(
    TrendingProductsModifyPlugin.id,
    TrendingProductsModifyPlugin
);
