/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { rpc } from "@web/core/network/rpc";
import { renderToElement } from "@web/core/utils/render";
import { BuilderAction } from "@html_builder/core/builder_action";

// A missing / invalid date must not block the editor with a browser alert() (it freezes the
// whole builder until dismissed) nor save a "nan" countdown, and a time out of range ("25:0:0")
// is an Invalid Date for the timer, which then freezes: flag the field in the dialog and keep
// the dialog open.
const TIME_MAX = { hours: 23, minutes: 59, second: 59 };

function rejectInvalidDate(dateInput, date, timeInputs) {
    const feedbackClass = "o_scita_date_feedback";
    const invalidInput = isNaN(date.getTime())
        ? dateInput
        : timeInputs.find(({ id, value }) => !/^\d*$/.test(value.trim()) || Number(value) > TIME_MAX[id]);
    for (const input of [dateInput, ...timeInputs]) {
        input.classList.toggle("is-invalid", input === invalidInput);
    }
    dateInput.closest(".modal").querySelector("." + feedbackClass)?.remove();
    if (!invalidInput) {
        return false;
    }
    const feedback = document.createElement("div");
    feedback.className = `invalid-feedback d-block ${feedbackClass}`;
    feedback.textContent = invalidInput === dateInput
        ? _t("Please choose the date when the deal ends.")
        : _t("Enter hours from 0 to 23, minutes and seconds from 0 to 59.");
    invalidInput.after(feedback);
    invalidInput.focus();
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

async function openDealMultiProductModal(snippetEl, onChange) {
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

    // Load options dynamically (Apply stays off until they are there)
    $submit.disabled = true;
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
        $submit.disabled = false;
    });

    // Submit handler
    $submit.addEventListener("click", () => {
        const dateVal = modalEl.querySelector("input#date").value;
        // local midnight: a bare "YYYY-MM-DD" is read as UTC (the day before, west of UTC)
        const date = new Date(`${dateVal}T00:00`);
        const timeInputs = ["hours", "minutes", "second"].map((id) => modalEl.querySelector(`input#${id}`));
        if (rejectInvalidDate(modalEl.querySelector("input#date"), date, timeInputs)) {
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
                                <span></span>
                            </h4>
                        </div>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/multi_deal_slide.webp" alt="Category Slider" class="img-fluid"/>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // a record name is text, not HTML
        snippetEl.querySelector("#snippet-title span").textContent = _t(type);
        // record the change (undo step), or the editor does not save it
        onChange?.();
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
    static dependencies = ["history"];

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("deal_multi_product_slider")) {
            return;
        }
        openDealMultiProductModal(snippetEl, () => this.dependencies.history.commit());
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
    static dependencies = ["history"];

    apply({ editingElement, params: { mainParam } }) {
        if (mainParam === "open") {
            openDealMultiProductModal(editingElement, () => this.dependencies.history.commit());
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
        builder_actions: {
            DealSellerMultiProductModifyAction,
        },
    };
}
registry.category("website-plugins").add(
    DealSellerMultiProductModifyPlugin.id,
    DealSellerMultiProductModifyPlugin
);
