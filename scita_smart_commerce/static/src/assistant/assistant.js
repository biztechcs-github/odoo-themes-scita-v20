import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { browser } from "@web/core/browser/browser";
import { _t } from "@web/core/l10n/translation";

const HISTORY_KEY = "scita_assistant_history";
// bars that may be pinned to the bottom edge of the screen (see watchBottomBars)
const BOTTOM_BARS = [
    ".o_wsale_comparison_bottom_bar",
    ".ab-mob-view", // Theme Scita's mobile bottom navigation
    "#website_cookies_bar .modal-dialog, .o_cookies_bar_toggle",
    ".fixed-bottom",
    ".sticky-bottom",
].join(", ");
const OPEN_KEY = "scita_assistant_open";
const MAX_SENT_TURNS = 12;

/**
 * Minimal, safe formatting of an assistant reply: text is never parsed as HTML.
 * Supports **bold** and "- " / "* " bullet lines.
 */
export function formatReply(text) {
    const fragment = document.createDocumentFragment();
    let list = null;
    for (const rawLine of (text || "").split("\n")) {
        const line = rawLine.trimEnd();
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bullet) {
            if (!list) {
                list = document.createElement("ul");
                fragment.appendChild(list);
            }
            const li = document.createElement("li");
            appendInline(li, bullet[1]);
            list.appendChild(li);
            continue;
        }
        list = null;
        if (!line.trim()) {
            continue;
        }
        const p = document.createElement("p");
        appendInline(p, line);
        fragment.appendChild(p);
    }
    return fragment;
}

function appendInline(el, text) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
            const strong = document.createElement("strong");
            strong.textContent = part.slice(2, -2);
            el.appendChild(strong);
        } else if (part) {
            el.appendChild(document.createTextNode(part));
        }
    }
}

