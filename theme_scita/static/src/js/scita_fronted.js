/** @odoo-module **/

// import animation from "@website/js/content/snippets.animation";
import { _t } from "@web/core/l10n/translation";
import publicWidget from "@theme_scita/js/compat/public_widget";
import { rpc, RPCError } from '@web/core/network/rpc';
import { browser } from '@web/core/browser/browser';

// Result of /shop/cart/add on a product card (`widget`, button clicked): Scita's "added" modal
// opens only when the product really went in the cart, else the reason is shown (no stock...)
export function sctCartAddDone(widget, buttonEl, data) {
    const warning = data?.notifications?.find((item) => item.type === "warning")?.data.warning_message
        || (!(data?.quantity > 0) && _t("This product could not be added to your cart."));
    if (warning) {
        widget.services.notification.add(warning, { type: "warning" });
    }
    if (data?.quantity > 0 && buttonEl.classList.contains("cart_view_sct_btn")) {
        widget.cartViewData({ currentTarget: buttonEl });
    }
}

// /shop/cart/add refused (combo product, no variant, not allowed...). Only Odoo's own messages
// are for visitors, not the text of a crash.
export function sctCartAddFailed(widget, error) {
    const message = error?.exceptionName?.startsWith("odoo.exceptions")
        ? error.data.message
        : _t("This product could not be added to your cart.");
    widget.services.notification.add(message, { type: "danger" });
}

// Run `callback` once the window stopped resizing (after owl's own refresh), until `_stopResize`
function sctOnResize(widget, callback) {
    widget._stopResize?.();
    let timer;
    const onResize = () => {
        clearTimeout(timer);
        timer = setTimeout(callback, 300);
    };
    window.addEventListener("resize", onResize);
    widget._stopResize = () => {
        clearTimeout(timer);
        window.removeEventListener("resize", onResize);
    };
}

