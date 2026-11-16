/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { renderToElement } from "@web/core/utils/render";
import { rpc } from "@web/core/network/rpc";
import { BuilderAction } from "@html_builder/core/builder_action";

// ------------------------------------------------------
// Shared Modal Logic
// ------------------------------------------------------
async function openCategorySliderModal(snippetEl, onChange) {
    // Render modal template
    const modalEl = renderToElement("theme_scita.scita_category_gray_slider_configration");
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
    const colorInput = modalEl.querySelector("#color");
    const submitBtn = modalEl.querySelector("#pro_category_sub_data");
    const cancelBtn = modalEl.querySelector("#cancel");

    // Submit
    submitBtn.addEventListener("click", () => {
        const selectedOpt = sliderTypeSelect.options[sliderTypeSelect.selectedIndex];
        const typeText = selectedOpt ? selectedOpt.text : _t("Our Brands");

        snippetEl.setAttribute("data-category-config-type", sliderTypeSelect.value);
        snippetEl.setAttribute("data-category-config-id", sliderTypeSelect.value);
        snippetEl.setAttribute("data-category-color", colorInput.value);

        // Use the original placeholder template structure to maintain consistency
        snippetEl.innerHTML = `
            <div class="container">
                <div class="row our-category">
                    <div class="col-md-12">
                        <h3 class="section-title style1" id="snippet-title">
                            <span></span>
                        </h3>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/cat_slide_3.png" alt="Category Slider" class="img-fluid"/>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // a record name is text, not HTML
        snippetEl.querySelector("#snippet-title span").textContent = _t(typeText);
        // record the change (undo step), or the editor does not save it
        onChange?.();
        myModal.hide();
    });

    cancelBtn?.addEventListener("click", () => {
        myModal.hide();
    });

    modalEl.addEventListener("hidden.bs.modal", () => {
        modalEl.remove();
    });

    // Apply stays off until the options are there: it would only close the dialog
    submitBtn.disabled = true;
    // Fetch slider types
    const res = await rpc("/theme_scita/category_get_options", {});
    sliderTypeSelect.innerHTML = "";
    res.forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = item.name;
        sliderTypeSelect.appendChild(opt);
    });

    // Pre-fill from attributes
    const currentType = snippetEl.getAttribute("data-category-config-type");
    const currentColor = snippetEl.getAttribute("data-category-color");
    if (currentType) sliderTypeSelect.value = currentType;
    if (currentColor) colorInput.value = currentColor;
    submitBtn.disabled = false;
}

// ------------------------------------------------------
// Snippet Drop Plugin
// ------------------------------------------------------
class CategorySliderPlugin3 extends Plugin {
    static id = "categorySliderSnippet3";
    static dependencies = ["history"];

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("oe_category_slider")) return;

        snippetEl.classList.remove("hidden");

        openCategorySliderModal(snippetEl, () => this.dependencies.history.commit());
    }
}
registry.category("website-plugins").add(
    CategorySliderPlugin3.id,
    CategorySliderPlugin3
);

// ------------------------------------------------------
// Modify Button Action
// ------------------------------------------------------
export class CategorySlider3ModifyBtnAction extends BuilderAction {
    static id = "cat_slider3_modifyBtn";
    static dependencies = ["history"];

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
class CategorySlider3ModifyPlugin extends Plugin {
    static id = "categorySlider3ModifyPlugin";
    static dependencies = [];
    selector = ".oe_category_slider";

    resources = {
        builder_actions: {
            CategorySlider3ModifyBtnAction,
        },
    };
}
registry.category("website-plugins").add(
    CategorySlider3ModifyPlugin.id,
    CategorySlider3ModifyPlugin
);
