/** @odoo-module **/
import publicWidget from "@theme_scita/js/compat/public_widget";
import wSaleUtils from "@theme_scita/js/compat/website_sale_utils";
import { registry } from "@web/core/registry";
import { debounce } from "@web/core/utils/timing";
import { KeepLast } from "@web/core/utils/concurrency";
import { rpc } from "@web/core/network/rpc";

const WebsiteSale = publicWidget.registry.WebsiteSale;

publicWidget.registry.HeaderExtraMenuItems = publicWidget.Widget.extend({
    selector: 'header',
    events: {
        // 'click a#user_account': '_onCollapseShow',
        'click #user_account': '_onUserAccount',
        // Mega menus inside Odoo's "+" overflow menu: opened by Bootstrap + CSS
        // (product_card_equal_height.scss) and one at a time (extra_menu_megamenu.js).
        // The old slideToggle handlers here set inline display styles that fought with it.
        'click li.li-mega-menu i.fa-chevron-right': '_onClickSliderRight',
        'click li.li-mega-menu i.fa-chevron-left': '_onClickSliderLeft',
    },
    start() {
        // Sub Menus "On Hover": Odoo's HoverableDropdown opens every .dropdown of the header, and
        // in the user panel the pricelist and language menus then cover each other: click only
        this.el.querySelectorAll(".toggle-config").forEach((panelEl) => {
            for (const type of ["mouseenter", "mouseleave"]) {
                panelEl.addEventListener(type, (ev) => ev.stopPropagation(), true);
            }
        });
        return this._super.apply(this, arguments);
    },
    destroy() {
        this._closeUserPanel?.();
        this._super.apply(this, arguments);
    },
    // The panel stays open until a click on the icon or outside it, or Escape
    _onUserAccount() {
        if (this._closeUserPanel) {
            this._closeUserPanel();
            return;
        }
        const panelEl = this.el.querySelector(".toggle-config");
        panelEl.classList.remove("o_hidden");
        const onClick = (ev) => {
            if (!ev.target.closest("li.configuration")) {
                this._closeUserPanel();
            }
        };
        const onKeydown = (ev) => {
            if (ev.key === "Escape") {
                this._closeUserPanel();
            }
        };
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKeydown);
        this._closeUserPanel = () => {
            panelEl.classList.add("o_hidden");
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("keydown", onKeydown);
            this._closeUserPanel = null;
        };
    },
    _onClickSliderRight(event){
        event.stopImmediatePropagation();
    },
    _onClickSliderLeft(event){
        event.stopImmediatePropagation();
    }
});

// Category menu: its sub-categories open on hover, and a touch screen has none: the tap followed
// the link straight away. The first tap opens them, the second one follows the link.
publicWidget.registry.sct_category_touch = publicWidget.Widget.extend({
    selector: "li.ca-sub",
    start() {
        this._linkEl = this.el.querySelector(":scope > a");
        this._submenuEl = this.el.querySelector(":scope > .sct_submenu_level");
        this._onLinkClick = this._onLinkClick.bind(this);
        this._onDocumentClick = this._onDocumentClick.bind(this);
        this._linkEl?.addEventListener("click", this._onLinkClick);
        return this._super.apply(this, arguments);
    },
    destroy() {
        this._close();
        this._linkEl?.removeEventListener("click", this._onLinkClick);
        this._super.apply(this, arguments);
    },
    _onLinkClick(ev) {
        const touchMenu = window.matchMedia("(hover: none) and (min-width: 992px)").matches;
        if (!touchMenu || !this._submenuEl || this._opened) {
            return;
        }
        ev.preventDefault();
        document.dispatchEvent(new Event("sct_category_touch_close"));
        this._opened = true;
        this._submenuEl.style.display = "block";
        document.addEventListener("click", this._onDocumentClick, true);
        document.addEventListener("sct_category_touch_close", this._onDocumentClick);
    },
    _onDocumentClick(ev) {
        if (ev.type !== "click" || !this.el.contains(ev.target)) {
            this._close();
        }
    },
    _close() {
        if (!this._opened) {
            return;
        }
        this._opened = false;
        this._submenuEl.style.removeProperty("display");
        document.removeEventListener("click", this._onDocumentClick, true);
        document.removeEventListener("sct_category_touch_close", this._onDocumentClick);
    },
});

