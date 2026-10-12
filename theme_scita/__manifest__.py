# -*- coding: utf-8 -*-
{
    'name': 'Theme Scita',
    'summary': '''Mobile-first & versatile Odoo theme — perfect for eCommerce and all CMS-based industries.''',
    'author': 'AppJetty',
    'website': 'https://www.appjetty.com/',
    'category': 'Theme/Ecommerce',
    'version': '20.0.1.0',
    'license': 'OPL-1',
    'description': '''Theme Scita
Business theme
Furniture theme
Web To Print theme
Grocery theme
Single Page theme
Electronics Theme
Digital security theme
Event theme
Medical equipments theme
multipurpose template for industry
multipurpose template for all industries
odoo custom theme
customizable odoo theme
multi industry odoo theme
multi purpose responsive odoo theme
multipurpose website template for odoo
odoo multipurpose theme for industry
multipurpose templates for odoo
odoo ecommerce templates
odoo ecommerce theme
odoo ecommerce themes
odoo responsive themes
odoo website themes
odoo ecommerce website theme
odoo theme for ecommerce store
odoo bootstrap themes
customize odoo theme
odoo ecommerce store theme for business
odoo theme for business
odoo responsive website theme
Scita Theme
Odoo Scita Theme
Scita theme for Odoo
odoo 20 theme
multipurpose theme
odoo multipurpose theme
odoo responsive theme
responsive theme
odoo theme
odoo themes
ecommerce theme
odoo ecommerce themes
odoo website themes
odoo bootstrap themes
bootstrap themes
bootstrap theme
customize odoo theme
ecommerce store theme
theme for business
theme for ecommerce store
Shop by category
publish unpublish product
    ''',
    'uninstall_hook': 'uninstall_hook',
    'depends': [
        'sale_management',
        'website_sale',
        'website_sale_stock',
        'hr',
        'website_blog',
        'website_sale_loyalty',
        'html_editor',
        'html_builder',
    ],
    'data': [
        'security/ir.access.csv',
        'data/ir_asset.xml',
        'data/theme_scita_data.xml',
        'data/extra_pages_data.xml',
        'data/scita_image_data.xml',
        'views/theme.xml',
        'views/footer_option.xml',
        'views/header_option.xml',
        'views/res_config_view.xml',
        'views/views.xml',
        'views/res_company_view.xml',
        'views/sliders_view.xml',
        'views/website_view.xml',
        'views/brand_snippets.xml',
        'views/blogs_snippets.xml',
        'views/banner_snippets.xml',
        'views/case_study_snippets.xml',
        'views/service_snippets.xml',
        'views/testinomials_snippets.xml',
        'views/pricing_tables_snippets.xml',
        'views/our_team_snippets.xml',
        'views/policy_trust_snippets.xml',
        'views/newsletter_snippets.xml',
        'views/letstalk_snippets.xml',
        'views/how_it_work_snippets.xml',
        'views/expertise_statistics_snippets.xml',
        'views/contact_us_snippets.xml',
        'views/template.xml',
        'views/content_snippets.xml',
        'views/promo_banner_snippets.xml',
        'views/about_us_snippets.xml',
        'views/deal_of_day_snippets.xml',
        'views/client_snippets.xml',
        'views/category_snippets.xml',
        'views/timeline_snippets.xml',
        'views/protflio_snippets.xml',
        'views/snippet_google_map.xml',
        'views/trending_products_snippet.xml',
        'views/top_dealer_snippets.xml',
        'views/deal_of_the_day_config_view.xml',
        'views/snippets.xml',
        'views/product_details_template.xml',
        'views/shop_by_category.xml',
        'views/deal_of_day_page.xml',
        'views/pwa_config_view.xml',
        'views/pwa_template.xml',
        'views/header_option_extended.xml',
        'views/my_account_changes.xml',
        'views/new_snippets.xml',
        'views/shop_page_attribute.xml',
        'views/bulk_buy_product_discount.xml',
        'views/snippets/snippets.xml',  
        'views/snippets/scita_snippets.xml',
        'views/image_hotspot_views.xml',
        'views/playground_template.xml',
        'views/brand_template.xml',
        'views/playground_preview.xml',
        'views/request_quote_custom_templates.xml',
        'views/request_for_quote_views.xml',
        'views/similar_products.xml',
        'views/hide_price_configurations.xml',
    ],
    'support': 'support@appjetty.com',
    'live_test_url': 'https://theme-scita-furniture-v19.appjetty.com/',
    'images': [
        'static/description/splash-screen.png',
        'static/description/splash-screen_screenshot.gif',
    ],
    "cloc_exclude": [
        "static/**/*",
        "data/**/*",
        "views/**/*"
    ],
    'application': True,
    'price': 165.00,
    'currency': 'EUR',
    'installable': True,
    'assets': {
        # Odoo's lazy JS (web.assets_frontend_lazy) starts loading once the first screen is drawn,
        # not on window load (static/src/js/lazyloader_deferred.js)
        'web.assets_frontend_minimal': [
            ('replace', 'web/static/src/public/lazyloader.js', 'theme_scita/static/src/js/lazyloader_deferred.js'),
        ],
        'web.assets_frontend': [
            # in web.assets_frontend_minimal (above), loaded before this bundle
            ('remove', 'theme_scita/static/src/js/lazyloader_deferred.js'),
            'theme_scita/static/src/css/owl.carousel.css',
            'theme_scita/static/src/fonts/line-icons.css',
            # Odoo 20 removed FontAwesome from the website: ship 4.7 (as Odoo 19 did) before the subset
            'theme_scita/static/lib/fontawesome/css/font-awesome.css',
            'theme_scita/static/src/scss/fontawesome_compat.scss',
            'theme_scita/static/src/css/fontawesome-subset.css',
            'theme_scita/static/src/scss/variable.scss',
            # after variable.scss: uses Scita's $light-color
            'theme_scita/static/src/scss/product_card_equal_height.scss',
            'theme_scita/static/src/scss/mixins.scss',
            'theme_scita/static/src/scss/comman.scss',
            'theme_scita/static/src/scss/image_hotspot.scss',
            # after comman.scss: refines its search dropdown rules
            'theme_scita/static/src/scss/search_dropdown.scss',
            'theme_scita/static/src/scss/snippets.scss',
            # Split out of snippets.scss for readability only. Kept here
            # because these specific selectors are the ones actually used by
            # a live page on this site (checked against every URL in
            # /sitemap.xml). Everything else that used to be in this file -
            # the unused industry-demo snippet catalog - moved to
            # content_snippets_deferred.scss in the async
            # assets_snippet_product_css bundle below, ~155 KiB off the
            # critical path. A per-snippet <t t-call-assets> wouldn't survive
            # the builder's innerHTML rebuild on drag-and-drop, but the async
            # bundle promotes at the website.layout <head> level instead, so
            # it isn't subject to that.
            'theme_scita/static/src/scss/content_snippets.scss',
            'theme_scita/static/src/scss/cms_pages.scss',
            # 862 bytes. Kept in the main bundle purely to avoid a second
            # render-blocking request for it; the PWA *script* stays
            # conditional because it registers a service worker.
            'theme_scita/static/src/scss/pwa_design.scss',
            'theme_scita/static/src/scss/header/default_header.scss',
            'theme_scita/static/src/scss/header/header_styles.scss',
            'theme_scita/static/src/scss/footer/default_footer.scss',
            'theme_scita/static/src/scss/mobile_category.scss',
            # Odoo 20 ships no jQuery: the theme brings its own (plain script, must stay first),
            # then the publicWidget compatibility layer, then the jQuery plugins.
            'theme_scita/static/lib/jquery/jquery.js',
            'theme_scita/static/src/js/compat/public_widget.js',
            'theme_scita/static/src/js/compat/website_sale_utils.js',
            'theme_scita/static/src/js/owl.carousel.min.js',
            # only acts on #pg_carousel_category (the /snippet_studio playground)
            'theme_scita/static/src/js/pg_slider.js',
            'theme_scita/static/src/js/scita_fronted.js',
            'theme_scita/static/src/js/countdown_dom.js',
            'theme_scita/static/src/js/dynamic_block_empty.js',
            'theme_scita/static/src/js/timer_fronted.js',
            'theme_scita/static/src/js/new_scita_frontend.js',
            # Needed by product markup that arrives after page load through the
            # dynamic-snippet RPCs. A lazily loaded bundle never runs there:
            # the lazyloader only scans script[data-src] once, on window load.
            'theme_scita/static/src/js/shop_attribute.js',
            'theme_scita/static/src/js/product_details.js',
            'theme_scita/static/src/js/reviews_tab.js',
            'theme_scita/static/src/js/see_more_brand.js',
            'theme_scita/static/src/js/header.js',
            'theme_scita/static/src/js/bulk_price_btn.js',
            'theme_scita/static/src/js/quick_view.js',
            'theme_scita/static/src/js/request_quote.js',
            'theme_scita/static/src/js/search_dropdown_width.js',
            'theme_scita/static/src/js/extra_menu_megamenu.js',
            'theme_scita/static/src/js/lazy_load_button.js',
            'theme_scita/static/src/js/mobile_view.js',
            'theme_scita/static/src/js/snippet_preview.js',
            'theme_scita/static/src/js/feather_init.js',
            'theme_scita/static/src/js/theme_wishlist_fix.js',
            'theme_scita/static/src/js/product_comparison_extend.js',
            'theme_scita/static/src/js/compare_mini_sticky.js',
            'theme_scita/static/src/js/cart_notification_offset.js',
            'theme_scita/static/src/js/similar_products_sidebar.js',
            ('before', '/theme_scita/static/src/scss/comman.scss',
             'theme_scita/static/src/scss/button/button_styles.scss'),
            ('before', '/theme_scita/static/src/scss/comman.scss',
             'theme_scita/static/src/scss/product_hover_effect.scss'),
            'theme_scita/static/src/xml/hide_product_comparison_sticky.xml',
        ],
        'theme_scita.assets_playground': [
            ('include', 'web._assets_helpers'),
            ('include', 'web._assets_frontend_helpers'),
            'web/static/src/scss/pre_variables.scss',
            'web/static/lib/bootstrap/scss/_variables.scss',
            'web/static/lib/bootstrap/scss/_variables-dark.scss',
            'web/static/lib/bootstrap/scss/_maps.scss',
            'theme_scita/static/src/scss/variable.scss',
            'theme_scita/static/src/scss/mixins.scss',
            'theme_scita/static/src/scss/playground.scss',
            # pg_slider.js lives in web.assets_frontend (it needs the compat layer loaded first)
        ],
        'theme_scita.assets_pwa': [
            'theme_scita/static/src/js/pwa_implementation.js',
        ],
        # Everything this file styles is painted after load: the product
        # sliders are injected by the snippet RPCs and the quick-view is a
        # click-opened modal. Nothing here is on screen at first paint, so it
        # is pulled out of the render-blocking bundle and applied
        # asynchronously (see theme_scita_async_snippet_css in
        # views/website_view.xml). Worth ~14 KiB gzipped / 197 KB parsed off
        # the critical path.
        #
        # content_snippets_deferred.scss joined 2026-08-14: the unused-on-
        # this-site portion of content_snippets.scss (~155 KiB), same
        # reasoning - nothing in it is on screen at first paint because
        # nothing in it is on screen at all on any page here. See the header
        # comment in that file for how to move a block back out if a
        # currently-unused snippet gets dragged onto a page and needs
        # above-the-fold styling.
        #
        # megamenu_style.scss joined 2026-08-17: the mega menu is
        # display:none until hover/click, never on screen at first paint.
        # footer_styles.scss joined the same pass: it's below the fold on
        # every load. Previously kept in the main bundle over a
        # .js_language_selector concern (that selector can render in the
        # header on a multi-language site) - moot here, this site has only
        # en_US installed, so Odoo never renders the language dropdown at
        # all. default_footer.scss (base layout, not this file) stays in the
        # main bundle.
        'theme_scita.assets_snippet_product_css': [
            ('include', 'web._assets_helpers'),
            ('include', 'web._assets_frontend_helpers'),
            'web/static/src/scss/pre_variables.scss',
            'web/static/lib/bootstrap/scss/_variables.scss',
            'web/static/lib/bootstrap/scss/_variables-dark.scss',
            'web/static/lib/bootstrap/scss/_maps.scss',
            'theme_scita/static/src/scss/variable.scss',
            'theme_scita/static/src/scss/mixins.scss',
            'theme_scita/static/src/scss/product_snippets.scss',
            'theme_scita/static/src/scss/content_snippets_deferred.scss',
        ],
        # Shop listing / product page styles. Asynchronous on most pages (their product cards
        # arrive after load), but render-blocking under /shop, where they style what is on screen
        # at first paint: applied late, the page title, grid and product page reflowed once it
        # arrived (0.9+ layout shift on mobile Lighthouse). Split out of the bundle above and kept
        # in the same <link> order (see theme_scita_async_snippet_css), so the cascade is unchanged.
        'theme_scita.assets_shop_css': [
            ('include', 'web._assets_helpers'),
            ('include', 'web._assets_frontend_helpers'),
            'web/static/src/scss/pre_variables.scss',
            'web/static/lib/bootstrap/scss/_variables.scss',
            'web/static/lib/bootstrap/scss/_variables-dark.scss',
            'web/static/lib/bootstrap/scss/_maps.scss',
            'theme_scita/static/src/scss/variable.scss',
            'theme_scita/static/src/scss/mixins.scss',
            # 127 KiB raw, the single largest theme file. Everything it styles
            # is a product card / shop listing, which is below the fold on
            # every layout this theme ships (the hero is what's above it), and
            # the homepage's cards additionally arrive after load via the
            # dynamic-snippet RPCs. Kept in relative order after comman.scss
            # exactly as it was in the main bundle, so the cascade is
            # unchanged - unlike product_hover_effect.scss, which is
            # deliberately loaded *before* comman.scss and therefore must
            # stay in the critical bundle.
            'theme_scita/static/src/scss/product_style.scss',
            # product page CTA row layout; must come after product_style.scss
            'theme_scita/static/src/scss/product_cta_layout.scss',
        ],
        # rest of the asynchronous styles, after the shop ones as before the split
        'theme_scita.assets_snippet_extra_css': [
            ('include', 'web._assets_helpers'),
            ('include', 'web._assets_frontend_helpers'),
            'web/static/src/scss/pre_variables.scss',
            'web/static/lib/bootstrap/scss/_variables.scss',
            'web/static/lib/bootstrap/scss/_variables-dark.scss',
            'web/static/lib/bootstrap/scss/_maps.scss',
            'theme_scita/static/src/scss/variable.scss',
            'theme_scita/static/src/scss/mixins.scss',
            'theme_scita/static/src/scss/megamenu_style.scss',
            'theme_scita/static/src/scss/footer/footer_styles.scss',
            # 605 Lineicons glyphs shipped, ~7 actually used anywhere in this
            # site's page content (verified against every ir.ui.view, blog
            # post and product description in the DB, 17 Aug 2026). The
            # other 598 moved here; line-icons.css (critical bundle) keeps
            # the @font-face, base .lni class, and just the used glyphs.
            'theme_scita/static/src/fonts/line-icons-deferred.css',
            'theme_scita/static/src/scss/comman_editor_only.scss',
            # Unite Gallery "Alexis" skin - 11.5 KiB of `.ug-*` rules. The
            # Unite Gallery JS library that generates that markup is not in
            # any bundle, and no `ug-` class appears in any view or in any
            # saved page content, so these rules cannot currently match
            # anything. Moved off the critical path rather than deleted, so a
            # site that wires the gallery up by hand still gets the skin.
            'theme_scita/static/src/skins/alexis/alexis.css',
        ],
        'theme_scita.assets_checkout': [
            ('include', 'web._assets_helpers'),
            ('include', 'web._assets_frontend_helpers'),
            'web/static/src/scss/pre_variables.scss',
            'web/static/lib/bootstrap/scss/_variables.scss',
            'web/static/lib/bootstrap/scss/_variables-dark.scss',
            'web/static/lib/bootstrap/scss/_maps.scss',
            'theme_scita/static/src/scss/variable.scss',
            'theme_scita/static/src/scss/mixins.scss',
            'theme_scita/static/src/scss/checkout_style.scss',
        ],
        'website.assets_wysiwyg': [
            '/theme_scita/static/src/xml/**/*',
        ],
        'website.assets_editor': [
        ],
        'website.website_builder_assets': [
          # Odoo 20 "Add/Remove Slide" need Bootstrap 5 carousel indicators (old pages have <li>)
          'theme_scita/static/src/js/carousel_indicators_compat.js',
          # product page "Tags" option: no crash when the page has no product id
          'theme_scita/static/src/xml/product_tags_option_guard.xml',
          # shop Products Design: hide the button settings Scita's hover styles replace
          'theme_scita/static/src/xml/products_design_panel_scita.xml',
          # Odoo 20 saves image width/height attributes as inline px styles: restore them
          'theme_scita/static/src/js/img_size_attrs_plugin.js',
          # never save the live site's loading / empty markers of dynamic blocks
          'theme_scita/static/src/js/dynamic_block_save_plugin.js',
          # Scita block styles in the "Insert a block" previews
          'theme_scita/static/src/js/snippet_preview_css_plugin.js',
          'theme_scita/static/src/xml/scita_header_option.xml',
          'theme_scita/static/src/xml/scita_footer_option.xml',
          'theme_scita/static/src/xml/snippet_modify.xml',
            'theme_scita/static/src/js/category_slider.js',
            'theme_scita/static/src/js/category_slider2.js',
            'theme_scita/static/src/js/category_slider3.js',
            'theme_scita/static/src/js/category_snippet.js',
            'theme_scita/static/src/js/snippet/fashionMultiCatSnippetPlugin.js',
            'theme_scita/static/src/js/snippet/dynamicVideoSnippetPlugin.js',
            'theme_scita/static/src/js/snippet/dealSellerMultiProductSnippetPlugin.js',
            'theme_scita/static/src/js/snippet/dealOfTheDaySnippetPlugin.js',
            'theme_scita/static/src/js/snippet/dealOfDayBanner1Plugin.js',
            'theme_scita/static/src/js/snippet/dealOfDayBanner3Plugin.js',
            'theme_scita/static/src/js/snippet/dealOfDayBanner5Plugin.js',
            'theme_scita/static/src/js/snippet/brandsSnippetPlugin.js',
            'theme_scita/static/src/js/snippet/sctProductSnippet1Plugin.js',
            'theme_scita/static/src/js/snippet/sctProductSnippet2Plugin.js',
            'theme_scita/static/src/js/snippet/trendingProductsModifyPlugin.js',
            'theme_scita/static/src/js/snippet/googleMapSnippetPlugin.js',
            'theme_scita/static/src/js/snippet/blogSnippetPlugin.js',
            'theme_scita/static/src/xml/theme_scita.xml',
            'theme_scita/static/src/xml/s_google_snippet_modal.xml',
        ],
    }
}
