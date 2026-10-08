import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { _t } from "@web/core/l10n/translation";

/**
 * Product page "Notify me when the price drops": the shopper picks any drop, a percentage
 * off or a price of their own. A signed-in shopper already following the selected variant
 * sees it ("You're watching") and can change or stop the alert.
 */
export class ScitaPriceAlert extends Interaction {
    static selector = ".o_scita_price_alert";
    dynamicContent = {
        ".o_scita_price_alert_toggle": {
            "t-on-click": this.onToggle,
            "t-att-aria-expanded": () => String(this.open),
            "t-att-class": () => ({ "d-none": !!this.alert }),
        },
        ".o_scita_price_alert_form": {
            "t-on-submit.prevent": this.locked(this.onSubmit, true),
            "t-att-class": () => ({ "d-none": !this.open }),
        },
        ".o_scita_price_alert_percent": {
            "t-on-focus": () => this.selectType("percent"),
            "t-on-change": () => this.selectType("percent"),
        },
        ".o_scita_price_alert_target": {
            "t-on-focus": () => this.selectType("target"),
            "t-on-input": () => {
                this.targetEdited = true; // keep the shopper's own price when the variant changes
                this.selectType("target");
            },
        },
        ".o_scita_price_alert_other_email": {
            "t-on-click": this.onOtherEmail,
        },
        ".o_scita_price_alert_watching": {
            "t-att-class": () => ({ "d-none": !this.alert || this.open }),
        },
        ".o_scita_price_alert_watching_text": {
            "t-out": () =>
                this.alert
                    ? this.alert.state === "pending"
                        ? _t("Check %(email)s to confirm your price alert.", { email: this.alert.email })
                        : _t("You're watching this price: we'll email you when it %(condition)s.", {
                              condition: this.alert.condition,
                          })
                    : "",
        },
        ".o_scita_price_alert_change": {
            "t-on-click": this.onChange,
        },
        ".o_scita_price_alert_stop": {
            "t-on-click": this.locked(this.onStop, true),
        },
    };

    setup() {
        this.open = false;
        this.alert = false;
        this.targetEdited = false;
        this.formEl = this.el.querySelector(".o_scita_price_alert_form");
        this.messageEl = this.el.querySelector(".o_scita_price_alert_message");
    }

    async willStart() {
        this.statusProductId = this._getProductId();
        if (this.el.dataset.signedIn) {
            // the price box is rendered for this variant: only the "watching" state is needed
            await this.loadStatus();
        }
    }

    start() {
        // website_sale keeps [data-product-id] in sync with the selected variant: follow it
        // (its price, the suggested "my price" and, signed in, the shopper's alert on it)
        const observer = new MutationObserver(() => {
            if (this._getProductId() !== this.statusProductId) {
                this.loadStatus().then(() => this.updateContent());
            }
        });
        observer.observe(this.el, { attributes: true, attributeFilter: ["data-product-id"] });
        this.registerCleanup(() => observer.disconnect());
    }

    async loadStatus() {
        const productId = this._getProductId();
        this.statusProductId = productId;
        if (!productId) {
            this.alert = false;
            return;
        }
        try {
            const result = await this.waitFor(rpc("/scita/price_alert/status", { product_id: productId }));
            if (productId !== this.statusProductId) {
                return; // another variant was picked meanwhile
            }
            this.alert = result.alert || false;
            this._updateTarget(result);
        } catch {
            this.alert = false;
        }
    }

    _updateTarget({ price, suggested_target: suggested, decimals }) {
        const targetEl = this.formEl.querySelector("input[name='target_price']");
        if (!targetEl || !(price > 0)) {
            return;
        }
        targetEl.max = price;
        if (!this.targetEdited && suggested > 0) {
            targetEl.value = suggested.toFixed(decimals ?? 2);
        }
    }

    selectType(type) {
        const radio = this.formEl.querySelector(`input[name='alert_type'][value='${type}']`);
        if (radio) {
            radio.checked = true;
        }
    }

    onToggle() {
        this.open = !this.open;
        if (this.open) {
            const emailEl = this.formEl.querySelector("input[name='email']");
            const checkedEl = this.formEl.querySelector("input[name='alert_type']:checked");
            this.waitForTimeout(() => (emailEl.value ? checkedEl || emailEl : emailEl).focus(), 0);
        }
    }

    onChange() {
        this.open = true;
        this._setMessage("", true);
        this.waitForTimeout(() => this.formEl.querySelector("input[name='alert_type']:checked")?.focus(), 0);
    }

    onOtherEmail() {
        this.formEl.querySelector(".o_scita_price_alert_email_info")?.classList.add("d-none");
        this.formEl.querySelector(".o_scita_price_alert_email_col")?.classList.remove("d-none");
        const emailEl = this.formEl.querySelector("input[name='email']");
        emailEl.select();
        emailEl.focus();
    }

    async onStop() {
        if (!this.alert) {
            return;
        }
        try {
            const result = await this.waitFor(rpc("/scita/price_alert/stop", { alert_id: this.alert.id }));
            if (result.ok) {
                this.alert = false;
                this.open = false;
            }
        } catch {
            // keep the alert shown: nothing changed
        }
    }

    _getProductId() {
        // website_sale's product page keeps every [data-product-id] of the product block in
        // sync with the selected variant, this element included
        return parseInt(this.el.dataset.productId) || false;
    }

    _setMessage(text, ok) {
        this.messageEl.textContent = text;
        this.messageEl.classList.toggle("text-success", !!ok);
        this.messageEl.classList.toggle("text-danger", !ok);
    }

    async onSubmit() {
        const formData = new FormData(this.formEl);
        const email = (formData.get("email") || "").trim();
        const alertType = formData.get("alert_type") || "target";
        const targetPrice = parseFloat(formData.get("target_price"));
        if (!email || !this.formEl.querySelector("input[name='email']").checkValidity()) {
            this.onOtherEmail();
            this._setMessage(_t("Please enter a valid email address."), false);
            return;
        }
        if (alertType === "target" && !(targetPrice > 0)) {
            this._setMessage(_t("Please enter the price you would pay."), false);
            return;
        }
        const productId = this._getProductId();
        if (!productId) {
            this._setMessage(_t("This product is not available."), false);
            return;
        }
        const submitBtn = this.formEl.querySelector(".o_scita_price_alert_submit");
        submitBtn.disabled = true;
        try {
            const result = await this.waitFor(
                rpc("/scita/price_alert/create", {
                    product_id: productId,
                    email,
                    alert_type: alertType,
                    drop_percent: formData.get("drop_percent"),
                    target_price: alertType === "target" ? targetPrice : null,
                    website_url: formData.get("website_url") || "",
                })
            );
            this._setMessage(result.message, result.ok);
            if (result.ok) {
                this.el.classList.add("o_scita_price_alert_done");
                if (result.alert) {
                    // signed in: the form closes on "You're watching this price"
                    this.alert = result.alert;
                    this.open = false;
                }
            }
        } catch {
            this._setMessage(_t("Something went wrong, please try again."), false);
        } finally {
            submitBtn.disabled = false;
        }
    }
}

registry.category("public.interactions").add("scita_smart_commerce.price_alert", ScitaPriceAlert);