// Phones: Odoo keeps folded chat bubbles 45px from the bottom, on the account icon of Scita's bar.
// They live in the live chat's Shadow DOM, where page styles don't apply: the rule goes in there.
// 110px: above the bar and the back-to-top arrow.
publicWidget.registry.sct_livechat_lift = publicWidget.Widget.extend({
    selector: ".ab-mob-view",
    start() {
        this._liftBubbles();
        if (!this._lifted) {
            this._observer = new MutationObserver(() => this._liftBubbles());
            this._observer.observe(document.body, { childList: true });
        }
        return this._super.apply(this, arguments);
    },
    destroy() {
        this._observer?.disconnect();
        this._super.apply(this, arguments);
    },
    _liftBubbles() {
        const shadowRoot = document.querySelector(".o-livechat-root")?.shadowRoot;
        if (!shadowRoot) {
            return;
        }
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`@media (max-width: 767.98px) {
            .o-mail-ChatHub:not(.o-dragged) .o-mail-ChatHub-bubbles {
                --mail-ChatHub-bubbles-bottomLift: 110px !important;
            }
        }`);
        shadowRoot.adoptedStyleSheets.push(sheet);
        this._lifted = true;
        this._observer?.disconnect();
    },
});

publicWidget.registry.toggle_nav_menu = publicWidget.Widget.extend({
    selector: ".nav-items-icon",

    async start() {
        await this._super.apply(this, arguments);
        this._bindDelegatedEvents();
        this._bindEvents();
    },

    _bindEvents() {
        const self = this;
        // Delegated event for quantity change: one debounce per line, or changing two lines
        // quickly only saved the last one
        const lineChanges = {};
        $('body').off('change', '.scita_js_quantity').on('change', '.scita_js_quantity', function(ev) {
            ev.preventDefault();
            const lineId = ev.currentTarget.dataset.lineId;
            lineChanges[lineId] ||= debounce((lineEv) => self._onChangeQty(lineEv), 200);
            lineChanges[lineId](ev);
        });

        // Delegated event for remove line click
        $('body').off('click', '.sc-remove-line').on('click', '.sc-remove-line', function(ev) {
            ev.preventDefault();
            self._onRemoveLine(ev);
        });

        // only the sidebar cart's +/- (product pages and snippets have their own handlers)
        $('body').off('click', '.cart_details .js_add_cart_json').on('click', '.cart_details .js_add_cart_json', async function(ev) {
            ev.preventDefault();
            const $btn = $(this);
            const $input = $btn.siblings('input.scita_js_quantity');
            if (!$input.length) {
                console.warn('Quantity input not found near .js_add_cart_json button');
                return;
            }
            let currentQty = parseInt($input.val()) || 0;

            if ($btn.find('i.fa-minus').length) {
                currentQty = Math.max(0, currentQty - 1);
            } else if ($btn.find('i.fa-plus').length) {
                currentQty = currentQty + 1;
            }

            $input.val(currentQty).trigger('change');
        });
    },

    _bindDelegatedEvents() {
        const self = this;

        // Open cart sidebar (exclude compare links)
        $('body').off('click', '.nav-toggle-btn:not(.compare_link)').on('click', '.nav-toggle-btn:not(.compare_link)', async function(e) {
            e.preventDefault();
            $('#cstm-nav-menu-toggle').removeClass("o_hidden");
            $('body').addClass('show-scita-cstm-menu');
            self._reloadCartSidebar();
        });

        // Close cart sidebar
        $('body').off('click', '#close_cstm_nav_toggle').on('click', '#close_cstm_nav_toggle', function(e) {
            e.preventDefault();
            $('#cstm-nav-menu-toggle').addClass("o_hidden");
            $('body').removeClass('show-scita-cstm-menu');
        });
    },

    async _reloadCartSidebar() {
        try {
            // only the latest answer: an older one would show older quantities
            this._sidebarRequests ||= new KeepLast();
            const response = await this._sidebarRequests.add(rpc("/shop/cart/sidebar"));
            const html = response.html;

            const cartContainer = document.querySelector('.cart_details');
            if (cartContainer) {
                const parent = cartContainer.parentElement;
                cartContainer.remove();
                parent.insertAdjacentHTML('beforeend', html);
            }
        } catch (err) {
            console.error("Failed to reload cart sidebar:", err);
        }
    },


    async _onChangeQty(ev) {
        const $target = $(ev.currentTarget);
        const qty = parseInt($target.val());
        // Only send real changes: the input's value attribute still holds the quantity the
        // server rendered. A change event without a new number (e.g. fired again on a
        // re-rendered sidebar, or a cleared field) must never update - or delete - the line.
        const renderedQty = parseInt($target.attr("value"));
        if (isNaN(qty) || qty < 0 || qty === renderedQty) {
            if (!isNaN(renderedQty)) {
                $target.val(renderedQty);
            }
            return;
        }
        const priceUnit = parseFloat($target.data("price-unit"));
        const currencyId = $target.data("currency-id");
        const params = {
            product_id: $target.data("productId"),
            line_id: $target.data("lineId"),
            quantity: qty,
        };

        try {
            const data = await rpc("/shop/cart/update", params);
            this._refreshCart(data);
            this._reloadCartSidebar();
            if (data.cart_quantity === 0) {
                const cartContainer = document.querySelector('.scita_cart_lines');
                if (cartContainer) {
                    cartContainer.innerHTML = `
                        <div class="empty-cart-message text-center p-4">
                            <i class="fa fa-shopping-cart fa-3x mb-3 text-muted"></i>
                            <h5>Your cart is empty</h5>
                            <p>Looks like you haven’t added anything to your cart yet.</p>
                            <a href="/shop" class="btn btn-primary mt-2">Start Shopping</a>
                        </div>
                    `;
                }

                document.querySelector('.sc-cart-subtotal')?.remove();
                document.querySelector('.sc-cart-tax')?.remove();
                document.querySelector('.sc-cart-total')?.remove();
            }
        } catch (error) {
            console.error("Failed to update cart quantity:", error);
        }
    },

    _onRemoveLine(ev) {
        const lineId = ev.currentTarget.dataset.lineId;
        $(ev.currentTarget).closest('.input-group').find('.scita_js_quantity').val(0).trigger("change");
        const lineEl = document.querySelector(`#scita_sidebar_line_${lineId}`);
        if (lineEl) {
            lineEl.remove();
        }
        // this._reloadCartSidebar();
    },

   async _refreshCart(data) {
        data["cart_quantity"] = data.cart_quantity || 0;
        try {
            wSaleUtils.updateCartNavBar(data);
        } catch (err) {
            // console.warn("updateCartNavBar skipped because element not found:", err);
        }
    }
});

