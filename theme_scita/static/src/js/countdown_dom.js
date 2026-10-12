/** @odoo-module **/

/**
 * Deal countdowns tick every second. They used to remove and re-append their whole markup on
 * each tick, which made the browser restyle a large part of the page every second (about 0.8s
 * of main-thread work per tick on a mid-range phone). Build the markup once, then only change
 * the text of the four digits.
 */

const DAY = 864e5;
const HOUR = 36e5;
const MINUTE = 6e4;

/**
 * @param {number} toDate end of the countdown (ms since epoch)
 * @returns {string[]|null} ["DD", "HH", "MM", "SS"], or null once the countdown is over
 */
export function countdownParts(toDate) {
    const diff = toDate - Date.now();
    if (diff <= 0) {
        return null;
    }
    return [
        Math.floor(diff / DAY),
        Math.floor((diff % DAY) / HOUR),
        Math.floor((diff % HOUR) / MINUTE),
        Math.floor((diff % MINUTE) / 1000),
    ].map((n) => String(n).padStart(2, "0"));
}

/**
 * Show `values` in the `.counter_timer_div` child of `parentEl`, creating it with `markup(values)`
 * the first time (or if it isn't the 4-digit markup expected).
 *
 * @param {HTMLElement} parentEl
 * @param {string[]} values
 * @param {(values: string[]) => string} markup
 */
export function renderCountdown(parentEl, values, markup) {
    let boxEl = parentEl.querySelector(":scope > .counter_timer_div");
    const digitEls = boxEl ? boxEl.querySelectorAll(".d-count") : [];
    if (digitEls.length !== values.length) {
        boxEl?.remove();
        parentEl.insertAdjacentHTML("beforeend", markup(values));
        return;
    }
    digitEls.forEach((el, i) => {
        if (el.textContent !== values[i]) {
            el.textContent = values[i];
        }
    });
}
