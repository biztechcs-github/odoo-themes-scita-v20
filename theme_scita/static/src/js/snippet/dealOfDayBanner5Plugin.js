/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
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
async function openDealOfDayBanner5Modal(snippetEl, onChange) {
    // Render modal template (custom template without Deals dropdown)
    const modalEl = renderToElement("theme_scita.deal_of_day_banner_5_configration");
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

    const dateInput = modalEl.querySelector("input#date");
    const hourInput = modalEl.querySelector("input#hours");
    const minInput = modalEl.querySelector("input#minutes");
    const secInput = modalEl.querySelector("input#second");
    const msgInput = modalEl.querySelector("input#sale_over");
    const submitBtn = modalEl.querySelector("#snippnet_submit");
    const cancelBtn = modalEl.querySelector("#cancel");

    // Prefill values if snippet already configured
    const timerEl = snippetEl.querySelector('.js_counter_timer');
    
    // Get data from timer element if available
    if (timerEl && timerEl.dataset.date && timerEl.dataset.date !== "nan") {
        // Parse the stored date format: "Jan 1,2025 12:30:45"
        try {
            const storedDate = new Date(timerEl.dataset.date);
            if (!isNaN(storedDate.getTime())) {
                const year = storedDate.getFullYear();
                const month = String(storedDate.getMonth() + 1).padStart(2, '0');
                const day = String(storedDate.getDate()).padStart(2, '0');
                dateInput.value = `${year}-${month}-${day}`;
                hourInput.value = storedDate.getHours();
                minInput.value = storedDate.getMinutes();
                secInput.value = storedDate.getSeconds();
            }
        } catch (e) {
            console.error("Error parsing date:", e);
        }
    }
    
    if (timerEl && timerEl.dataset.msg) {
        msgInput.value = timerEl.dataset.msg;
    }

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

        // Find the timer element
        const timerElement = snippetEl.querySelector('.js_counter_timer');

        if (isNaN(date.getTime())) {
            if (timerElement) {
                timerElement.setAttribute("data-date", "nan");
                timerElement.setAttribute("data-msg", msgInput.value);
            }
        } else {
            const monthShortNames = [
                "Jan","Feb","Mar","Apr","May","Jun",
                "Jul","Aug","Sep","Oct","Nov","Dec"
            ];
            const formatted = `${monthShortNames[date.getMonth()]} ${date.getDate()},${date.getFullYear()} ${hours}:${mins}:${secs}`;
            
            if (timerElement) {
                timerElement.setAttribute("data-date", formatted);
                timerElement.setAttribute("data-msg", msgInput.value);
                
                // Preview in the editor (the timer widget doesn't run there): the time left, not
                // the end time of day
                const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, mins, secs);
                const left = Math.max(0, end.getTime() - Date.now());
                const [d, h, m, s] = [
                    Math.floor(left / 864e5),
                    Math.floor((left % 864e5) / 36e5),
                    Math.floor((left % 36e5) / 6e4),
                    Math.floor((left % 6e4) / 1000),
                ].map((v) => String(v).padStart(2, "0"));
                const timerHTML = `
                    <div class='counter_timer_div'>
                        <span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center timer_col'>
                            <div class='box_degit'>
                                <span id='days' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>${d}</span>
                                <span id='day_lbl' class='d-block'>DAYS</span>
                            </div>
                        </span>
                        <span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center timer_col'>
                            <div class='box_degit'>
                                <span id='hours' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>${h}</span>
                                <span id='h_lbl' class='d-block'>HOURS</span>
                            </div>
                        </span>
                        <span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center timer_col'>
                            <div class='box_degit'>
                                <span id='minutes' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>${m}</span>
                                <span id='m_lbl' class='d-block'>MINS</span>
                            </div>
                        </span>
                        <span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center timer_col'>
                            <div class='box_degit'>
                                <span id='seconds' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>${s}</span>
                                <span id='s_lbl' class='d-block'>SECS</span>
                            </div>
                        </span>
                    </div>
                `;
                timerElement.innerHTML = timerHTML;
            }
        }

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
}

// -------------------------------------------------
// Snippet Drop Plugin
// -------------------------------------------------
class DealOfDayBanner5SnippetPlugin extends Plugin {
    static id = "dealOfDayBanner5Snippet";
    static dependencies = ["history"];

    resources = {
        on_snippet_dropped_handlers: this.onSnippetDropped.bind(this),
    };

    async onSnippetDropped({ snippetEl }) {
        if (!snippetEl.classList.contains("deal_of_day_banner_5")) {
            return;
        }

        // open modal after drop
        await openDealOfDayBanner5Modal(snippetEl, () => this.dependencies.history.commit());
    }
}
registry.category("website-plugins").add(
    DealOfDayBanner5SnippetPlugin.id,
    DealOfDayBanner5SnippetPlugin
);

// -------------------------------------------------
// Modify Button Action: change the end date / message after the drop
// -------------------------------------------------
export class DealOfDayBanner5ModifyBtnAction extends BuilderAction {
    static id = "dealOfDayBanner5ModifyBtn";
    static dependencies = ["history"];

    apply({ editingElement, params: { mainParam } }) {
        if (mainParam === "open") {
            openDealOfDayBanner5Modal(editingElement, () => this.dependencies.history.commit());
        }
    }

    isApplied() {
        return false; // always allow reopen
    }
}

class DealOfDayBanner5ModifyPlugin extends Plugin {
    static id = "dealOfDayBanner5ModifyPlugin";

    resources = {
        builder_actions: {
            DealOfDayBanner5ModifyBtnAction,
        },
    };
}
registry.category("website-plugins").add(
    DealOfDayBanner5ModifyPlugin.id,
    DealOfDayBanner5ModifyPlugin
);
