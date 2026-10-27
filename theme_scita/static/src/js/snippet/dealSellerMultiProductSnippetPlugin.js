/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { rpc } from "@web/core/network/rpc";
import { renderToElement } from "@web/core/utils/render";
import { BuilderAction } from "@html_builder/core/builder_action";

// A missing / invalid date must not block the editor with a browser alert() (it freezes the
// whole builder until dismissed) nor save a "nan" countdown: flag the field in the dialog
// and keep the dialog open.
function rejectInvalidDate(dateInput, date) {
    const feedbackClass = "o_scita_date_feedback";
    let feedback = dateInput.parentElement.querySelector("." + feedbackClass);
    if (!isNaN(date.getTime())) {
        dateInput.classList.remove("is-invalid");
        feedback?.remove();
        return false;
    }
    dateInput.classList.add("is-invalid");
    if (!feedback) {
        feedback = document.createElement("div");
        feedback.className = `invalid-feedback d-block ${feedbackClass}`;
        feedback.textContent = _t("Please choose the date when the deal ends.");
        dateInput.after(feedback);
    }
    dateInput.focus();
    return true;
}

// -------------------------------------------------
// Shared Modal Logic
// -------------------------------------------------
// Modify: show the saved timer ("Nov 7,2026 18:30:0", the format the timers read) and message
function prefillTimer(modalEl, storedDate, storedMsg) {
    const date = storedDate && storedDate !== "nan" ? new Date(storedDate) : null;
    if (date && !isNaN(date.getTime())) {
        const pad = (n) => String(n).padStart(2, "0");
        modalEl.querySelector("input#date").value =
            `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        modalEl.querySelector("input#hours").value = date.getHours();
        modalEl.querySelector("input#minutes").value = date.getMinutes();
        modalEl.querySelector("input#second").value = date.getSeconds();
    }
    if (storedMsg) {
        modalEl.querySelector("input#sale_over").value = storedMsg;
    }
}

async function openDealMultiProductModal(snippetEl) {
    const modalEl = renderToElement("theme_scita.multi_product_deal_custom_slider_configuration");
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

    const $sliderDeals = modalEl.querySelector("#slider_deals");
    const $cancel = modalEl.querySelector("#cancel");
    const $submit = modalEl.querySelector("#snippnet_submit");

    prefillTimer(modalEl, snippetEl.dataset.date, snippetEl.dataset.msg);

    // Load options dynamically
    rpc('/theme_scita/deal_get_options', {}).then((res) => {
        $sliderDeals.innerHTML = "";
        res.forEach((r) => {
            const opt = document.createElement("option");
            opt.value = r.id;
            opt.textContent = r.name;
            $sliderDeals.appendChild(opt);
        });
        if (snippetEl.dataset.multiDealOfDayType) {
            $sliderDeals.value = snippetEl.dataset.multiDealOfDayType;
        }
    });

    // Submit handler
    $submit.addEventListener("click", () => {
        const dateVal = modalEl.querySelector("input#date").value;
        // local midnight: a bare "YYYY-MM-DD" is read as UTC (the day before, west of UTC)
        const date = new Date(`${dateVal}T00:00`);
        if (rejectInvalidDate(modalEl.querySelector("input#date"), date)) {
            return;
        }

        const hours = parseInt(modalEl.querySelector("input#hours").value) || 0;
        const mins = parseInt(modalEl.querySelector("input#minutes").value) || 0;
        const secs = parseInt(modalEl.querySelector("input#second").value) || 0;

        const monthShortNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        let formattedDate = "nan";
        if (!isNaN(date.getTime())) {
            formattedDate = `${monthShortNames[date.getMonth()]} ${date.getDate()},${date.getFullYear()} ${hours}:${mins}:${secs}`;
        }

        // Save attributes
        snippetEl.setAttribute("data-date", formattedDate);
        snippetEl.setAttribute("data-msg", modalEl.querySelector("input#sale_over").value);
        snippetEl.setAttribute("data-multi-deal-of-day-type", $sliderDeals.value);
        snippetEl.setAttribute("data-multi-cat-dealer-id", "multi-cat-myowl" + $sliderDeals.value);

        // Use the original placeholder template structure to maintain consistency
        let type = $sliderDeals.options[$sliderDeals.selectedIndex]?.text || _t("Multi Product Deal Slider");

        snippetEl.innerHTML = `
            <div class="container">
                <div class="row our-categories">
                    <div class="col-md-12">
                        <div class="title-block">
                            <h4 id="snippet-title" class="section-title style1">
                                <span>${_t(type)}</span>
                            </h4>
                        </div>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/multi_deal_slide.webp" alt="Category Slider" class="img-fluid"/>
                        </div>
                    </div>
                </div>
            </div>
        `;

        myModal.hide();
    });

    // Cancel handler
    $cancel?.addEventListener("click", () => {
        myModal.hide();
    });

    modalEl.addEventListener("hidden.bs.modal", () => {
        modalEl.remove();
    });
}

// -------------------------------------------------
// Snippet Drop Plugin
// -------------------------------------------------
class DealSellerMultiProductSnippetPlugin extends Plugin {
    static id = "dealSellerMultiProductSnippet";

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
        so_content_addition_selector: [".deal_multi_product_slider"],
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("deal_multi_product_slider")) {
            return;
        }
        snippetEl.innerHTML = "";
        openDealMultiProductModal(snippetEl);
    }
}
registry.category("website-plugins").add(
    DealSellerMultiProductSnippetPlugin.id,
    DealSellerMultiProductSnippetPlugin
);

// -------------------------------------------------
// Modify Button Action
// -------------------------------------------------
export class DealSellerMultiProductModifyAction extends BuilderAction {
    static id = "dealSellerMultiProductModify";

    apply({ editingElement, params: { mainParam } }) {
        if (mainParam === "open") {
            openDealMultiProductModal(editingElement);
        }
    }

    isApplied() {
        return false;
    }
}

// -------------------------------------------------
// Modify Plugin
// -------------------------------------------------
class DealSellerMultiProductModifyPlugin extends Plugin {
    static id = "dealSellerMultiProductModifyPlugin";
    static dependencies = ["history", "media"];
    selector = ".deal_multi_product_slider";

    resources = {
        so_content_addition_selector: [".deal_multi_product_slider"],
        builder_actions: {
            DealSellerMultiProductModifyAction,
        },
    };
}
registry.category("website-plugins").add(
    DealSellerMultiProductModifyPlugin.id,
    DealSellerMultiProductModifyPlugin
);