$(document).ready(function() {
    var offset = 300,
    offset_opacity = 1200,
    scroll_top_duration = 700,
    $back_to_top = $('.cd-top');
    // Odoo's comparison bar (products being compared) sticks to the bottom of the screen, or
    // stops mid-screen at the end of a short page: when the arrow would cover it (and its
    // "Compare" button), the arrow goes just above it
    var placeAboveCompareBar = function () {
        var arrow = $back_to_top[0];
        if (!arrow) {
            return;
        }
        arrow.style.bottom = '';
        var bar = document.querySelector('.o_wsale_comparison_bottom_bar');
        if (!bar || !arrow.classList.contains('cd-is-visible')) {
            return;
        }
        var barRect = bar.getBoundingClientRect();
        var arrowRect = arrow.getBoundingClientRect();
        if (barRect.height && arrowRect.bottom > barRect.top && arrowRect.top < barRect.bottom) {
            arrow.style.bottom = (window.innerHeight - barRect.top + 10) + 'px';
        }
    };
    //hide or show the "back to top" link
    $(window).on('scroll',function() {
        var scrollTop = document.scrollingElement.scrollTop;
        (scrollTop > offset) ? $back_to_top.addClass('cd-is-visible'): $back_to_top.removeClass('cd-is-visible cd-fade-out');
        if (scrollTop > offset_opacity) {
            $back_to_top.addClass('cd-fade-out');
        }
        placeAboveCompareBar();
    });
    $(window).on('resize', placeAboveCompareBar);
    // the comparison bar is drawn after the page (an Odoo component) and grows when its product
    // list unfolds: place the arrow again then, not only on scroll
    if ($back_to_top.length && window.MutationObserver && window.ResizeObserver) {
        var barResize = new ResizeObserver(placeAboveCompareBar);
        var isBar = function (node) {
            return node.nodeType === Node.ELEMENT_NODE && (node.matches('.o_wsale_comparison_bottom_bar')
                || node.querySelector('.o_wsale_comparison_bottom_bar'));
        };
        new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                var added = Array.prototype.some.call(records[i].addedNodes, isBar);
                if (added || Array.prototype.some.call(records[i].removedNodes, isBar)) {
                    var bar = document.querySelector('.o_wsale_comparison_bottom_bar');
                    if (bar) {
                        barResize.observe(bar);
                    }
                    placeAboveCompareBar();
                    return;
                }
            }
        }).observe(document.getElementById('wrapwrap') || document.body, {childList: true, subtree: true});
    }
    $back_to_top.on('click', function(event) {
        event.preventDefault();
        $(document.scrollingElement).animate({scrollTop: 0}, scroll_top_duration);
    });
});