$(document).ready(function(){
    if($(".oe_website_sale").length === 0){
        $("div#wrap").addClass("oe_website_sale");
    }
    if($(".js_sale").length === 0){
        $("div#wrap").addClass("js_sale");
    }
    // a tile clicked in the editor is saved with "open": start from the first tile only
    $('.how_it_work_v_5 .sct_content_div').removeClass('open');
    $('.how_it_work_v_5 .sct_content_div:first-child').addClass('open');
    $('.how_it_work_v_5 .sct_content_div').on("click",function() {
        $(this).removeClass('open'); // Close others
        $(this).addClass('open').siblings().removeClass("open"); // Open current
    });
   
});
    // Start
    publicWidget.registry.oe_cat_slider = publicWidget.Widget.extend({

        selector: ".oe_cat_slider",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has category-slider-section)
            var hasRenderedContent = self.$target.find('.category-slider-section, .sct-cs-box').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var slider_id = self.$target.attr('data-cat-slider-id');
                var cat_name = _t("Category Slider");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.block-title h3, h3.fancy');
                if ($existingTitle.length) {
                    cat_name = $existingTitle.text().trim() || cat_name;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="block-title">
                            <h3 class="fancy">${cat_name}</h3>
                        </div>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/cat_slide_4.png" alt="Category Slider" class="img-fluid"/>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_id) {
                    self.$target.attr('data-cat-slider-id', slider_id);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_id = self.$target.attr('data-cat-slider-id');
                rpc("/theme_scita/category_get_dynamic_slider", {
                    'slider-id': self.$target.attr('data-cat-slider-id') || '',
                }).then(function(data) {
                    if (data) {
                        self.$target.empty();
                        self.$target.append(data);
                        $(".oe_cat_slider").removeClass('o_hidden');
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // End

    // Image Hotspot start
    publicWidget.registry.oe_img_hotspot = publicWidget.Widget.extend({

        selector: ".oe_img_hotspot",
        disabledInEditableMode: false,
        start: function() {
            var self = this;
            if (this.editableMode) {
                var $cate_slider = $('#wrapwrap').find('#theme_scita_custom_image_hotspot');
                var cat_name = _t("Image Hotspot")
                $cate_slider.each(function(){

                    $(this).empty().append('<div class="container">\
                                                    <div class="block-title">\
                                                        <h3 class="fancy">' + cat_name + '</h3>\
                                                    </div>\
                                                </div>')
                });
            }
            if (!this.editableMode) {
                var slider_id = self.$target.attr('data-cat-slider-id');
                rpc("/theme_scita/get_image_hotspot", {
                    'slider-id': self.$target.attr('data-img-hotspot-id') || '',
                }).then(function(data) {
                    if (data) {
                        self.$target.empty();
                        self.$target.append(data);
                        $('[data-bs-toggle="popover"]').popover();
                        self._keepPopoverOpenOnHover();
                        $(".oe_img_hotspot").removeClass('o_hidden');
                    }
                });
            }
        },
        // The popover holds the product's links, but it closed as soon as the pointer left the dot.
        // It now stays open while the pointer is on it (the dots' hide delay covers the gap).
        _keepPopoverOpenOnHover: function() {
            this.el.querySelectorAll(".ripple-btn").forEach((dotEl) => {
                const popover = Popover.getOrCreateInstance(dotEl);
                dotEl.addEventListener("hide.bs.popover", (ev) => {
                    if (popover.tip?.matches(":hover")) {
                        ev.preventDefault();
                    }
                });
                dotEl.addEventListener("shown.bs.popover", () => {
                    popover.tip.onmouseleave = () => setTimeout(() => {
                        if (!dotEl.matches(":hover") && document.activeElement !== dotEl) {
                            popover.hide();
                        }
                    }, 200);
                });
            });
        },
    });
    //End

    // Start
    publicWidget.registry.fashion_multi_cat_custom_snippet = publicWidget.Widget.extend({ 

        selector: ".fashion_multi_category_slider",
        disabledInEditableMode: false,
        events: {
            "mouseenter .scita_attribute_li": "_onMouseEnterSwatch",
            "mouseleave .css_attribute_color": "_onMouseLeave",
            "click .js_add_cart": "_onClickAddToCart",
            'click .cart_view_sct_btn:not(.js_add_cart)': 'cartViewData',
            "click .js_add_cart_json": "_onClickUpdateQty",
        },
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has fashion product slider content)
            var hasRenderedContent = self.$target.find('.fashion_featured_product_1, .fashion_cro, .owl-carousel, .cs-product, .pwp-img, .lns-inner, .latest-news-section').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var slider_type = self.$target.attr('data-multi-cat-slider-type');
                var multi_cat_name = _t("Multi Product Slider");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.title-block h2, .title-block h4, h2.section-title, h4.section-title, .section-title');
                if ($existingTitle.length) {
                    multi_cat_name = $existingTitle.text().trim() || multi_cat_name;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="row our-categories">
                            <div class="col-md-12">
                                <div class="title-block">
                                    <h4 id="snippet-title" class="section-title style1"><span>${multi_cat_name}</span></h4>
                                </div>
                                <div class="category-slider-placeholder">
                                    <img src="/theme_scita/static/src/img/feature-product.webp" alt="Multi Product Slider" class="img-fluid"/>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_type) {
                    self.$target.attr('data-multi-cat-slider-type', slider_type);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_type = self.$target.attr('data-multi-cat-slider-type');
                rpc("/fashion/fashion_product_multi_get_dynamic_slider", {
                    'slider-type': self.$target.attr('data-multi-cat-slider-type') || '',
                }).then(function(data) {
                    if (data && data.trim()) {
                        self.$target.empty();
                        self.$target.append(data);
                        $(".fashion_multi_category_slider").removeClass('o_hidden');
                        var sct_rtl = false;
                        if ($('#wrapwrap').hasClass('o_rtl')) {
                            sct_rtl = true;
                        }
                        // var WebsiteSale = new publicWidget.registry.WebsiteSale();
                        // WebsiteSale.init();
                        rpc('/theme_scita/product_multi_image_effect_config', {
                            'slider_type': slider_type
                        }).then(function(res) {
                            $('div.fashion_featured_product_1 .fashion_cro ').owlCarousel({
                                loop:false,
                                rewind:true,
                                dots:false,
                                autoplay: false,
                                autoplayTimeout:res.auto_play_time,
                                autoplayHoverPause:true,
                                margin:0,
                                items: 5,
                                rtl: sct_rtl,
                                responsive: {
                                    0: {
                                        items: 1,
                                    },
                                    375: {
                                        items: 2,
                                        margin: 0
                                    },
                                    767: {
                                        items: 3,
                                    },
                                    1000: {
                                        items: 4,
                                    },
                                    1600: {
                                        items: 5,
                                    },
                                },
                            });
                        });
                       
                        $(document).on('click', '.dropdown-plus', function(ev){
                                ev.stopPropagation();
                                ev.stopImmediatePropagation();
                                $(ev.currentTarget).next().toggleClass("o_hidden")
                            });
                        
                        var fitImages = function() {
                            var divWidth = $('.fashion_featured_product_1 .cs-product .pwp-img a').width();
                            if (divWidth == 0) {
                                divWidth = $('.retail_featured_product_1 .cs-product .pwp-img a:visible').width();
                            }
                            $('.fashion_featured_product_1 .cs-product .pwp-img a').height(divWidth);
                        };
                        $(document).ajaxComplete(function() {
                            setTimeout(fitImages, 100);
                        });
                        sctOnResize(self, fitImages);
                    }
                });
            }
        },
        cartViewData: function (ev) {
                const element = ev.currentTarget;
                const product_id = $(element).attr('data-id');
                rpc('/theme_scita/shop/cart_view', { product_id }).then(function (data) {
                    if (!data) {
                        return;
                    }
                    $("#shop_cart_view_modal").html(data).modal("show");
                });
            },
        
            // 🛒 ADD TO CART BUTTON (main "Add" button)
            _onClickAddToCart: function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            
                const $btn = $(ev.currentTarget);
                const $cartWrapper = $btn.closest(".ajax_cart_template");
                const $qtyInput = $cartWrapper.find("input.quantity");
                
                const $productIDInput = $cartWrapper.find("input[name='product_id']");
                const productID = parseInt($productIDInput.val()); 
                const productTemplateID = parseInt($btn.data("templateId"));
                const addQuantity = Math.max(1, parseInt($qtyInput.val()) || 1);

                const self = this;
                // one add at a time: a double click must not add the product twice
                if ($btn.data("sctAdding")) {
                    return;
                }
                $btn.data("sctAdding", true);

                // /shop/cart/add merges into an existing line. No Odoo "added to cart" popup:
                // Scita's own confirmation (cartViewData) opens once the product is in the cart.
                rpc("/shop/cart/add", {
                    product_id: productID,
                    product_template_id: productTemplateID,
                    quantity: addQuantity,
                }).then((data) => {
                    if (data && data.cart_quantity) {
                        self._updateCartIcon(data.cart_quantity);
                    }
                    sctCartAddDone(self, $btn[0], data);
                }).catch((err) => {
                    sctCartAddFailed(self, err);
                }).finally(() => {
                    $btn.data("sctAdding", false);
                });
            },

            
            _updateCartIcon: function (cartQuantity) {
                browser.sessionStorage.setItem('website_sale_cart_quantity', cartQuantity);
            
                // Update mobile and desktop cart quantities
                const cartQuantityElements = document.querySelectorAll('.my_cart_quantity, .o_wsale_my_cart_quantity');
                for (const cartQuantityElement of cartQuantityElements) {
                    if (cartQuantity === 0) {
                        cartQuantityElement.classList.add('d-none');
                    } else {
                        const cartIconElement = document.querySelector('li.o_wsale_my_cart');
                        if (cartIconElement) {
                            cartIconElement.classList.remove('d-none');
                        }
                        cartQuantityElement.classList.remove('d-none');
                        cartQuantityElement.classList.add('o_mycart_zoom_animation');
            
                        setTimeout(() => {
                            cartQuantityElement.textContent = cartQuantity;
                            cartQuantityElement.classList.remove('o_mycart_zoom_animation');
                        }, 300);
                    }
                }
            },

            _trackProducts(trackingInfo) {
                document.querySelector('.oe_website_sale').dispatchEvent(
                    new CustomEvent('add_to_cart_event', {'detail': trackingInfo})
                );
            },

            _onClickUpdateQty: function (ev) {
                ev.preventDefault();
                const $btn = $(ev.currentTarget);
                const $qtyInput = $btn.closest('.input-group').find('input.quantity');
            
                let qty = parseInt($qtyInput.val()) || 1;
                qty += $btn.attr('aria-label') === 'Remove one' ? -1 : 1;
            
                if (qty < 1) qty = 1;
                $qtyInput.val(qty).trigger('change');
            },

        _onMouseEnterSwatch: function (ev) {
            const $swatch = $(ev.currentTarget);
            const $product = $swatch.closest('.cs-product');
            const $img = $product.find('img').first();            
            this.image= $img;
        
            this.defaultSrc = $img.attr('data-default-img-src');
            const $element = $swatch.find('label, a.css_attribute_color').first();
            const previewSrc = $element.data('previewImgSrc');
            
            if (previewSrc) {
                this._updateImgSrc(previewSrc, $img);
                $swatch.addClass("active");
            }
        },
        
        _onMouseLeave: function () {
             this._updateImgSrc(this.defaultSrc,this.image);
        },
        
        _updateImgSrc: function (src, $img) {
            if ($img && src) {
                $img.attr('src', src);
            } else {
                console.warn("Image element or source is missing.");
            }
        },
        
        destroy: function() {
            if (this._stopResize) {
                this._stopResize();
            }
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    //End

    // Start
    publicWidget.registry.brands_box_slider_4 = publicWidget.Widget.extend({ 
        selector: ".box_brand_slider",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has box_brand_snippet_4 or brand-logo-box)
            var hasRenderedContent = self.$target.find('.box_brand_snippet_4, .brand-logo-box, .sct-brand-slider-2').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder && self.el._sctSample) {
                var brand_type = self.$target.attr('data-brand-config-type');
                var brand_id = self.$target.attr('data-brand-config-id');
                // Restore the block's sample (kept before the live content replaced it)
                self.$target.html(self.el._sctSample);
                
                // Restore attributes
                if (brand_type) {
                    self.$target.attr('data-brand-config-type', brand_type);
                }
                if (brand_id) {
                    self.$target.attr('data-brand-config-id', brand_id);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                // the editor shows this sample again (_restorePlaceholder)
                self.el._sctSample = self.el._sctSample || self.$target.html();
                var slider_type = self.$target.attr('data-brand-config-type');
                rpc("/shop/get_box_brand_slider", {
                    'slider-type': slider_type || '',
                }).then(function(data) {
                    if (data && data.trim()) {
                        self.$target.empty().append(data);
                        var sct_rtl = false;
                        if ($('#wrapwrap').hasClass('o_rtl')) {
                            sct_rtl = true;
                        }
                        $(".box_brand_slider").removeClass('o_hidden');
                        $('.sct-brand-slider-2').owlCarousel({
                            margin: 10,
                            items:6,
                            loop:false,
                            autoplay:true,
                            rewind:true,
                            dots:false,
                            autoplayTimeout:5000,
                            autoplayHoverPause:true,
                            rtl: sct_rtl,
                            responsive: {
                                0: {
                                    items: 2
                                },
                                480: {
                                    items: 3
                                },
                                768: {
                                    items: 4
                                },
                                1024: {
                                    items: 6
                                },
                                1500: {
                                    items: 7
                                },
                            },
                        });
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    //End

    // Start
    publicWidget.registry.it_prod_brands = publicWidget.Widget.extend({ 
        selector: ".it_brand_slider",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has it_brand_snippet_1 or brand-logo)
            var hasRenderedContent = self.$target.find('.it_brand_snippet_1, .brand-logo, .it_brand_border').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var brand_type = self.$target.attr('data-brand-config-type');
                var brand_id = self.$target.attr('data-brand-config-id');
                var titleText = _t("Brands");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.title-block h2, .section-title, h3.section-title');
                if ($existingTitle.length) {
                    titleText = $existingTitle.text().trim() || titleText;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="row our-brands">
                            <div class="col-md-12">
                                <h3 class="section-title style1" id="snippet-title">
                                    <span>${titleText}</span>
                                </h3>
                                <div class="category-slider-placeholder">
                                    <img src="/theme_scita/static/src/img/brand1.png" alt="Category Slider" class="img-fluid"/>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (brand_type) {
                    self.$target.attr('data-brand-config-type', brand_type);
                }
                if (brand_id) {
                    self.$target.attr('data-brand-config-id', brand_id);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_type = self.$target.attr('data-brand-config-type');
                rpc("/shop/get_it_brand", {
                    'slider-type': slider_type || '',
                }).then(function(data) {
                    if (data && data.trim()) {
                        self.$target.empty();
                        self.$target.empty().append(data);
                        $(".it_brand_slider").removeClass('o_hidden');
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    //End 

    // Start
    publicWidget.registry.theme_scita_blog_custom_snippet = publicWidget.Widget.extend({ 
        selector: ".scita_blog_slider",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has blog content)
            var hasRenderedContent = self.$target.find('.it_blogs, .sct_top_row, .sct_mid_row').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var slider_type = self.$target.attr('data-blog-slider-type');
                var blog_name = _t("Blog Slider");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.block-title h2, .block-title h3, h2.section-title, h3.fancy');
                if ($existingTitle.length) {
                    blog_name = $existingTitle.text().trim() || blog_name;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="block-title">
                            <h3 class="fancy">${blog_name}</h3>
                        </div>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/blog1.png" alt="Blog Slider" class="img-fluid"/>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_type) {
                    self.$target.attr('data-blog-slider-type', slider_type);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_type = self.$target.attr('data-blog-slider-type');
                rpc("/theme_scita/blog_get_dynamic_slider", {
                    'slider-type': self.$target.attr('data-blog-slider-type') || '',
                }).then(function(data) {
                    if (data) {
                        self.$target.empty();
                        self.$target.append(data);
                        $(".scita_blog_slider").removeClass('hidden');
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // End

    // Start
    publicWidget.registry.blog_2_custom_snippet = publicWidget.Widget.extend({ 
        selector: ".blog_2_custom",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has blog content)
            var hasRenderedContent = self.$target.find('.owl-carousel, .sct_blog_box, #blog_2_owl_carosel').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var slider_type = self.$target.attr('data-blog-slider-type');
                var blog_name = _t("Blog Slider");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.block-title h2, .block-title h3, h2.fancy, h3.fancy');
                if ($existingTitle.length) {
                    blog_name = $existingTitle.text().trim() || blog_name;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="block-title">
                            <h2 class="fancy">${blog_name}</h2>
                        </div>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/blog2.png" alt="Blog Slider" class="img-fluid"/>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_type) {
                    self.$target.attr('data-blog-slider-type', slider_type);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_type = self.$target.attr('data-blog-slider-type');
                rpc("/theme_scita/second_blog_get_dynamic_slider", {
                    'slider-type': self.$target.attr('data-blog-slider-type') || '',
                }).then(function(data) {
                    if (data) {
                        self.$target.empty();
                        self.$target.append(data);
                        var sct_rtl = false;
                        if ($('#wrapwrap').hasClass('o_rtl')) {
                            sct_rtl = true;
                        }
                        $(".blog_2_custom").removeClass('hidden');
                        rpc('/theme_scita/blog_image_effect_config', {
                            'slider_type': slider_type
                        }).then(function(res) {
                            self.$target.find('#blog_2_owl_carosel').owlCarousel({
                                margin: 30,
                                items: 4,
                                loop: false,
                                dots:false,
                                autoplay: res.auto_rotate,
                                autoplayTimeout:res.auto_play_time,
                                autoplayHoverPause:true,
                                rtl: sct_rtl,
                                nav: false,
                                rewind:true,
                                responsive: {
                                    0: {
                                        items: 1,
                                    },
                                    768: {
                                        items: 2,
                                    },
                                    992: {
                                        items: 3,
                                    },
                                    1400: {
                                        items: 4,
                                    }
                                },
                            });
                        });
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // End
    
    // Start
    publicWidget.registry.blog_4_custom_snippet = publicWidget.Widget.extend({ 
        selector: ".blog_4_custom",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has blog content)
            var hasRenderedContent = self.$target.find('.news_4_blogs, .sct_base_class, .sct_info_class').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var slider_type = self.$target.attr('data-blog-slider-type');
                var blog_name = _t("Blog Slider");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.block-title h2, .block-title h3, h2.section-title, h3.fancy');
                if ($existingTitle.length) {
                    blog_name = $existingTitle.text().trim() || blog_name;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="block-title">
                            <h2 class="fancy">${blog_name}</h2>
                        </div>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/blog3.png" alt="Blog Slider" class="img-fluid"/>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_type) {
                    self.$target.attr('data-blog-slider-type', slider_type);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_type = self.$target.attr('data-blog-slider-type');
                rpc("/theme_scita/forth_blog_get_dynamic_slider", {
                    'slider-type': self.$target.attr('data-blog-slider-type') || '',
                }).then(function(data) {
                    if (data) {
                        self.$target.empty();
                        self.$target.append(data);
                        $(".blog_4_custom").removeClass('hidden');
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // End

    // Start
    publicWidget.registry.blog_5_custom_snippet = publicWidget.Widget.extend({ 
        selector: ".blog_5_custom",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has blog content)
            var hasRenderedContent = self.$target.find('.owl-carousel, .sct_blog_box, #blog_5_owl_carosel, .blog_slider_wrap').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var slider_type = self.$target.attr('data-blog-slider-type');
                var blog_name = _t("Blog Slider");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.block-title h2, .block-title h3, h2.fancy, h3.fancy, h3.sct_sub_title');
                if ($existingTitle.length) {
                    blog_name = $existingTitle.text().trim() || blog_name;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="block-title">
                            <h2 class="fancy">${blog_name}</h2>
                        </div>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/blog4.png" alt="Blog Slider" class="img-fluid"/>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_type) {
                    self.$target.attr('data-blog-slider-type', slider_type);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_type = self.$target.attr('data-blog-slider-type');
                rpc("/theme_scita/fifth_blog_get_dynamic_slider", {
                    'slider-type': self.$target.attr('data-blog-slider-type') || '',
                }).then(function(data) {
                    if (data) {
                        self.$target.empty();
                        self.$target.append(data);
                        var sct_rtl = false;
                        if ($('#wrapwrap').hasClass('o_rtl')) {
                            sct_rtl = true;
                        }
                        $(".blog_5_custom").removeClass('hidden');
                        rpc('/theme_scita/blog_image_effect_config', {
                            'slider_type': slider_type
                        }).then(function(res) {
                            self.$target.find('#blog_5_owl_carosel').owlCarousel({
                                margin: 45,
                                items: 3,
                                loop: false,
                                dots:false,
                                rewind:true,
                                autoplay: res.auto_rotate,
                                autoplayTimeout:res.auto_play_time,
                                autoplayHoverPause:true,
                                nav: false,
                                rtl: sct_rtl,
                                responsive: {
                                    0: {
                                        items: 1,
                                    },
                                    576: {
                                        items: 2,
                                    },
                                    992: {
                                        items: 3,
                                    },
                                    1500: {
                                        items: 4,
                                    }
                                },
                            });
                        });
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // End

    // Testimonial Slider 2 saved before its indicators were fixed still point them at
    // #myCarousel1557120239396, which doesn't exist: aim them at their own carousel.
    publicWidget.registry.sct_testimonial_indicators = publicWidget.Widget.extend({
        selector: ".testinomial_varient_2 .carousel[id]",

        start: function () {
            for (const indicatorEl of this.el.querySelectorAll(".carousel-indicators [data-bs-target]")) {
                if (indicatorEl.dataset.bsTarget === "#myCarousel1557120239396") {
                    indicatorEl.dataset.bsTarget = `#${this.el.id}`;
                }
            }
            return this._super.apply(this, arguments);
        },
    });

    // Client sliders 2 Start
    publicWidget.registry.third_client_slider_snippet = publicWidget.Widget.extend({ 
        selector: ".testimonial-client-slider",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has client content)
            var hasRenderedContent = self.$target.find('.sct_client_wrap, .sct_client_box, .sct_client_not').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var titleText = _t("Our Partners");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.closest('section').find('.sct_test_title');
                if ($existingTitle.length) {
                    var title = $existingTitle.text().trim();
                    if (title && title !== "Testimonials") {
                        titleText = title;
                    }
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="category-slider-placeholder">
                        <img src="/theme_scita/static/src/img/third_client_slider.png" alt="Client Slider" class="img-fluid"/>
                    </div>
                `);
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                rpc("/theme_scita/third_get_clients_dynamically_slider", {}).then(function(data) {
                    if (data) {
                        self.$target.empty();
                        self.$target.append(data);
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // Client sliders 2 End
    
    // Our Team Start
    publicWidget.registry.it_our_team = publicWidget.Widget.extend({ 
        selector: ".our_team_1",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has team slider content)
            var hasRenderedContent = self.$target.find('.sct_team_slider, .owl-carousel, .myourteam, .image-container, .v-3-image-container, .v-5-image-container').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder && self.el._sctSample) {
                var titleText = _t("Our Awesome Team");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.closest('section').find('.section-title');
                if ($existingTitle.length) {
                    var title = $existingTitle.text().trim();
                    if (title) {
                        titleText = title;
                    }
                }
                
                // Restore placeholder structure
                self.$target.html(self.el._sctSample);
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                // the editor shows this sample again (_restorePlaceholder)
                self.el._sctSample = self.el._sctSample || self.$target.html();
                rpc("/biztech_emp_data_one/employee_data", {}).then(function(data) {
                    self.$target.empty();
                    self.$target.append(data);
                    var sct_rtl = false;
                    if ($('#wrapwrap').hasClass('o_rtl')) {
                        sct_rtl = true;
                    }
                    self.$target.find('#myourteam').owlCarousel({
                        loop:false,
                        margin:30,
                        nav:false,
                        items:4,
                        dots:false,
                        rewind:true,
                        autoplay:true,
                        autoplayTimeout:4000,
                        autoplayHoverPause:true,
                        autoHeight: false,
                        rtl: sct_rtl,
                        responsive:{
                            0:{
                                items:1
                            },
                            600:{
                                items:2
                            },
                            992:{
                                items:3
                            },
                            1200:{
                                items:4
                            }
                        }
                    });
                })
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // Our Team End

    // Start
    publicWidget.registry.our_team_varient_3 = publicWidget.Widget.extend({ 
        selector: ".our_team_3",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has team slider content)
            var hasRenderedContent = self.$target.find('.sct_team_slider, .owl-carousel, .v_3_myourteam, .v-3-image-container').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder && self.el._sctSample) {
                var titleText = _t("Our Team");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.closest('section').find('.section-title');
                if ($existingTitle.length) {
                    var title = $existingTitle.text().trim();
                    if (title) {
                        titleText = title;
                    }
                }
                
                // Restore placeholder structure
                self.$target.html(self.el._sctSample);
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                // the editor shows this sample again (_restorePlaceholder)
                self.el._sctSample = self.el._sctSample || self.$target.html();
                rpc("/biztech_emp_data_three/employee_data", {}).then(function(data) {
                    self.$target.empty();
                    self.$target.append(data);
                    var sct_rtl = false;
                    if ($('#wrapwrap').hasClass('o_rtl')) {
                        sct_rtl = true;
                    }
                    self.$target.find('#v_3_myourteam').owlCarousel({
                        loop:false,
                        margin:30,
                        nav:false,
                        items:3,
                        dots:false,
                        rewind:true,
                        autoplay:true,
                        autoplayTimeout:4000,
                        autoplayHoverPause:true,
                        autoHeight: false,
                        rtl: sct_rtl,
                        responsive:{
                            0:{
                                items:1
                            },
                            576:{
                                items:2
                            },
                            992:{
                                items:3
                            },
                            1400:{
                                items:4
                            }
                        }
                    });
                })
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // End

    // Start
    publicWidget.registry.our_team_varient_5 = publicWidget.Widget.extend({ 
        selector: ".our_team_5",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has team slider content)
            var hasRenderedContent = self.$target.find('.sct_team_slider, .owl-carousel, .v_5_myourteam, .v-5-image-container').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder && self.el._sctSample) {
                var titleText = _t("Meet Our Team");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.closest('section').find('.section-title');
                if ($existingTitle.length) {
                    var title = $existingTitle.text().trim();
                    if (title) {
                        titleText = title;
                    }
                }
                
                // Restore placeholder structure
                self.$target.html(self.el._sctSample);
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                // the editor shows this sample again (_restorePlaceholder)
                self.el._sctSample = self.el._sctSample || self.$target.html();
                rpc("/biztech_emp_data_five/employee_data", {}).then(function(data) {
                    self.$target.empty();
                    self.$target.append(data);
                    var sct_rtl = false;
                    if ($('#wrapwrap').hasClass('o_rtl')) {
                        sct_rtl = true;
                    }
                    self.$target.find('#v_5_myourteam').owlCarousel({
                        loop:false,
                        margin:30,
                        nav:false,
                        items:4,
                        autoplay:false,
                        rewind:true,
                        autoplayTimeout:4000,
                        autoplayHoverPause:true,
                        dots:false,
                        autoHeight: false,
                        rtl: sct_rtl,
                        responsive:{
                            0:{
                                items:1
                            },
                            600:{
                                items:2
                            },
                            768:{
                                items:3
                            },
                            992:{
                                items:4
                            }
                        }
                    });
                })
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // End

    // Start
    publicWidget.registry.cat_slider_3 = publicWidget.Widget.extend({ 
        selector: ".cat_slider_3",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has owl-carousel or category-slider-section)
            var hasRenderedContent = self.$target.find('.owl-carousel, .category-slider, .section-title-wrapper').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var slider_id = self.$target.attr('data-cat-slider-id');
                var cat_name = _t("Category Slider");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.section-title-wrapper h2, .section-title, .block-title h3');
                if ($existingTitle.length) {
                    cat_name = $existingTitle.text().trim() || cat_name;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="block-title">
                            <h3 class="fancy">${cat_name}</h3>
                        </div>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/cat_slide_1.webp" alt="Category Slider" class="img-fluid"/>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_id) {
                    self.$target.attr('data-cat-slider-id', slider_id);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_id = self.$target.attr('data-cat-slider-id');
                rpc("/theme_scita/category_slider_3",{
                    'slider-id': self.$target.attr('data-cat-slider-id') || '',
                }).then(function(data) {
                    if (data) {
                        self.$target.empty();
                        self.$target.append(data);
                        var sct_rtl = false;
                        if ($('#wrapwrap').hasClass('o_rtl')) {
                            sct_rtl = true;
                        }
                        $(".cat_slider_3").removeClass('o_hidden');
                        $('div#carousel_category').owlCarousel({
                            loop:false,
                            margin:30,
                            nav:true,
                            autoplay:true,
                            rewind:true,
                            dots:false,
                            autoplayTimeout:2500,
                            autoplayHoverPause:true,
                            rtl: sct_rtl,
                            responsive:{
                                0:{
                                    items:2
                                },
                                767:{
                                    items:4
                                },
                                992:{
                                    items:5
                                },
                                1200:{
                                    items:6
                                },
                                1400:{
                                    items:7
                                }
                            }
                        })
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // End

    // Start
    publicWidget.registry.cat_slider_4 = publicWidget.Widget.extend({ 
        selector: ".cat_slider_4",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has owl-carousel or category-slider-section)
            var hasRenderedContent = self.$target.find('.owl-carousel, .category-slider, .title-block').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var slider_id = self.$target.attr('data-cat-slider-id');
                var cat_name = _t("Category Slider");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.title-block h2, .section-title, .block-title h3');
                if ($existingTitle.length) {
                    cat_name = $existingTitle.text().trim() || cat_name;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="block-title">
                            <h3 class="fancy">${cat_name}</h3>
                        </div>
                        <div class="category-slider-placeholder">
                            <img src="/theme_scita/static/src/img/cat_slide_2.png" alt="Category Slider" class="img-fluid"/>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_id) {
                    self.$target.attr('data-cat-slider-id', slider_id);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_id = self.$target.attr('data-cat-slider-id');
                rpc("/theme_scita/category_slider_4", {
                    'slider-id': self.$target.attr('data-cat-slider-id') || '',
                }).then(function(data) {
                    if (data) {
                        self.$target.empty();
                        self.$target.append(data);
                        var sct_rtl = false;
                        if ($('#wrapwrap').hasClass('o_rtl')) {
                            sct_rtl = true;
                        }
                        $(".cat_slider_4").removeClass('o_hidden');
                        $('div#cat_slider_4_owl').owlCarousel({
                            loop:false,
                            nav:false,
                            autoplay:true,
                            rewind:true,
                            dots:false,
                            autoplayTimeout:2500,
                            autoplayHoverPause:true,
                            rtl: sct_rtl,
                            responsive:{
                                0:{
                                    items:2,
                                    margin:25,
                                },
                                767:{
                                    items:3,
                                    margin:35,
                                },
                                992:{
                                    items:4,
                                    margin:35,
                                },
                                1400:{
                                    items:6,
                                    margin:40,
                                }
                            }
                        })
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // End

    // Start
    publicWidget.registry.sct_product_snippet_1 = publicWidget.Widget.extend({ 
            selector: ".sct_product_snippet_1",
            disabledInEditableMode: false,
            events: {
                "mouseenter .scita_attribute_li": "_onMouseEnterSwatch",
                "mouseleave .css_attribute_color": "_onMouseLeave",
                "click .js_add_cart": "_onClickAddToCart",
                'click .cart_view_sct_btn:not(.js_add_cart)': 'cartViewData',
                "click .js_add_cart_json": "_onClickUpdateQty",
            },
            
            _restorePlaceholder: function() {
                var self = this;
                // Only restore placeholder in editable mode (like brand snippet)
                if (!this.editableMode) {
                    return;
                }
                
                // Check if this is rendered content (has product content)
                var hasRenderedContent = self.$target.find('.sct-snippet-full, .grid_product, .cs-product, .pwp-img, .pwd-desc').length > 0;
                var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
                
                // In editable mode, always restore placeholder if we have rendered content
                // This ensures the HTML editor sees the placeholder, not the full rendered content (like brand snippet)
                if (hasRenderedContent) {
                    var slider_type = self.$target.attr('data-multi-cat-slider-type');
                    var slider_id = self.$target.attr('data-multi-cat-slider-id');
                    var titleText = _t("Product Configuration");
                    
                    // Get title from rendered content if exists
                    var $existingTitle = self.$target.find('.section-title, h2.section-title, h4.section-title');
                    if ($existingTitle.length) {
                        var title = $existingTitle.first().text().trim();
                        if (title) {
                            titleText = title;
                        }
                    }
                    
                    // keep the Content Width chosen in the editor (the rendered content carries it)
                    var widthClass = self._contentWidthClass();
                    // Restore placeholder structure (exact match to template structure like brand snippet)
                    self.$target.html(`
                        <div class="${widthClass}">
                            <div class="row our-config-products">
                                <div class="col-md-12">
                                    <div class="title-block">
                                        <h4 id="snippet-title" class="section-title style1">
                                            <span>${titleText}</span>
                                        </h4>
                                        <div class="category-slider-placeholder">
                                            <img src="/theme_scita/static/src/img/sct-product-snippet.png" alt="Product Snippet" class="img-fluid"/>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `);
                    
                    // Restore attributes
                    if (slider_type) {
                        self.$target.attr('data-multi-cat-slider-type', slider_type);
                    }
                    if (slider_id) {
                        self.$target.attr('data-multi-cat-slider-id', slider_id);
                    }
                }
            },
            
            start: function() {
                var self = this;
                if (this.editableMode) {
                    // Restore placeholder immediately when in editable mode (like brand snippet)
                    self._restorePlaceholder();
                    
                    // Also listen for when body gets editor_enable class (editable mode enabled)
                    var checkEditableMode = function() {
                        if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                            // Restore placeholder immediately when editor is enabled (like brand snippet)
                            self._restorePlaceholder();
                        }
                    };
                    
                    // Check immediately and multiple times to catch timing issues (like brand snippet)
                    setTimeout(function() { self._restorePlaceholder(); }, 0);
                    setTimeout(checkEditableMode, 10);
                    setTimeout(function() { self._restorePlaceholder(); }, 50);
                    setTimeout(checkEditableMode, 50);
                    setTimeout(function() { self._restorePlaceholder(); }, 100);
                    setTimeout(checkEditableMode, 100);
                    
                    // Also check when DOM changes (in case editable mode is enabled later)
                    if (typeof MutationObserver !== 'undefined') {
                        var observer = new MutationObserver(function(mutations) {
                            // Check if editor_enable class was added
                            if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                                self._restorePlaceholder();
                            }
                        });
                        observer.observe(document.body, {
                            attributes: true,
                            attributeFilter: ['class'],
                            subtree: true
                        });
                        this._observer = observer;
                    }
                }
                if (!this.editableMode) {
                    // Get slider type from data attribute or custom template data
                    var slider_type = self.$target.attr('data-multi-cat-slider-type') || 
                                    self.$target.attr('data-custom-template-data') || '';
                    
                    // Try to parse custom_template_data if it's JSON
                    if (!slider_type && self.$target.attr('data-custom-template-data')) {
                        try {
                            var customData = JSON.parse(self.$target.attr('data-custom-template-data'));
                            slider_type = customData['slider-type'] || customData.slider_type || '';
                        } catch(e) {
                            // Not JSON, use as-is
                        }
                    }
                    
                    if (slider_type) {
                        // Use rpc for Odoo 19 compatible route
                        rpc("/product_column_five", {
                            'slider-type': slider_type,
                        }).then(function(response) {
                            // the HTML, or {html: ...}. Nothing to show (no products, configuration
                            // deleted...): the block stays empty, see dynamic_block_empty.js
                            var html = (response && response.html) || response;
                            if (typeof html === 'string' && html.trim()) {
                                self._injectContent(html);
                            }
                        }).catch(function(error) {
                            console.error('Error loading product snippet data:', error);
                        });
                    }
                }
            },
            // Odoo's Content Width option class of the block's container: placeholder (saved page)
            // or rendered content
            _contentWidthClass: function() {
                var $c = this.$target.children('div').add(this.$target.find('.sct-snippet-full > div'))
                    .filter('.container, .container-fluid, .o_container_small').first();
                return ['container-fluid', 'o_container_small'].find((c) => $c.hasClass(c)) || 'container';
            },
            _injectContent: function(html) {
                var self = this;
                // For Odoo 19 dynamic snippet structure
                var $dynamicContent = self.$target.find('.dynamic_snippet_template');
                if ($dynamicContent.length) {
                    $dynamicContent.html(html);
                    self.$target.removeClass('o_dynamic_snippet_empty');
                } else {
                    // Legacy structure - replace entire content
                    // The rendered HTML has a fixed .container: give it the Content Width chosen
                    // in the editor (saved on the placeholder's container), or the option does nothing
                    var widthClass = self._contentWidthClass();
                    self.$target.empty();
                    self.$target.append(html);
                    self.$target.find('.sct-snippet-full > .container')
                        .removeClass('container').addClass(widthClass);
                }
                
                $(".sct_product_snippet_1").removeClass('hidden');
                var fitImages = function(){
                    var $imgLinks = $('.sct_product_snippet_1 .cs-product .pwp-img a');
                    if ($imgLinks.length) {
                        var divWidth = $imgLinks.first().width(); 
                        $imgLinks.height(divWidth);
                    }
                };
                setTimeout(fitImages, 400);
                sctOnResize(self, fitImages);
            },
            cartViewData: function (ev) {
                    const element = ev.currentTarget;
                    const product_id = $(element).attr('data-id');
                    rpc('/theme_scita/shop/cart_view', { product_id }).then(function (data) {
                        if (!data) {
                            return;
                        }
                        $("#shop_cart_view_modal").html(data).modal("show");
                    });
                },
            
                // 🛒 ADD TO CART BUTTON (main "Add" button)
                _onClickAddToCart: function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                
                    const $btn = $(ev.currentTarget);
                    const $cartWrapper = $btn.closest(".ajax_cart_template");
                    const $qtyInput = $cartWrapper.find("input.quantity");
                    
                    const $productIDInput = $cartWrapper.find("input[name='product_id']");
                    const productID = parseInt($productIDInput.val()); 
                    const productTemplateID = parseInt($btn.data("templateId"));
                    const addQuantity = Math.max(1, parseInt($qtyInput.val()) || 1);

                    const self = this;
                    // one add at a time: a double click must not add the product twice
                    if ($btn.data("sctAdding")) {
                        return;
                    }
                    $btn.data("sctAdding", true);

                    // /shop/cart/add merges into an existing line. No Odoo "added to cart" popup:
                    // Scita's own confirmation (cartViewData) opens once the product is in the cart.
                    rpc("/shop/cart/add", {
                        product_id: productID,
                        product_template_id: productTemplateID,
                        quantity: addQuantity,
                    }).then((data) => {
                        if (data && data.cart_quantity) {
                            self._updateCartIcon(data.cart_quantity);
                        }
                        sctCartAddDone(self, $btn[0], data);
                    }).catch((err) => {
                        sctCartAddFailed(self, err);
                    }).finally(() => {
                        $btn.data("sctAdding", false);
                    });
                },

                _updateCartIcon: function (cartQuantity) {
                    browser.sessionStorage.setItem('website_sale_cart_quantity', cartQuantity);
                
                    // Update mobile and desktop cart quantities
                    const cartQuantityElements = document.querySelectorAll('.my_cart_quantity, .o_wsale_my_cart_quantity');
                    for (const cartQuantityElement of cartQuantityElements) {
                        if (cartQuantity === 0) {
                            cartQuantityElement.classList.add('d-none');
                        } else {
                            const cartIconElement = document.querySelector('li.o_wsale_my_cart');
                            if (cartIconElement) {
                                cartIconElement.classList.remove('d-none');
                            }
                            cartQuantityElement.classList.remove('d-none');
                            cartQuantityElement.classList.add('o_mycart_zoom_animation');
                
                            setTimeout(() => {
                                cartQuantityElement.textContent = cartQuantity;
                                cartQuantityElement.classList.remove('o_mycart_zoom_animation');
                            }, 300);
                        }
                    }
                },

                _trackProducts(trackingInfo) {
                    document.querySelector('.oe_website_sale').dispatchEvent(
                        new CustomEvent('add_to_cart_event', {'detail': trackingInfo})
                    );
                },

                _onClickUpdateQty: function (ev) {
                    ev.preventDefault();
                    const $btn = $(ev.currentTarget);
                    const $qtyInput = $btn.closest('.input-group').find('input.quantity');
                
                    let qty = parseInt($qtyInput.val()) || 1;
                    qty += $btn.attr('aria-label') === 'Remove one' ? -1 : 1;
                
                    if (qty < 1) qty = 1;
                    $qtyInput.val(qty).trigger('change');
                },

        _onMouseEnterSwatch: function (ev) {
            const $swatch = $(ev.currentTarget);
            const $product = $swatch.closest('.cs-product');
            const $img = $product.find('img').first();            
            this.image= $img;
        
            this.defaultSrc = $img.attr('data-default-img-src');        
            const previewSrc = $swatch.find('label').data('previewImgSrc');
            
            if (previewSrc) {
                this._updateImgSrc(previewSrc, $img);
                $swatch.addClass("active");
            }
        },
        
        _onMouseLeave: function () {
             this._updateImgSrc(this.defaultSrc,this.image);
        },
        
        _updateImgSrc: function (src, $img) {        
            if ($img && src) {
                $img.attr('src', src);
            } else {
                console.warn("Image element or source is missing.");
            }
        },
        
        destroy: function() {
            if (this._stopResize) {
                this._stopResize();
            }
            // Clean up observer if it exists (like brand snippet)
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        },
    });

    // Snippet 2 Widget - Replica of sct_product_snippet_1 with separate backend
    publicWidget.registry.sct_product_snippet_2 = publicWidget.Widget.extend({ 
            selector: ".sct_product_snippet_2",
            disabledInEditableMode: false,
            events: {
                "mouseenter .scita_attribute_li": "_onMouseEnterSwatch",
                "mouseleave .css_attribute_color": "_onMouseLeave",
                "click .js_add_cart": "_onClickAddToCart",
                'click .cart_view_sct_btn:not(.js_add_cart)': 'cartViewData',
                "click .js_add_cart_json": "_onClickUpdateQty",
            },
            
            _restorePlaceholder: function() {
                var self = this;
                // Check if this is rendered content (has product content)
                var hasRenderedContent = self.$target.find('.sct-snippet-full, .grid_product, .cs-product, .pwp-img, .pwd-desc').length > 0;
                var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
                
                // Only restore if we have rendered content and no placeholder
                if (hasRenderedContent && !hasPlaceholder) {
                    var slider_type = self.$target.attr('data-multi-cat-slider-type');
                    var slider_id = self.$target.attr('data-multi-cat-slider-id');
                    var titleText = _t("Product Configuration");
                    
                    // Get title from rendered content if exists
                    var $existingTitle = self.$target.find('.section-title, h2.section-title, h4.section-title');
                    if ($existingTitle.length) {
                        var title = $existingTitle.first().text().trim();
                        if (title) {
                            titleText = title;
                        }
                    }
                    
                    // Restore placeholder structure
                    self.$target.html(`
                        <div class="container">
                            <div class="row our-config-products">
                                <div class="col-md-12">
                                    <div class="title-block">
                                        <h4 id="snippet-title" class="section-title style1">
                                            <span>${titleText}</span>
                                        </h4>
                                        <div class="category-slider-placeholder">
                                            <img src="/theme_scita/static/src/img/img_cat_slider.jpg" alt="Product Snippet" class="img-fluid"/>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `);
                    
                    // Restore attributes
                    if (slider_type) {
                        self.$target.attr('data-multi-cat-slider-type', slider_type);
                    }
                    if (slider_id) {
                        self.$target.attr('data-multi-cat-slider-id', slider_id);
                    }
                }
            },
            
            start: function() {
                var self = this;
                if (this.editableMode) {
                    // Restore placeholder when in editable mode
                    self._restorePlaceholder();
                    
                    // Also listen for when body gets editor_enable class (editable mode enabled)
                    var checkEditableMode = function() {
                        if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                            self._restorePlaceholder();
                        }
                    };
                    
                    // Check immediately
                    setTimeout(checkEditableMode, 100);
                    
                    // Also check when DOM changes (in case editable mode is enabled later)
                    if (typeof MutationObserver !== 'undefined') {
                        var observer = new MutationObserver(function(mutations) {
                            checkEditableMode();
                        });
                        observer.observe(document.body, {
                            attributes: true,
                            attributeFilter: ['class'],
                            subtree: true
                        });
                        this._observer = observer;
                    }
                }
                if (!this.editableMode) {
                    // Get slider type from data attribute or custom template data
                    var slider_type = self.$target.attr('data-multi-cat-slider-type') || 
                                    self.$target.attr('data-custom-template-data') || '';
                    
                    // Try to parse custom_template_data if it's JSON
                    if (!slider_type && self.$target.attr('data-custom-template-data')) {
                        try {
                            var customData = JSON.parse(self.$target.attr('data-custom-template-data'));
                            slider_type = customData['slider-type'] || customData.slider_type || '';
                        } catch(e) {
                            // Not JSON, use as-is
                        }
                    }
                    
                    if (slider_type) {
                        // Use rpc for Odoo 19 compatible route
                        rpc("/product_column_five_two", {
                            'slider-type': slider_type,
                        }).then(function(response) {
                            // the HTML, or {html: ...}. Nothing to show (no products, configuration
                            // deleted...): the block stays empty, see dynamic_block_empty.js
                            var html = (response && response.html) || response;
                            if (typeof html === 'string' && html.trim()) {
                                self._injectContent(html);
                            }
                        }).catch(function(error) {
                            console.error('Error loading product snippet 2 data:', error);
                        });
                    }
                }
            },
            _injectContent: function(html) {
                var self = this;
                // For Odoo 19 dynamic snippet structure
                var $dynamicContent = self.$target.find('.dynamic_snippet_template');
                if ($dynamicContent.length) {
                    $dynamicContent.html(html);
                    self.$target.removeClass('o_dynamic_snippet_empty');
                } else {
                    // Legacy structure - replace entire content
                    self.$target.empty();
                    self.$target.append(html);
                }
                
                $(".sct_product_snippet_2").removeClass('hidden');
                var fitImages = function(){
                    var $imgLinks = $('.sct_product_snippet_2 .cs-product .pwp-img a');
                    if ($imgLinks.length) {
                        var divWidth = $imgLinks.first().width(); 
                        $imgLinks.height(divWidth);
                    }
                };
                setTimeout(fitImages, 400);
                sctOnResize(self, fitImages);
            },
            cartViewData: function (ev) {
                    const element = ev.currentTarget;
                    const product_id = $(element).attr('data-id');
                    rpc('/theme_scita/shop/cart_view', { product_id }).then(function (data) {
                        if (!data) {
                            return;
                        }
                        $("#shop_cart_view_modal").html(data).modal("show");
                    });
                },
            
                // 🛒 ADD TO CART BUTTON (main "Add" button)
                _onClickAddToCart: function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                
                    const $btn = $(ev.currentTarget);
                    const $cartWrapper = $btn.closest(".ajax_cart_template");
                    const $qtyInput = $cartWrapper.find("input.quantity");
                    
                    const $productIDInput = $cartWrapper.find("input[name='product_id']");
                    const productID = parseInt($productIDInput.val()); 
                    const productTemplateID = parseInt($btn.data("templateId"));
                    const addQuantity = Math.max(1, parseInt($qtyInput.val()) || 1);

                    const self = this;
                    // one add at a time: a double click must not add the product twice
                    if ($btn.data("sctAdding")) {
                        return;
                    }
                    $btn.data("sctAdding", true);

                    // /shop/cart/add merges into an existing line. No Odoo "added to cart" popup:
                    // Scita's own confirmation (cartViewData) opens once the product is in the cart.
                    rpc("/shop/cart/add", {
                        product_id: productID,
                        product_template_id: productTemplateID,
                        quantity: addQuantity,
                    }).then((data) => {
                        if (data && data.cart_quantity) {
                            self._updateCartIcon(data.cart_quantity);
                        }
                        sctCartAddDone(self, $btn[0], data);
                    }).catch((err) => {
                        sctCartAddFailed(self, err);
                    }).finally(() => {
                        $btn.data("sctAdding", false);
                    });
                },

                _updateCartIcon: function (cartQuantity) {
                    browser.sessionStorage.setItem('website_sale_cart_quantity', cartQuantity);
                
                    // Update mobile and desktop cart quantities
                    const cartQuantityElements = document.querySelectorAll('.my_cart_quantity, .o_wsale_my_cart_quantity');
                    for (const cartQuantityElement of cartQuantityElements) {
                        if (cartQuantity === 0) {
                            cartQuantityElement.classList.add('d-none');
                        } else {
                            const cartIconElement = document.querySelector('li.o_wsale_my_cart');
                            if (cartIconElement) {
                                cartIconElement.classList.remove('d-none');
                            }
                            cartQuantityElement.classList.remove('d-none');
                            cartQuantityElement.classList.add('o_mycart_zoom_animation');
                
                            setTimeout(() => {
                                cartQuantityElement.textContent = cartQuantity;
                                cartQuantityElement.classList.remove('o_mycart_zoom_animation');
                            }, 300);
                        }
                    }
                },

                _trackProducts(trackingInfo) {
                    document.querySelector('.oe_website_sale').dispatchEvent(
                        new CustomEvent('add_to_cart_event', {'detail': trackingInfo})
                    );
                },

                _onClickUpdateQty: function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation(); // Prevent global handler from interfering
                    const $btn = $(ev.currentTarget);
                    
                    // Check if button is inside .dropdown-plus (initial plus icon)
                    const $clickedElement = $btn.closest('.js_add_cart_json');
                    const $dropdownPlus = $clickedElement.closest('.dropdown-plus');
                    
                    if ($dropdownPlus.length) {
                        // Check if this is the initial plus icon (not the one inside quantity field)
                        const hasAriaLabel = $clickedElement.attr('aria-label');
                        if (!hasAriaLabel) {
                            // This is the initial plus icon - toggle the quantity field
                            const $qtyContainer = $dropdownPlus.next('.dropdown-plus-out');
                            if ($qtyContainer.length) {
                                const $qtyInput = $qtyContainer.find('input.quantity');
                                const isHidden = $qtyContainer.hasClass('o_hidden');
                                $qtyContainer.toggleClass('o_hidden', !isHidden);

                                if (isHidden && $qtyInput.length && !$qtyInput.val()) {
                                    // Set initial quantity to 1 when showing the field for the first time
                                    $qtyInput.val(1);
                                }
                                return; // Toggle only; do not update qty
                            }
                        }
                    }
                    
                    // Normal quantity update logic (for plus/minus buttons inside quantity field)
                    const $cartWrapper = $btn.closest('.ajax_cart_template, .cart_wrapper');
                    const $qtyInput = $cartWrapper.length 
                        ? $cartWrapper.find('input.quantity')
                        : $btn.closest('.input-group').find('input.quantity');
                
                    if (!$qtyInput.length) {
                        return; // Quantity input not found
                    }
                
                    let qty = parseInt($qtyInput.val()) || 1;
                    const ariaLabel = $clickedElement.attr('aria-label');
                    qty += ariaLabel === 'Remove one' ? -1 : 1;
                
                    if (qty < 1) qty = 1;
                    $qtyInput.val(qty).trigger('change');
                },

        _onMouseEnterSwatch: function (ev) {
            const $swatch = $(ev.currentTarget);
            const $product = $swatch.closest('.cs-product');
            const $img = $product.find('img').first();            
            this.image= $img;
        
            this.defaultSrc = $img.attr('data-default-img-src');        
            const previewSrc = $swatch.find('label').data('previewImgSrc');
            
            if (previewSrc) {
                this._updateImgSrc(previewSrc, $img);
                $swatch.addClass("active");
            }
        },
        
        _onMouseLeave: function () {
             this._updateImgSrc(this.defaultSrc,this.image);
        },
        
        _updateImgSrc: function (src, $img) {        
            if ($img && src) {
                $img.attr('src', src);
            } else {
                console.warn("Image element or source is missing.");
            }
        },
        
        destroy: function() {
            if (this._stopResize) {
                this._stopResize();
            }
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        },
    });
    
    // // Dynamic Video banner js start
    // animation.registry.dynamic_video_banner = animation.Class.extend({
    publicWidget.registry.dynamic_video_banner = publicWidget.Widget.extend({ 
        selector: ".dynamic_video_banner",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has video tag or rendered video content)
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Restore when the placeholder is gone: the video was rendered, or (pages saved
            // with the old rendering) an empty section was nested in the block, which left it
            // 0px high in the editor, impossible to select
            if (!hasPlaceholder) {
                var video_url = self.$target.attr('data-video-url');
                var titleText = _t("Video Banner");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.section-title, h3, h4');
                if ($existingTitle.length) {
                    var title = $existingTitle.text().trim();
                    if (title) {
                        titleText = title;
                    }
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="container">
                        <div class="row sct-video-row">
                            <div class="col-md-12">
                                <h3 class="section-title style1" id="snippet-title">
                                    <span>${titleText}</span>
                                </h3>
                                <div class="category-slider-placeholder">
                                    <img src="/theme_scita/static/src/img/scita-placeholder.png" alt="Video Banner" class="img-fluid"/>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (video_url) {
                    self.$target.attr('data-video-url', video_url);
                }
            }
        },
        
        start: function() {
            var self = this;
            // a block nested in another one (old rendering, see _restorePlaceholder): the outer
            // block replaces its content
            if (this.$target.parent().closest('.dynamic_video_banner').length) {
                return this._super.apply(this, arguments);
            }
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            var video_url = self.$target.attr('data-video-url');
            // no video chosen yet: keep the placeholder (the empty video section that comes back
            // otherwise collapsed the block to 0px, and in the editor it could not be selected)
            if (!this.editableMode && video_url) {
                $.get("/video/video_url_get", {
                    'video_url': video_url,
                }).then(function(data) {
                    if (data) {
                        // the block keeps its height until the video knows its size (a video
                        // without metadata is 150px high: the page under it moved up, then down)
                        var targetEl = self.$target[0];
                        targetEl.style.minHeight = targetEl.offsetHeight + 'px';
                        self.$target.empty().append(data);
                        self.$target.removeClass('o_hidden');
                        var videoEl = targetEl.querySelector('video');
                        var release = function () {
                            targetEl.style.minHeight = '';
                        };
                        if (videoEl && videoEl.readyState < 1) {
                            videoEl.addEventListener('loadedmetadata', release, { once: true });
                            videoEl.addEventListener('error', release, { once: true });
                            setTimeout(release, 10000);
                        } else {
                            release();
                        }
                    }
                });
            }
        },
        
        destroy: function() {
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // Dynamic Video banner js End

    // Dynamic Top Dealers Snippet Start
    publicWidget.registry.dynamic_top_dealers = publicWidget.Widget.extend({ 
            selector: ".oe_top_dealers_section",
            disabledInEditableMode: false,
            
            _restorePlaceholder: function() {
                var self = this;
                // Check if this is rendered content (has dealers content)
                var hasRenderedContent = self.$target.find('.dealers-block-wrapper, .dealers-block, .dealers-block-inner').length > 0;
                var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
                
                // Only restore if we have rendered content and no placeholder
                if (hasRenderedContent && !hasPlaceholder) {
                    var dealer_name = _t("Top Dealers");
                    
                    // Get title from rendered content if exists
                    var $existingTitle = self.$target.find('.section-title-wrapper h2, h2.section-title, h3.fancy');
                    if ($existingTitle.length) {
                        dealer_name = $existingTitle.text().trim() || dealer_name;
                    }
                    
                    // Restore placeholder structure
                    self.$target.html(`
                        <div class="container">
                           <div class="section-title-wrapper d-flex flex-wrap  justify-content-between align-items-center">
                                <h2 class="section-title style1">${dealer_name}</h2>
                                <div class="category-slider-placeholder">
                                    <img src="/theme_scita/static/src/img/client.jpeg" alt="Top Dealers" class="img-fluid"/>
                                </div>
                            </div>
                        </div>
                    `);
                }
            },
            
            start: function(){
                var self = this;
                if (this.editableMode) {
                    // Restore placeholder when in editable mode
                    self._restorePlaceholder();
                    
                    // Also listen for when body gets editor_enable class (editable mode enabled)
                    var checkEditableMode = function() {
                        if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                            self._restorePlaceholder();
                        }
                    };
                    
                    // Check immediately
                    setTimeout(checkEditableMode, 100);
                    
                    // Also check when DOM changes (in case editable mode is enabled later)
                    if (typeof MutationObserver !== 'undefined') {
                        var observer = new MutationObserver(function(mutations) {
                            checkEditableMode();
                        });
                        observer.observe(document.body, {
                            attributes: true,
                            attributeFilter: ['class'],
                            subtree: true
                        });
                        this._observer = observer;
                    }
                }
                if (!this.editableMode) {
                    $.get("/theme_scita/top_dealers", {
                    }).then(function(data) {
                        self.$target.empty();
                        self.$target.append(data);
                        $(".oe_top_dealers_section").removeClass('hidden');
                    });
                }
            },
            
            destroy: function() {
                // Clean up observer if it exists
                if (this._observer) {
                    this._observer.disconnect();
                    this._observer = null;
                }
                return this._super.apply(this, arguments);
            },
    });
    // Dynamic Top Dealers Snippet End
    
    // Dynamic Trending Products Snippet Start
    publicWidget.registry.dynamic_trending_products = publicWidget.Widget.extend({ 
        selector: ".oe_trending_products_section",
        disabledInEditableMode: false,
        events: {
            "mouseenter .scita_attribute_li": "_onMouseEnterSwatch",
            "mouseleave .css_attribute_color": "_onMouseLeave",
            "click .js_add_cart": "_onClickAddToCart",
            'click .cart_view_sct_btn:not(.js_add_cart)': 'cartViewData',
            "click .js_add_cart_json": "_onClickUpdateQty",
            "click .trend_prod_tab": "_onClickTrendingTab",
        },
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has trending products content)
            var hasRenderedContent = self.$target.find('.trending_products_categories, .trend_prod_tab, .trend_product_slider, .owl-carousel, .cs-product, .retail_trending_products, .latest-trendy-section, .lns-inner').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            
            // Only restore if we have rendered content and no placeholder
            if (hasRenderedContent && !hasPlaceholder) {
                var slider_id = self.$target.attr('data-cat-slider-id');
                var trending_name = _t("Trending Products");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.title-block h2, h2.section-title, .section-title');
                if ($existingTitle.length) {
                    trending_name = $existingTitle.text().trim() || trending_name;
                }
                
                // Restore placeholder structure
                self.$target.html(`
                    <div class="retail_trending_products">
                        <div class="container">
                            <div class="lns-inner latest-trendy-section">
                                <div class="row">
                                    <div class="lns-post">
                                        <div class="psb-inner">
                                            <div class="title-block">
                                                <h2 class="section-title style1">${trending_name}</h2>
                                            </div>
                                            <div class="category-slider-placeholder">
                                                <img src="/theme_scita/static/src/img/TreandingProduct1.png" alt="Trending Products" class="img-fluid"/>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_id) {
                    self.$target.attr('data-cat-slider-id', slider_id);
                }
            }
        },
        
        start: function(){
            var self = this;
            if (this.editableMode) {
                // Restore placeholder when in editable mode
                self._restorePlaceholder();
                
                // Also listen for when body gets editor_enable class (editable mode enabled)
                var checkEditableMode = function() {
                    if ($('body').hasClass('editor_enable') || $('#wrapwrap').hasClass('editor_enable')) {
                        self._restorePlaceholder();
                    }
                };
                
                // Check immediately
                setTimeout(checkEditableMode, 100);
                
                // Also check when DOM changes (in case editable mode is enabled later)
                if (typeof MutationObserver !== 'undefined') {
                    var observer = new MutationObserver(function(mutations) {
                        checkEditableMode();
                    });
                    observer.observe(document.body, {
                        attributes: true,
                        attributeFilter: ['class'],
                        subtree: true
                    });
                    this._observer = observer;
                }
            }
            if (!this.editableMode) {
                var slider_id = self.$target.attr('data-cat-slider-id');
                if (!slider_id) {
                    return; // block not configured yet: the route 404s on an empty id
                }
                $.get("/theme_scita/trending_products_categories", {
                    'slider-id': slider_id || '',
                }).then(function(data) {
                    const firstTab = new DOMParser().parseFromString(data, 'text/html').querySelector('.trend_prod_tab');
                    if (!firstTab) {
                        return; // no categories / configuration deleted: stays empty (dynamic_block_empty.js)
                    }
                    self._loadTrendingCategory(firstTab.getAttribute('data-category-id'));
                });
            }
        },
        _loadTrendingCategory: function (categoryId) {
            var self = this;
            if (self._trendingStopped) {
                return;
            }
            var requestId = self._trendingRequestId = (self._trendingRequestId || 0) + 1;
            $.get("/theme_scita/get_trending_prducts", {
                'category': categoryId,
                'slider-id': self.$target.attr('data-cat-slider-id') || '',
            }).then(function(data) {
                if (self._trendingStopped || requestId !== self._trendingRequestId) {
                    return; // another tab was clicked since
                }
                self.$target.empty();
                self.$target.append(data);
                self.$target.removeClass('o_hidden');
                self.$target.find('.trend_prod_tab > a').removeClass('show active');
                self.$target.find(`.trend_prod_tab[data-category-id="${categoryId}"] > a`).addClass('show active');
                self.$target.find('div.trend_product_slider').owlCarousel({
                    margin: 30,
                    items:4,
                    loop:false,
                    autoplay:true,
                    rewind:true,
                    dots:false,
                    autoplayTimeout:5000,
                    autoplayHoverPause:true,
                    nav: true,
                    responsive: {
                        0: {
                            items: 2
                        },
                        992: {
                            items: 3
                        },
                        1400: {
                            items: 4
                        },
                    },
                });
            });
        },
        _onClickTrendingTab: function (ev) {
            ev.preventDefault();
            if (this.editableMode) {
                return;
            }
            this.$target.find('.trend_prod_tab > a').removeClass('show active');
            $(ev.currentTarget).find('a').addClass('show active');
            this._loadTrendingCategory(ev.currentTarget.getAttribute('data-category-id'));
        },
        cartViewData: function (ev) {
                const element = ev.currentTarget;
                const product_id = $(element).attr('data-id');
                rpc('/theme_scita/shop/cart_view', { product_id }).then(function (data) {
                    if (!data) {
                        return;
                    }
                    $("#shop_cart_view_modal").html(data).modal("show");
                });
            },
        
            // 🛒 ADD TO CART BUTTON (main "Add" button)
            _onClickAddToCart: function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            
                const $btn = $(ev.currentTarget);
                const $cartWrapper = $btn.closest(".ajax_cart_template");
                const $qtyInput = $cartWrapper.find("input.quantity");
                
                const $productIDInput = $cartWrapper.find("input[name='product_id']");
                const productID = parseInt($productIDInput.val()); 
                const productTemplateID = parseInt($btn.data("templateId"));
                const addQuantity = Math.max(1, parseInt($qtyInput.val()) || 1);

                const self = this;
                // one add at a time: a double click must not add the product twice
                if ($btn.data("sctAdding")) {
                    return;
                }
                $btn.data("sctAdding", true);

                // /shop/cart/add merges into an existing line. No Odoo "added to cart" popup:
                // Scita's own confirmation (cartViewData) opens once the product is in the cart.
                rpc("/shop/cart/add", {
                    product_id: productID,
                    product_template_id: productTemplateID,
                    quantity: addQuantity,
                }).then((data) => {
                    if (data && data.cart_quantity) {
                        self._updateCartIcon(data.cart_quantity);
                    }
                    sctCartAddDone(self, $btn[0], data);
                }).catch((err) => {
                    sctCartAddFailed(self, err);
                }).finally(() => {
                    $btn.data("sctAdding", false);
                });
            }, 

            _updateCartIcon: function (cartQuantity) {
                browser.sessionStorage.setItem('website_sale_cart_quantity', cartQuantity);
            
                // Update mobile and desktop cart quantities
                const cartQuantityElements = document.querySelectorAll('.my_cart_quantity, .o_wsale_my_cart_quantity');
                for (const cartQuantityElement of cartQuantityElements) {
                    if (cartQuantity === 0) {
                        cartQuantityElement.classList.add('d-none');
                    } else {
                        const cartIconElement = document.querySelector('li.o_wsale_my_cart');
                        if (cartIconElement) {
                            cartIconElement.classList.remove('d-none');
                        }
                        cartQuantityElement.classList.remove('d-none');
                        cartQuantityElement.classList.add('o_mycart_zoom_animation');
            
                        setTimeout(() => {
                            cartQuantityElement.textContent = cartQuantity;
                            cartQuantityElement.classList.remove('o_mycart_zoom_animation');
                        }, 300);
                    }
                }
            },

            _trackProducts(trackingInfo) {
                document.querySelector('.oe_website_sale').dispatchEvent(
                    new CustomEvent('add_to_cart_event', {'detail': trackingInfo})
                );
            },

            _onClickUpdateQty: function (ev) {
                ev.preventDefault();
                const $btn = $(ev.currentTarget);
                const $qtyInput = $btn.closest('.input-group').find('input.quantity');
            
                let qty = parseInt($qtyInput.val()) || 1;
                qty += $btn.attr('aria-label') === 'Remove one' ? -1 : 1;
            
                if (qty < 1) qty = 1;
                $qtyInput.val(qty).trigger('change');
            },
        _onMouseEnterSwatch: function (ev) {
            const $swatch = $(ev.currentTarget);
            const $product = $swatch.closest('.cs-product');
            const $img = $product.find('img').first();            
            this.image= $img;
        
            this.defaultSrc = $img.attr('data-default-img-src');        
            const previewSrc = $swatch.find('label').data('previewImgSrc');
            
            if (previewSrc) {
                this._updateImgSrc(previewSrc, $img);
                $swatch.addClass("active");
            }
        },
        
        _onMouseLeave: function () {
             this._updateImgSrc(this.defaultSrc,this.image);
        },
        
        _updateImgSrc: function (src, $img) {        
            if ($img && src) {
                $img.attr('src', src);
            } else {
                console.warn("Image element or source is missing.");
            }
        },
        
        destroy: function() {
            this._trendingStopped = true;
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
    // Dynamic Trending Products Snippet End

    // A carousel nested in a block keeps its template id when the block is dropped twice (Odoo
    // only renews the id of a dropped s_carousel_wrapper root): the arrows and dots of the second
    // copy drove the first one. On the website, so pages saved that way are fixed as well.
    let sctCarouselCount = 0;
    publicWidget.registry.sct_carousel_unique_id = publicWidget.Widget.extend({
        selector: ".s_carousel_wrapper .carousel[id]",
        start: function () {
            const oldId = this.el.id;
            if (document.querySelector(`[id="${oldId}"]`) === this.el) {
                return;
            }
            const newId = `sctCarousel${Date.now()}${++sctCarouselCount}`;
            const rootEl = this.el.closest(".s_carousel_wrapper");
            this.el.id = newId;
            for (const el of rootEl.querySelectorAll(`[data-bs-target="#${oldId}"]`)) {
                el.setAttribute("data-bs-target", `#${newId}`);
            }
            for (const el of rootEl.querySelectorAll(`[href="#${oldId}"]`)) {
                el.setAttribute("href", `#${newId}`);
            }
        },
    });

    // Same for accordion blocks: with two on a page, a click in the second closed the open item
    // of the first, because data-bs-parent resolves to the first element with that id.
    publicWidget.registry.sct_accordion_unique_id = publicWidget.Widget.extend({
        selector: ".accordion[id]",
        start: function () {
            const oldId = this.el.id;
            if (document.querySelector(`[id="${oldId}"]`) === this.el) {
                return;
            }
            const newId = `sctAccordion${Date.now()}${++sctCarouselCount}`;
            this.el.id = newId;
            for (const el of this.el.querySelectorAll(`[data-bs-parent="#${oldId}"]`)) {
                el.setAttribute("data-bs-parent", `#${newId}`);
            }
        },
    });

    // Google Map block without a map chosen yet: its "Google Map Address" editor label stays out
    // of the website.
    publicWidget.registry.sct_map_empty_label = publicWidget.Widget.extend({
        selector: ".google_map_v1 > .map_container > span, .google_map_v2 .map_data_container > span",
        start: function () {
            this.el.parentElement.classList.add("d-none");
        },
        destroy: function () {
            this.el.parentElement.classList.remove("d-none");
        },
    });