function readHistory() {
    try {
        const data = JSON.parse(browser.sessionStorage.getItem(HISTORY_KEY) || "[]");
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function updateCartBadges(cartQuantity) {
    browser.sessionStorage.setItem("website_sale_cart_quantity", cartQuantity);
    for (const el of document.querySelectorAll(".my_cart_quantity")) {
        el.textContent = cartQuantity;
        el.classList.toggle("d-none", !cartQuantity);
    }
    document.querySelector("li.o_wsale_my_cart")?.classList.remove("d-none");
}

export class ScitaAssistant extends Interaction {
    static selector = ".o_scita_assistant";
    dynamicContent = {
        ".o_scita_assistant_toggle": { "t-on-click": this.toggle },
        ".o_scita_assistant_close": { "t-on-click": this.close },
        ".o_scita_assistant_reset": { "t-on-click": this.reset },
        ".o_scita_assistant_form": { "t-on-submit.prevent": this.onSubmit },
        ".o_scita_assistant_input": { "t-on-keydown": this.onKeydown },
        ".o_scita_assistant_messages": { "t-on-click": this.onMessagesClick },
    };

    setup() {
        this.panel = this.el.querySelector(".o_scita_assistant_panel");
        this.toggleBtn = this.el.querySelector(".o_scita_assistant_toggle");
        this.messagesEl = this.el.querySelector(".o_scita_assistant_messages");
        this.input = this.el.querySelector(".o_scita_assistant_input");
        this.sendBtn = this.el.querySelector(".o_scita_assistant_send");
        this.history = readHistory();
        this.busy = false;
    }

    start() {
        this.renderMessages();
        if (browser.sessionStorage.getItem(OPEN_KEY) === "1") {
            this.open(false);
        }
        this.watchBottomBars();
    }

    /**
     * Stay above the bars pinned to the bottom of the screen (the comparison page's
     * "Back to shop / Remove all" bar, Scita's mobile navigation, a cookie banner...):
     * they would cover the button, or the message box of the open panel on phones.
     */
    watchBottomBars() {
        let frame = null;
        const update = () => {
            frame = null;
            const viewportHeight = window.innerHeight;
            let lift = 0;
            for (const bar of document.querySelectorAll(BOTTOM_BARS)) {
                if (bar.closest(".o_scita_assistant, .modal") || !bar.offsetParent && getComputedStyle(bar).position !== "fixed") {
                    continue;
                }
                const position = getComputedStyle(bar).position;
                if (position !== "fixed" && position !== "sticky") {
                    continue;
                }
                const rect = bar.getBoundingClientRect();
                if (!rect.height || rect.top >= viewportHeight || rect.bottom < viewportHeight - 2) {
                    continue; // not showing at the bottom edge right now
                }
                lift = Math.max(lift, viewportHeight - rect.top);
            }
            this.el.style.setProperty("--scita-assistant-lift", `${Math.round(lift)}px`);
        };
        const schedule = () => {
            if (frame === null) {
                frame = requestAnimationFrame(update);
            }
        };
        update();
        const scrollingEl = document.querySelector("#wrapwrap");
        this.addListener(window, "resize", schedule, { passive: true });
        this.addListener(window, "scroll", schedule, { passive: true });
        if (scrollingEl) {
            this.addListener(scrollingEl, "scroll", schedule, { passive: true });
        }
        // bars that come and go (cookie banner accepted, menu opened...)
        this.addListener(document, "click", () => setTimeout(schedule, 350));
        // the bars only get their final place once every stylesheet is applied: Theme Scita
        // loads part of its CSS after the page (async), which moves no element the other
        // listeners see, so measure again when the page has loaded and in the first seconds
        this.addListener(window, "load", schedule);
        for (const delay of [300, 1000, 2500, 5000]) {
            this.waitForTimeout(schedule, delay);
        }
        const observer = new ResizeObserver(schedule);
        observer.observe(document.body);
        // a stylesheet switched on (media="print" -> "all") or a bar added to the page
        const mutations = new MutationObserver(schedule);
        mutations.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["media"] });
        mutations.observe(document.body, { childList: true });
        this.registerCleanup(() => {
            mutations.disconnect();
            observer.disconnect();
            if (frame !== null) {
                cancelAnimationFrame(frame);
            }
        });
    }

    // ------------------------------------------------------------ panel

    toggle() {
        if (this.panel.classList.contains("d-none")) {
            this.open(true);
        } else {
            this.close();
        }
    }

    open(focus = true) {
        this.panel.classList.remove("d-none");
        this.el.classList.add("o_scita_assistant_is_open");
        this.toggleBtn.setAttribute("aria-expanded", "true");
        browser.sessionStorage.setItem(OPEN_KEY, "1");
        this.scrollToBottom();
        if (focus) {
            this.input.focus();
        }
    }

    close() {
        this.panel.classList.add("d-none");
        this.el.classList.remove("o_scita_assistant_is_open");
        this.toggleBtn.setAttribute("aria-expanded", "false");
        browser.sessionStorage.setItem(OPEN_KEY, "0");
        this.toggleBtn.focus();
    }

    reset() {
        this.history = [];
        this.saveHistory();
        this.renderMessages();
        this.input.focus();
    }

    onKeydown(ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            this.onSubmit();
        } else if (ev.key === "Escape") {
            this.close();
        }
    }

    // ------------------------------------------------------------ messages

    saveHistory() {
        browser.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(this.history.slice(-30)));
    }

    scrollToBottom() {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    renderMessages() {
        this.messagesEl.replaceChildren();
        const welcome = this.el.dataset.welcome;
        if (welcome) {
            this.messagesEl.appendChild(this.buildMessage({ role: "assistant", content: welcome }));
        }
        for (const message of this.history) {
            this.messagesEl.appendChild(this.buildMessage(message));
        }
        this.scrollToBottom();
    }

    buildMessage(message) {
        const wrapper = document.createElement("div");
        wrapper.className = `o_scita_assistant_msg o_scita_assistant_msg_${message.role}`;
        if (message.error) {
            wrapper.classList.add("o_scita_assistant_msg_error");
        }
        const bubble = document.createElement("div");
        bubble.className = "o_scita_assistant_bubble";
        if (message.role === "assistant") {
            bubble.appendChild(formatReply(message.content));
        } else {
            bubble.textContent = message.content;
        }
        wrapper.appendChild(bubble);
        if (message.products?.length) {
            wrapper.appendChild(this.buildCards(message.products));
        }
        return wrapper;
    }

    buildCards(products) {
        const list = document.createElement("div");
        list.className = "o_scita_assistant_cards";
        for (const product of products) {
            const card = document.createElement("div");
            card.className = "o_scita_assistant_card";

            const link = document.createElement("a");
            link.href = product.url;
            link.className = "o_scita_assistant_card_img";
            const img = document.createElement("img");
            img.src = product.image_url;
            img.alt = product.name;
            img.loading = "lazy";
            link.appendChild(img);
            card.appendChild(link);

            const body = document.createElement("div");
            body.className = "o_scita_assistant_card_body";
            const name = document.createElement("a");
            name.href = product.url;
            name.className = "o_scita_assistant_card_name";
            name.textContent = product.name;
            body.appendChild(name);

            const price = document.createElement("div");
            price.className = "o_scita_assistant_card_price";
            price.textContent = product.price_text || "";
            if (product.compare_price_text) {
                const del = document.createElement("del");
                del.className = "ms-1 text-muted";
                del.textContent = product.compare_price_text;
                price.appendChild(del);
            }
            body.appendChild(price);
            if (!product.in_stock && !product.hide_price) {
                const stock = document.createElement("div");
                stock.className = "o_scita_assistant_card_stock";
                stock.textContent = _t("Out of stock");
                body.appendChild(stock);
            }

            const actions = document.createElement("div");
            actions.className = "o_scita_assistant_card_actions";
            const view = document.createElement("a");
            view.href = product.url;
            view.className = "btn btn-sm btn-outline-primary";
            view.textContent = _t("View");
            actions.appendChild(view);
            if (product.in_stock && !product.hide_price) {
                const add = document.createElement("button");
                add.type = "button";
                add.className = "btn btn-sm btn-primary o_scita_assistant_add";
                add.dataset.productTemplateId = product.id;
                add.dataset.productId = product.product_id || "";
                add.dataset.hasVariants = product.has_variants ? "1" : "";
                add.dataset.url = product.url;
                add.textContent = _t("Add to cart");
                actions.appendChild(add);
            }
            body.appendChild(actions);
            card.appendChild(body);
            list.appendChild(card);
        }
        // ‹ › buttons (pointer devices; touch screens swipe): the mouse wheel scrolls the chat
        const strip = document.createElement("div");
        strip.className = "o_scita_assistant_cards_wrap";
        const arrow = (direction, label) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `o_scita_assistant_scroll o_scita_assistant_scroll_${direction}`;
            btn.dataset.direction = direction;
            btn.setAttribute("aria-label", label);
            btn.innerHTML = direction === "prev" ? "&#8249;" : "&#8250;";
            return btn;
        };
        const prev = arrow("prev", _t("Previous products"));
        const next = arrow("next", _t("Next products"));
        const updateArrows = () => {
            const max = list.scrollWidth - list.clientWidth;
            prev.disabled = list.scrollLeft <= 1;
            next.disabled = list.scrollLeft >= max - 1;
            strip.classList.toggle("o_scita_assistant_cards_scrollable", max > 1);
        };
        list.addEventListener("scroll", updateArrows, { passive: true });
        // sizes are only known once the cards are in the chat (and their images loaded)
        requestAnimationFrame(updateArrows);
        list.querySelectorAll("img").forEach((img) => img.addEventListener("load", updateArrows, { once: true }));
        strip.append(prev, list, next);
        return strip;
    }

    scrollCards(button) {
        const list = button.closest(".o_scita_assistant_cards_wrap").querySelector(".o_scita_assistant_cards");
        const card = list.querySelector(".o_scita_assistant_card");
        const step = card ? card.offsetWidth + 8 : list.clientWidth * 0.8;
        list.scrollBy({ left: button.dataset.direction === "prev" ? -step : step, behavior: "smooth" });
    }

    showTyping(show) {
        this.messagesEl.querySelector(".o_scita_assistant_typing")?.remove();
        if (show) {
            const typing = document.createElement("div");
            typing.className = "o_scita_assistant_msg o_scita_assistant_msg_assistant o_scita_assistant_typing";
            typing.setAttribute("aria-label", _t("The assistant is typing"));
            typing.innerHTML = '<div class="o_scita_assistant_bubble"><span></span><span></span><span></span></div>';
            this.messagesEl.appendChild(typing);
            this.scrollToBottom();
        }
    }

    setBusy(busy) {
        this.busy = busy;
        this.sendBtn.disabled = busy;
        this.input.readOnly = busy;
    }

    // ------------------------------------------------------------ actions

    async onSubmit() {
        const text = this.input.value.trim();
        if (!text || this.busy) {
            return;
        }
        this.input.value = "";
        this.history.push({ role: "user", content: text });
        this.saveHistory();
        this.messagesEl.appendChild(this.buildMessage({ role: "user", content: text }));
        this.setBusy(true);
        this.showTyping(true);
        const turns = this.history
            .filter((m) => !m.error)
            .slice(-MAX_SENT_TURNS)
            .map((m) => ({ role: m.role, content: m.content }));
        let result;
        try {
            result = await this.waitFor(rpc("/scita/assistant/chat", { messages: turns }));
        } catch {
            result = { error: _t("Something went wrong. Please try again.") };
        }
        this.protectSyncAfterAsync(() => {
            this.showTyping(false);
            this.setBusy(false);
            const message = result.error
                ? { role: "assistant", content: result.error, error: true }
                : { role: "assistant", content: result.reply, products: result.products || [] };
            this.history.push(message);
            this.saveHistory();
            this.messagesEl.appendChild(this.buildMessage(message));
            this.scrollToBottom();
            if (result.cart) {
                updateCartBadges(result.cart.cart_quantity);
            }
            this.input.focus();
        })();
    }

    async onMessagesClick(ev) {
        const arrowButton = ev.target.closest(".o_scita_assistant_scroll");
        if (arrowButton) {
            this.scrollCards(arrowButton);
            return;
        }
        const button = ev.target.closest(".o_scita_assistant_add");
        if (!button) {
            return;
        }
        button.disabled = true;
        try {
            await this.waitFor(
                this.services.cart.add({
                    productTemplateId: parseInt(button.dataset.productTemplateId),
                    // with variants, no product id: Odoo's product configurator opens in a
                    // dialog to choose them (the shopper stays in the chat)
                    productId: button.dataset.hasVariants
                        ? undefined
                        : parseInt(button.dataset.productId) || undefined,
                    quantity: 1,
                })
            );
        } finally {
            button.disabled = false;
        }
    }
}

registry.category("public.interactions").add("scita_smart_commerce.assistant", ScitaAssistant);
