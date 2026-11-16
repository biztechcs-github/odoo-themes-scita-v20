/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { rpc } from "@web/core/network/rpc";
import { renderToElement } from "@web/core/utils/render";
import { BuilderAction } from "@html_builder/core/builder_action";

// --------------------------------------------------
// Shared Modal Logic for Dynamic Product Snippet 2
// --------------------------------------------------
async function openDynamicProductModal2(snippetEl, onChange) {
    // Render modal template
    const modalEl = renderToElement("theme_scita.scita_dynamic_product_snippet_configuration_two");
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

    const sliderTypeSelect = modalEl.querySelector("#slider_type_two");
    const submitBtn = modalEl.querySelector("#snippnet_submit_two");
    const cancelBtn = modalEl.querySelector("#cancel_two");

    // Handle submit
    submitBtn.addEventListener("click", () => {
        const selectedOption =
            sliderTypeSelect.selectedOptions[0]?.text || _t("Multi Product Slider");

        snippetEl.setAttribute("data-multi-cat-slider-type", sliderTypeSelect.value);
        snippetEl.setAttribute("data-multi-cat-slider-id", "multi-cat-myowl" + sliderTypeSelect.value);

        // Use the original placeholder template structure to maintain consistency
        snippetEl.innerHTML = `
            <div class="container">
                <div class="row our-config-products">
                    <div class="col-md-12">
                        <div class="title-block">
                            <h4 id="snippet-title" class="section-title style1">
                                <span></span>
                            </h4>
                            <div class="category-slider-placeholder">
                                <img src="/theme_scita/static/src/img/img_cat_slider.jpg" alt="Product Snippet" class="img-fluid"/>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // a record name is text, not HTML
        snippetEl.querySelector("#snippet-title span").textContent = _t(selectedOption);
        // record the change (undo step), or the editor does not save it
        onChange?.();
        myModal.hide();
    });

    // Handle cancel
    cancelBtn?.addEventListener("click", () => {
        myModal.hide();
    });

    // Cleanup modal after close
    modalEl.addEventListener("hidden.bs.modal", () => {
        modalEl.remove();
    });

    // Apply stays off until the options are there: it would only close the dialog
    submitBtn.disabled = true;
    // Load product configuration options
    const res = await rpc("/theme_scita/product_configuration_two", {});
    sliderTypeSelect.innerHTML = "";
    res.forEach(opt => {
        const option = document.createElement("option");
        option.value = opt.id;
        option.textContent = opt.name;
        sliderTypeSelect.appendChild(option);
    });
    // Modify re-opens on the slider the block shows
    if (snippetEl.dataset.multiCatSliderType) {
        sliderTypeSelect.value = snippetEl.dataset.multiCatSliderType;
    }
    submitBtn.disabled = false;
}

// --------------------------------------------------
// Snippet Drop Plugin
// --------------------------------------------------
class SctProductSnippet2Plugin extends Plugin {
    static id = "sctProductSnippet2";
    static dependencies = ["history"];

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("sct_product_snippet_2")) {
            return;
        }

        snippetEl.classList.remove("hidden");
        snippetEl.querySelector(".owl-carousel")?.replaceChildren();

        // Open modal when dropped
        openDynamicProductModal2(snippetEl, () => this.dependencies.history.commit());
    }
}

registry.category("website-plugins").add(
    SctProductSnippet2Plugin.id,
    SctProductSnippet2Plugin
);

// --------------------------------------------------
// Modify Button Plugin
// --------------------------------------------------
class SctProductSnippet2ModifyPlugin extends Plugin {
    static id = "sctProductModifyBtn2";
    static dependencies = ["history", "media"];
    selector = ".sct_product_snippet_2";

    resources = {
        builder_actions: {
            ModifyBtnAction2,
        },
    };
}

export class ModifyBtnAction2 extends BuilderAction {
    static id = "sctProductModifyBtn2";
    static dependencies = ["history"];

    apply({ editingElement, params: { mainParam } }) {
        if (mainParam === "open") {
            openDynamicProductModal2(editingElement, () => this.dependencies.history.commit());
        }
    }

    isApplied({ editingElement }) {
        return editingElement.dataset.modified === "true";
    }
}

registry.category("website-plugins").add(
    SctProductSnippet2ModifyPlugin.id,
    SctProductSnippet2ModifyPlugin
);

