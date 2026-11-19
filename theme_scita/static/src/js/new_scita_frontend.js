/** @odoo-module **/

import publicWidget from "@theme_scita/js/compat/public_widget";
import { _t } from "@web/core/l10n/translation";
import { rpc, RPCError } from '@web/core/network/rpc';
import { browser } from '@web/core/browser/browser';
import { countdownParts, renderCountdown } from "@theme_scita/js/countdown_dom";
import { sctCartAddDone, sctCartAddFailed } from "@theme_scita/js/scita_fronted";

function bannerTimerMarkup([days, hours, minutes, seconds]) {
    return "<div class='counter_timer_div'><span class='col-3 text-center box_degit_wrapper'><div class='box_degit'><span id='days' class='d-count  t_days_hr_min_sec_digit o_default_snippet_text'>"+    days +"</span><span id='day_lbl' class='d-block'>DAYS</span></div></span><span class='col-3 text-center box_degit_wrapper'><div class='box_degit'><span id='hours' class='d-count  t_days_hr_min_sec_digit o_default_snippet_text'>"+hours+"</span><span id='h_lbl' class='d-block'>HOURS</span></div></span><span class='col-3 text-center box_degit_wrapper'><div class='box_degit'><span id='minutes' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>"+minutes+"</span><span id='m_lbl' class=' d-block'>MINS</span></div></span><span class='col-3 text-center box_degit_wrapper'><div class='box_degit'><span id='seconds' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>"+seconds+"</span><span id='s_lbl' class='d-block'>SECS</span></div></span></div>";
}

function dealTimerMarkup([days, hours, minutes, seconds]) {
    return "<div class='counter_timer_div'><span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center'><div class='box_degit'><span id='days' class='d-count  t_days_hr_min_sec_digit o_default_snippet_text'>"+    days +"</span><span id='day_lbl' class='d-block'>D</span></div></span><span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center'><div class='box_degit'><span id='hours' class='d-count  t_days_hr_min_sec_digit o_default_snippet_text'>"+hours+"</span><span id='h_lbl' class='d-block'>H</span></div></span><span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center'><div class='box_degit'><span id='minutes' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>"+minutes+"</span><span id='m_lbl' class=' d-block'>M</span></div></span><span class='col-lg-3 col-md-3 col-sm-3 col-3 text-center'><div class='box_degit'><span id='seconds' class='d-count t_days_hr_min_sec_digit o_default_snippet_text'>"+seconds+"</span><span id='s_lbl' class='d-block'>S</span></div></span></div>";
}


