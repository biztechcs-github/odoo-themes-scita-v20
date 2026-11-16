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

async function openDealOfTheDayModal(snippetEl, onChange) {
    // Render modal template
    const modalEl = renderToElement("theme_scita.deal_of_the_day_configration");
    document.body.appendChild(modalEl);

    // Bootstrap modal
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

    const selectEl = modalEl.querySelector("#slider_deals_select");
    const dateInput = modalEl.querySelector("input#date");
    const hourInput = modalEl.querySelector("input#hours");
    const minInput = modalEl.querySelector("input#minutes");
    const secInput = modalEl.querySelector("input#second");
    const msgInput = modalEl.querySelector("input#sale_over");
    const submitBtn = modalEl.querySelector("#snippnet_submit");
    const cancelBtn = modalEl.querySelector("#cancel");

    prefillTimer(modalEl, snippetEl.dataset.date, snippetEl.dataset.msg);

    // Handle submit
    submitBtn.addEventListener("click", () => {
        // local midnight: a bare "YYYY-MM-DD" is read as UTC (the day before, west of UTC)
        const date = new Date(`${dateInput.value}T00:00`);
        if (rejectInvalidDate(dateInput, date, [hourInput, minInput, secInput])) {
            return;
        }
        const hours = parseInt(hourInput.value) || 0;
        const mins = parseInt(minInput.value) || 0;
        const secs = parseInt(secInput.value) || 0;

        if (isNaN(date.getTime())) {
            snippetEl.setAttribute("data-date", "nan");
            snippetEl.setAttribute("data-msg", msgInput.value);
        } else {
            const monthShortNames = [
                "Jan","Feb","Mar","Apr","May","Jun",
                "Jul","Aug","Sep","Oct","Nov","Dec"
            ];
            const formatted = `${monthShortNames[date.getMonth()]} ${date.getDate()},${date.getFullYear()} ${hours}:${mins}:${secs}`;
            snippetEl.setAttribute("data-date", formatted);
            snippetEl.setAttribute("data-msg", msgInput.value);
        }

        snippetEl.setAttribute("data-deal-snippet-id", selectEl.value);

        const type = selectEl.selectedOptions[0]?.text || _t("Deal Of The Day");

        // Use the original placeholder template structure to maintain consistency
        snippetEl.innerHTML = `
            <div class="container">
                <div class="block-title">
                    <h2 class="fancy"></h2>
                </div>
                <div class="category-slider-placeholder">
                    <img src="/theme_scita/static/src/img/dealofday.jpg" alt="Deal of the Day" class="img-fluid"/>
                </div>
            </div>
        `;
        // a record name is text, not HTML
        snippetEl.querySelector(".fancy").textContent = type;
        // record the change (undo step), or the editor does not save it
        onChange?.();
        myModal.hide();
    });

    // Handle cancel
    cancelBtn?.addEventListener("click", () => {
        myModal.hide();
    });

    // Cleanup
    modalEl.addEventListener("hidden.bs.modal", () => {
        modalEl.remove();
    });

    // Apply stays off until the options are there: it would only close the dialog
    submitBtn.disabled = true;
    // Populate dropdown from RPC
    const res = await rpc("/theme_scita/deal_get_options", {});
    selectEl.innerHTML = "";
    res.forEach(opt => {
        const option = document.createElement("option");
        option.value = opt.id;
        option.textContent = opt.name;
        selectEl.appendChild(option);
    });
    // after the options exist: set before, it was lost and Modify switched to the first deal
    if (snippetEl.dataset.dealSnippetId) {
        selectEl.value = snippetEl.dataset.dealSnippetId;
    }
    submitBtn.disabled = false;
}

// -------------------------------------------------
// Snippet Drop Plugin
// -------------------------------------------------
class DealOfTheDaySnippetPlugin extends Plugin {
    static id = "dealOfTheDaySnippet";
    static dependencies = ["history"];

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("oe_deal_of_the_day")) {
            return;
        }

        snippetEl.classList.remove("hidden");

        // open modal after drop
        openDealOfTheDayModal(snippetEl, () => this.dependencies.history.commit());
    }
}
registry.category("website-plugins").add(
    DealOfTheDaySnippetPlugin.id,
    DealOfTheDaySnippetPlugin
);

// -------------------------------------------------
// Modify Button Action
// -------------------------------------------------
export class DealOfTheDayModifyBtnAction extends BuilderAction {
    static id = "dealOfTheDayModifyBtn";
    static dependencies = ["history"];

    apply({ editingElement, params: { mainParam } }) {
        if (mainParam === "open") {
            openDealOfTheDayModal(editingElement, () => this.dependencies.history.commit());
        }
    }

    isApplied() {
        return false; // always allow reopen
    }
}

// Register modify plugin
class DealOfTheDayModifyPlugin extends Plugin {
    static id = "dealOfTheDayModifyPlugin";
    static dependencies = ["history", "media"];
    selector = ".oe_deal_of_the_day";

    resources = {
        builder_actions: {
            DealOfTheDayModifyBtnAction,
        },
    };
}
registry.category("website-plugins").add(
    DealOfTheDayModifyPlugin.id,
    DealOfTheDayModifyPlugin
);
