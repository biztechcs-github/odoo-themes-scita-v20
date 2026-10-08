import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { _t } from "@web/core/l10n/translation";

export class ScitaCompareAi extends Interaction {
    static selector = ".o_scita_compare_ai";
    dynamicContent = {
        ".o_scita_compare_ai_btn": {
            "t-on-click": this.locked(this.explain, true),
            "t-att-disabled": () => this.busy,
        },
        ".o_scita_compare_ai_spinner": { "t-att-class": () => ({ "d-none": !this.busy }) },
    };

    setup() {
        this.busy = false;
        this.result = this.el.querySelector(".o_scita_compare_ai_result");
        try {
            this.productIds = JSON.parse(this.el.dataset.productIds || "[]");
        } catch {
            this.productIds = [];
        }
    }

    async explain() {
        this.busy = true;
        this.result.replaceChildren();
        let data;
        try {
            data = await this.waitFor(rpc("/scita/compare/explain", { product_ids: this.productIds }));
        } catch {
            data = { error: _t("Something went wrong. Please try again.") };
        }
        this.busy = false;
        if (data.error) {
            const alert = document.createElement("div");
            alert.className = "alert alert-warning mb-0";
            alert.setAttribute("role", "alert");
            alert.textContent = data.error;
            this.result.append(alert);
            return;
        }
        this.render(data.result || {}, data.names || {});
    }

    el_(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    render(result, names) {
        const wrap = this.el_("div", "o_scita_compare_ai_answer");
        if (result.summary) {
            wrap.append(this.el_("p", "lead fs-6 mb-3", result.summary));
        }
        const differences = result.differences || [];
        if (differences.length) {
            wrap.append(this.el_("h3", "h6 mb-2", _t("Key differences")));
            const list = this.el_("dl", "row mb-3");
            for (const diff of differences) {
                list.append(this.el_("dt", "col-sm-3", diff.aspect));
                list.append(this.el_("dd", "col-sm-9", diff.detail));
            }
            wrap.append(list);
        }
        const bestFor = (result.best_for || []).filter((b) => names[b.product_id]);
        if (bestFor.length) {
            wrap.append(this.el_("h3", "h6 mb-2", _t("Best for")));
            const list = this.el_("ul", "list-unstyled mb-3");
            for (const item of bestFor) {
                const li = this.el_("li", "mb-1");
                li.append(this.el_("strong", "", names[item.product_id]), document.createTextNode(" — " + item.reason));
                list.append(li);
            }
            wrap.append(list);
        }
        const missing = result.not_specified || [];
        if (missing.length) {
            wrap.append(
                this.el_("p", "small text-muted mb-2", _t("Not specified in our product information: %s", missing.join(", ")))
            );
        }
        wrap.append(
            this.el_("p", "small text-muted mb-0 fst-italic", _t("AI-generated summary based only on our product information. Please check the details before buying."))
        );
        this.result.append(wrap);
    }
}

registry.category("public.interactions").add("scita_smart_commerce.compare_ai", ScitaCompareAi);