// animation.registry.deal_seller_multi_product_custom_snippet = animation.Class.extend({
publicWidget.registry.deal_seller_multi_product_custom_snippet = publicWidget.Widget.extend({

        selector: ".deal_multi_product_slider",
        disabledInEditableMode: false,
        
        _restorePlaceholder: function() {
            var self = this;
            // Check if this is rendered content (has deal seller content)
            var hasRenderedContent = self.$target.find('.deal-wrapper, .deal-inner, .product-slider, .deal-slider, .best-seller-row, .owl-carousel').length > 0;
            var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
            var hasContent = self.$target.find('.container, .title-block, .section-title').length > 0;
            
            // Restore if: (has rendered content and no placeholder) OR (no content at all and no placeholder)
            if ((hasRenderedContent && !hasPlaceholder) || (!hasContent && !hasPlaceholder)) {
                var slider_type = self.$target.attr('data-multi-cat-slider-type');
                var deal_type = self.$target.attr('data-multi-deal-of-day-type');
                var titleText = _t("Deal Seller Multi Product Snippet");
                
                // Get title from rendered content if exists
                var $existingTitle = self.$target.find('.section-title-wrapper h2, h2.section-title, h4.section-title, .title-block h2, .title-block h4');
                if ($existingTitle.length) {
                    var title = $existingTitle.first().text().trim();
                    if (title) {
                        titleText = title;
                    }
                }
                
                // Restore placeholder structure (matching fashion snippet structure)
                self.$target.html(`
                    <div class="container">
                        <div class="row our-categories">
                            <div class="col-md-12">
                                <div class="title-block">
                                    <h4 id="snippet-title" class="section-title style1">
                                        <span>${titleText}</span>
                                    </h4>
                                </div>
                                <div class="category-slider-placeholder">
                                    <img src="/theme_scita/static/src/img/multi_deal_slide.webp" alt="Category Slider" class="img-fluid"/>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
                
                // Restore attributes
                if (slider_type) {
                    self.$target.attr('data-multi-cat-slider-type', slider_type);
                }
                if (deal_type) {
                    self.$target.attr('data-multi-deal-of-day-type', deal_type);
                }
            }
        },
        
        start: function() {
            var self = this;
            if (this.editableMode) {
                // Don't call redrow() in editable mode - it clears the content
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
            } else {
                var slider_deals = self.$target.attr('data-multi-deal-of-day-type');
                rpc("/deal/product_multi_get_dynamic_seller", {
                    'slider-deal': self.$target.attr('data-multi-deal-of-day-type') || '',
                }).then(function(data) {
                    if (data && data.trim()) {
                        var sct_rtl = false;
                        if ($('#wrapwrap').hasClass('o_rtl')) {
                            sct_rtl = true;
                        }
                        self.$target.empty();
                        self.$target.append(data);
                        $(".deal_multi_product_slider").removeClass('hidden');
                        self.build(); // the timer needs the content (and shows an expired deal)

                        rpc('/theme_scita/product_multi_deal_seller_config', {
                            'slider_deals': slider_deals,
                        }).then(function(res) {
                            $('div.product-slider ').owlCarousel({
                                loop:false,
                                rewind:true,
                                margin:25,
                                items: 5,
                                rtl: sct_rtl,
                                nav:true,
                                autoplay:true,
                                autoplayTimeout:4000,
                                autoplayHoverPause:true,
                                responsive: {
                                    0: {
                                        items: 1,
                                    },
                                    375: {
                                        items: 1,
                                    },
                                    767: {
                                        items: 1,
                                    },
                                    1000: {
                                        items: 1,
                                    },
                                    1600: {
                                        items: 1,
                                    },
                                },
                            });
                            $('div.deal-slider').owlCarousel({
                                loop:false,
                                rewind:true,
                                margin:25,
                                items: 5,
                                rtl: sct_rtl,
                                nav:true,
                                autoplay:true,
                                autoplayTimeout:4000,
                                autoplayHoverPause:true,
                                responsive: {
                                    0: {
                                        items: 1,
                                    },
                                    375: {
                                        items: 1
                                    },
                                    767: {
                                        items: 1,
                                    },
                                    1000: {
                                        items: 1,
                                    },
                                    1600: {
                                        items: 1,
                                    },
                                },
                            });
                        });
                    } else {
                        // nothing to show (block not configured / no published deal products):
                        // drop the CLS height reservation so no blank gap is left on the page
                        self.$target.css('min-height', '0px');
                    }
                });
            }
        },
        stop: function(){
            this.clean();
        },
        redrow: function(debug){
            this.clean(debug);
            this.build(debug);
        },

        clean:function(debug){
            this.$target.empty();
        },
        build: function(debug)
        {
              var self = this;
              var date = self.$target.data("date");
              if(date != "nan"){
                  var toDate = new Date(date).getTime();
                  if (isNaN(toDate)) { return; } // no / invalid date
                  clearInterval(self._timerInterval);
                  var tick = function () {
                        var parts = countdownParts(toDate);
                        var $main = self.$target.find(".counter_timer_main_div");
                        if (!parts) {
                            // the count down is over: show 00s and the message
                            clearInterval(self._timerInterval);
                            parts = ["00", "00", "00", "00"];
                            $main.addClass("time_out");
                            $main.append("<div class='time_over_msg'><p>"+self.$target.data("msg")+"</p></div>");
                        } else {
                            $main.removeClass("time_out");
                        }
                        if ($main.length) {
                            renderCountdown($main[0], parts, bannerTimerMarkup);
                        }
                  };
                  // first draw right away (it used to appear after 1s and push the page down)
                  self._timerInterval = setInterval(tick, 1000);
                  tick();
                   }      
        },
        
        destroy: function() {
            clearInterval(this._timerInterval);
            // Clean up observer if it exists
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            return this._super.apply(this, arguments);
        }
    });
// animation.registry.oe_category_slider = animation.Class.extend({
publicWidget.registry.oe_category_slider = publicWidget.Widget.extend({

    selector: ".oe_category_slider",
    disabledInEditableMode: false,
    
    _restorePlaceholder: function() {
        var self = this;
        // Check if this is rendered content (has owl-carousel or custom-title-block)
        var hasRenderedContent = self.$target.find('.owl-carousel, .custom-title-block').length > 0;
        var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
        
        // Only restore if we have rendered content and no placeholder
        if (hasRenderedContent && !hasPlaceholder) {
            // Restore placeholder template structure when entering editable mode
            var slider_type = self.$target.attr('data-category-config-type');
            var color = self.$target.attr('data-category-color');
            var config_id = self.$target.attr('data-category-config-id');
            
            // Get the title from the rendered content if it exists
            var titleText = 'Category';
            var $existingTitle = self.$target.find('.custom-title-block h2, .section-title.style1');
            if ($existingTitle.length) {
                titleText = $existingTitle.text().trim() || 'Category';
            }
            
            // Restore placeholder structure
            self.$target.html(`
                <div class="container">
                    <div class="row our-category">
                        <div class="col-md-12">
                            <h3 class="section-title style1" id="snippet-title">
                                <span>${titleText}</span>
                            </h3>
                            <div class="category-slider-placeholder">
                                <img src="/theme_scita/static/src/img/cat_slide_3.png" alt="Category Slider" class="img-fluid"/>
                            </div>
                        </div>
                    </div>
                </div>
            `);
            
            // Restore attributes
            if (slider_type) {
                self.$target.attr('data-category-config-type', slider_type);
            }
            if (color) {
                self.$target.attr('data-category-color', color);
            }
            if (config_id) {
                self.$target.attr('data-category-config-id', config_id);
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
            var slider_type = self.$target.attr('data-category-config-type');
            var color = self.$target.attr('data-category-color');
            rpc("/theme_scita/dynamic_color_category_slider", {
                'slider-id': slider_type || '',
                'color': color || '',
            }).then(function(data) {
                if (data) {
                    var sct_rtl = false;
                    if ($('#wrapwrap').hasClass('o_rtl')) {
                        sct_rtl = true;
                    }
                    self.$target.empty();
                    self.$target.append(data);
                    $(".oe_brand_slider").removeClass('o_hidden');
                    $('.sct-category').owlCarousel({
                        nav:true,
                        margin: 10,
                        items:7,
                        loop:false,
                        rewind:true,
                        autoplay:true,
                        autoplayTimeout:4000,
                        autoplayHoverPause:true,
                        rtl: sct_rtl,
                        dots:false,
                        responsive: {
                                0:{
                                    items:2
                                },
                                400:{
                                    items:3
                                },
                                768:{
                                    items:5,
                                    margin:10
                                },
                                1024:{
                                    items:6,
                                    margin:10
                                },
                                1266:{
                                    items:7,
                                    margin:20
                                },
                                1440:{
                                    items:7,
                                    margin:30
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
// animation.registry.oe_deal_of_the_day = animation.Class.extend({
publicWidget.registry.oe_deal_of_the_day = publicWidget.Widget.extend({
    selector: ".oe_deal_of_the_day",
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
        // Check if this is rendered content (has deal content)
        var hasRenderedContent = self.$target.find('.deal_day_wrap, .deal_day_bottom_inner, .cs-product').length > 0;
        var hasPlaceholder = self.$target.find('.category-slider-placeholder').length > 0;
        
        // Only restore if we have rendered content and no placeholder
        if (hasRenderedContent && !hasPlaceholder) {
            var deal_name = _t("Deal of the day");
            
            // Get title from rendered content if exists
            var $existingTitle = self.$target.find('.title-block h2, h2.section-title, h4.section-title, h2.fancy');
            if ($existingTitle.length) {
                deal_name = $existingTitle.text().trim() || deal_name;
            }
            
            // Restore placeholder structure
            self.$target.html(`
                <div class="container">
                    <div class="block-title">
                        <h2 class="fancy">${deal_name}</h2>
                    </div>
                    <div class="category-slider-placeholder">
                        <img src="/theme_scita/static/src/img/dealofday.jpg" alt="Deal of the Day" class="img-fluid"/>
                    </div>
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
            var slider_deals = self.$target.attr('data-deal-snippet-id');
            rpc("/deal/deal_of_the_day_new", {
                'slider-deal': self.$target.attr('data-deal-snippet-id') || '',
            }).then(function(data) {
                if (data && data.trim()) {
                    self.$target.empty();
                    self.$target.append(data);
                    $(".oe_deal_of_the_day").removeClass('hidden');

                    self.set_timer();
                }
            });
        }
    },
    
    destroy: function() {
        clearInterval(this._timerInterval);
        // Clean up observer if it exists
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        return this._super.apply(this, arguments);
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
                this.image = $img;
    
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
    stop: function(){
        this.clean();
    },
    redrow: function(debug){
        this.clean(debug);
        this.build(debug);
    },

    clean:function(debug){
        this.$target.empty();
    },

    set_timer: function() {
        var self = this;
        var date = self.$target.data("date");
        if(date != "nan"){
            var toDate = new Date(date).getTime();
            if (isNaN(toDate)) { return; } // no / invalid date
            clearInterval(self._timerInterval);
            var tick = function () {
                var parts = countdownParts(toDate);
                var $main = self.$target.find('.counter_timer_main_div');
                if (!parts) {
                    clearInterval(self._timerInterval);
                    parts = ["00", "00", "00", "00"];
                    $main.addClass("time_out");
                    self.$target.find('.deal_day_top_inner').addClass("title_time_out");
                    $main.append("<div class='time_over_msg'><p>"+self.$target.data("msg")+"</p></div>");
                } else {
                    $main.removeClass("time_out");
                    self.$target.find('.deal_day_top_inner').removeClass("title_time_out");
                }
                if ($main.length) {
                    renderCountdown($main[0], parts, dealTimerMarkup);
                }
            };
            self._timerInterval = setInterval(tick, 1000);
            tick();
        }
    },
    build: function(debug){
        this.set_timer();
    },
});