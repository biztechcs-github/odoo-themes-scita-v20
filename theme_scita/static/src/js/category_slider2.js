/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { renderToElement } from "@web/core/utils/render";
import { rpc } from "@web/core/network/rpc";
import { BuilderAction } from "@html_builder/core/builder_action";

// ------------------------------------------------------
// Shared Modal Logic for Category Slider
// ------------------------------------------------------
async function openCategorySliderModal(snippetEl, onChange) {
    // Render modal template
    const modalEl = renderToElement("theme_scita.scita_dynamic_category_slider");
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
    const submitBtn = modalEl.querySelector("#cat_sub_data");
    const cancelBtn = modalEl.querySelector("#cancel");

    // Submit handler
    submitBtn.addEventListener("click", () => {
        snippetEl.setAttribute("data-cat-slider-id", sliderTypeSelect.value);

        const selectedOpt = sliderTypeSelect.options[sliderTypeSelect.selectedIndex];
        const typeText = selectedOpt ? selectedOpt.text : _t("Category Slider");

        // Use the original placeholder template structure to maintain consistency
        snippetEl.innerHTML = `
            <div class="container">
                <div class="block-title">
                    <h3 class="fancy"></h3>
                </div>
                <div class="category-slider-placeholder">
                    <img src="/theme_scita/static/src/img/cat_slide_2.png" alt="Category Slider" class="img-fluid"/>
                </div>
            </div>
        `;
        // a record name is text, not HTML
        snippetEl.querySelector(".fancy").textContent = _t(typeText);
        // record the change (undo step), or the editor does not save it
        onChange?.();
        myModal.hide();
    });

    // Cancel handler
    cancelBtn?.addEventListener("click", () => {
        myModal.hide();
    });

    // Cleanup
    modalEl.addEventListener("hidden.bs.modal", () => {
        modalEl.remove();
    });

    // Apply stays off until the options are there: it would only close the dialog
    submitBtn.disabled = true;
    // Fetch category options from controller
    const res = await rpc("/theme_scita/category_get_options", {});
    sliderTypeSelect.innerHTML = "";
    res.forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = item.name;
        sliderTypeSelect.appendChild(opt);
    });

    // Pre-fill if exists
    const currentType = snippetEl.getAttribute("data-cat-slider-id");
    if (currentType) {
        sliderTypeSelect.value = currentType;
    }
    submitBtn.disabled = false;
}

// ------------------------------------------------------
// Snippet Drop Plugin
// ------------------------------------------------------
class CategorySliderPlugin2 extends Plugin {
    static id = "categorySliderSnippet2";
    static dependencies = ["history"];

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("cat_slider_4")) {
            return;
        }

        snippetEl.classList.remove("o_hidden");

        // Open modal after drop
        openCategorySliderModal(snippetEl, () => this.dependencies.history.commit());
    }
}
registry.category("website-plugins").add(
    CategorySliderPlugin2.id,
    CategorySliderPlugin2
);

// ------------------------------------------------------
// Modify Button Action
// ------------------------------------------------------
export class CategorySlider2ModifyBtnAction extends BuilderAction {
    static id = "cat_slider2_modifyBtn";    

    apply({ editingElement, params: { mainParam } }) {
        if (mainParam === "open") {
            openCategorySliderModal(editingElement, () => this.dependencies.history.commit());
        }
    }

    isApplied() {
        return false;
    }
}

// Register plugin for Modify button
class CategorySlider2ModifyPlugin extends Plugin {
    static id = "categorySlider2ModifyPlugin";
    static dependencies = [];
    selector = ".cat_slider_4";

    resources = {
        builder_actions: {
            CategorySlider2ModifyBtnAction,
        },
    };
}

registry.category("website-plugins").add(
    CategorySlider2ModifyPlugin.id,
    CategorySlider2ModifyPlugin
);
