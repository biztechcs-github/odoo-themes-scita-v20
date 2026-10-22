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
        this.result.replaceChildren(this.loading());
        let data;
        try {
            data = await this.waitFor(rpc("/scita/compare/explain", { product_ids: this.productIds }));
        } catch {
            data = { error: _t("Something went wrong. Please try again.") };
        }
        this.busy = false;
        this.result.replaceChildren();
        if (data.error) {
            this.result.append(this.el_("p", "o_scita_compare_ai_error", data.error));
            this.result.querySelector(".o_scita_compare_ai_error").setAttribute("role", "alert");
            return;
        }
        this.render(data.result || {}, data.products || [], data.names || {});
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

    /** Placeholder while the AI answers (a few seconds). */
    loading() {
        const wrap = this.el_("div", "o_scita_compare_ai_loading");
        wrap.append(this.el_("p", "o_scita_compare_ai_loading_text", _t("Comparing the products…")));
        for (let i = 0; i < 4; i++) {
            wrap.append(this.el_("span", "o_scita_compare_ai_bar"));
        }
        wrap.setAttribute("role", "status");
        return wrap;
    }

    /** A product's photo, name, price and rating (shop data, not the AI's). */
    productHead(product, tag = "th") {
        const head = this.el_(tag, "o_scita_compare_ai_product");
        if (tag === "th") {
            head.scope = "col";
        }
        const link = this.el_("a", "o_scita_compare_ai_product_link");
        link.href = product.url;
        const img = this.el_("img");
        img.src = product.image;
        img.alt = "";
        img.loading = "lazy";
        link.append(img, this.el_("span", "o_scita_compare_ai_product_name", product.name));
        head.append(link);
        if (product.price) {
            const price = this.el_("span", "o_scita_compare_ai_price", product.price);
            if (product.regular_price) {
                price.append(this.el_("del", "", product.regular_price));
            }
            head.append(price);
        }
        if (product.rating) {
            head.append(this.el_("span", "o_scita_compare_ai_rating",
                _t("★ %(average)s (%(reviews)s)", { average: product.rating.average, reviews: product.rating.reviews })));
        }
        return head;
    }

    render(result, products, names) {
        // the products of the answer, in the page's order (an old answer may lack them)
        if (!products.length) {
            products = Object.entries(names).map(([id, name]) => ({ id: parseInt(id), name, url: "#", image: "" }));
        }
        const wrap = this.el_("div", "o_scita_compare_ai_answer");
        if (result.summary) {
            const summary = this.el_("p", "o_scita_compare_ai_summary", result.summary);
            wrap.append(summary);
        }

        const differences = (result.differences || []).filter((diff) => diff.values && typeof diff.values === "object");
        if (differences.length) {
            wrap.append(this.el_("h3", "o_scita_compare_ai_subtitle", _t("Key differences")));
            const scroller = this.el_("div", "o_scita_compare_ai_table_wrap");
            const table = this.el_("table", "o_scita_compare_ai_table");
            const headRow = this.el_("tr");
            headRow.append(this.el_("td", "o_scita_compare_ai_corner"));
            products.forEach((product) => headRow.append(this.productHead(product)));
            const thead = this.el_("thead");
            thead.append(headRow);
            const tbody = this.el_("tbody");
            for (const diff of differences) {
                const row = this.el_("tr");
                const aspect = this.el_("th", "o_scita_compare_ai_aspect", diff.aspect);
                aspect.scope = "row";
                row.append(aspect);
                for (const product of products) {
                    row.append(this.el_("td", "", diff.values[product.id] || diff.values[String(product.id)] || "—"));
                }
                tbody.append(row);
            }
            table.append(thead, tbody);
            scroller.append(table);
            wrap.append(scroller);
        }

        const bestFor = (result.best_for || []).filter((item) => products.some((p) => p.id === item.product_id));
        if (bestFor.length) {
            wrap.append(this.el_("h3", "o_scita_compare_ai_subtitle", _t("Best for")));
            const grid = this.el_("div", "o_scita_compare_ai_best");
            for (const item of bestFor) {
                const product = products.find((p) => p.id === item.product_id);
                const card = this.el_("a", "o_scita_compare_ai_best_card");
                card.href = product.url;
                if (product.image) {
                    const img = this.el_("img");
                    img.src = product.image;
                    img.alt = "";
                    img.loading = "lazy";
                    card.append(img);
                }
                const text = this.el_("span", "o_scita_compare_ai_best_text");
                text.append(this.el_("strong", "", product.name), this.el_("span", "", item.reason));
                card.append(text);
                grid.append(card);
            }
            wrap.append(grid);
        }

        const footer = this.el_("div", "o_scita_compare_ai_footer");
        const missing = result.not_specified || [];
        if (missing.length) {
            const details = this.el_("details", "o_scita_compare_ai_missing");
            details.append(this.el_("summary", "", _t("Not in our product information (%s)", missing.length)));
            const list = this.el_("ul");
            missing.forEach((item) => list.append(this.el_("li", "", item)));
            details.append(list);
            footer.append(details);
        }
        footer.append(this.el_("p", "o_scita_compare_ai_note",
            _t("AI-generated summary based only on our product information. Please check the details before buying.")));
        wrap.append(footer);
        this.result.append(wrap);
    }
}

registry.category("public.interactions").add("scita_smart_commerce.compare_ai", ScitaCompareAi);
