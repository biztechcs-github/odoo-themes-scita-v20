# -*- coding: utf-8 -*-
# Part of AppJetty. See LICENSE file for full copyright and licensing details.

import re

import werkzeug
from lxml import etree
from markupsafe import Markup
from odoo import models, api, fields
from odoo.exceptions import UserError
from odoo.fields import Domain
from odoo.http import request
from odoo.addons.website_sale.controllers.main import WebsiteSale

PPG = 18


class WebsiteMenu(models.Model):
    _inherit = "website.menu"

    is_megamenu = fields.Boolean(string='Is megamenu...?')
    megamenu_view_type = fields.Selection([('cat_megamenu', 'Category Megamenu'),
                                           ('cat_img_megamenu',
                                            "Category Image Megamenu"),
                                           ('prod_megamenu', "Products Megamenu"),
                                           ('pages_megamenu', "Pages Megamenu"),
                                           ('service_page_megamenu',
                                            "Service Menu"),
                                           ('service_content_megamenu',
                                            "Service Content Menu"),
                                           ('service_banner_megamenu',
                                            "Service Banner Menu")
                                           ],
                                          default='cat_megamenu',
                                          string="Megamenu View Type")
    is_service_menu = fields.Boolean(
        string='Is service menu...?', default=False)
    parent_megamenu_view_type = fields.Selection(related='parent_id.megamenu_view_type')
    is_service_content_menu = fields.Boolean(
        string='Is service content menu...?', default=False)
    megamenu_size = fields.Selection([('medium', 'Medium'),
                                      ('large', 'Large')],
                                     default='medium',
                                     string="Megamenu Size")

    megamenu_type = fields.Selection([
        ('2_col', '2 Columns'),
        ('3_col', '3 Columns'),
        ('4_col', '4 Columns')],
        default='3_col',
        string="Megamenu type")
    megamenu_type1 = fields.Selection([('1_col', '1 Columns'),
                                       ('2_col', '2 Columns'),
                                       ('3_col', '3 Columns'),
                                       ('4_col', '4 Columns')],
                                      default='3_col',
                                      string="Megamenu columns")
    category_slider = fields.Boolean(
        string='Want to display category slider', default=False)
    carousel_header_name = fields.Char(string="Slider label",
                                       default="Latest",
                                       translate=True,
                                       help="Header name for carousel slider in megamenu")
    category_slider_position = fields.Selection([('left', 'Left'), ('right', 'Right')],
                                                default='left', string="Category Slider Position")

    display_menu_footer = fields.Boolean(string="Display menu footer", default=False,
                                         help="For displaying footer in megamenu")
    menu_footer = fields.Html(string="Footer content",
                              translate=True,
                              help="Footer name for megamenu")
    megamenu_product_ids = fields.Many2many("product.template", string="Products", domain=[
        ('website_published', '=', True)])

    is_img_banner = fields.Boolean(
        string='Want to display Banner', default=False)
    img_banner = fields.Binary(
        string="image banner", help="Menu image banner for your menu")
    img_banner_position = fields.Selection(
        [('left', 'Left'), ('right', 'Right')], default='left', string="Image Banner Position")
    img_menu = fields.Binary(
        string="Menu image", help="Menu image  your menu")
    menu_desc = fields.Text(string="Menu description",
                            translate=True,
                            help="Menu description")
    service_content = fields.Html(string="Menu Content",
                                  translate=True,
                                  help="sub menu")
    banner_content = fields.Html(string="banner Content",
                                 translate=True,
                                 help="Banner description")
    img_grid = fields.Boolean(
        string='Want to display image grid', default=False)
    banner_images_ids = fields.One2many("banner.image", "website_menu_id", "Product Grid Images")

    @api.onchange('parent_id')
    def _on_change_parent(self):
        """ Password parent
        """
        if self.parent_id.megamenu_view_type == 'service_page_megamenu' or self.parent_id.megamenu_view_type == 'service_content_megamenu':
            self.is_service_menu = True
        else:
            self.is_service_menu = False

    def _scita_pages_megamenu(self):
        """ The Pages megamenu this menu is in (or is), else an empty recordset. """
        menu = self
        while menu:
            if menu.is_megamenu and menu.megamenu_view_type == 'pages_megamenu':
                return menu
            menu = menu.parent_id
        return self.browse()

    @api.constrains("parent_id", "child_id", "is_mega_menu", "mega_menu_content")
    def _validate_parent_menu(self):
        # The Pages megamenu lists pages under group headings: top menu > megamenu > group > page,
        # one level more than Odoo allows. Keep Odoo's rules for every other menu.
        pages = self.filtered(lambda m: m.sudo()._scita_pages_megamenu())
        super(WebsiteMenu, self - pages)._validate_parent_menu()
        for record in pages.sudo():
            megamenu = record._scita_pages_megamenu()
            # the whole megamenu: moving it (or a group) also moves what is under it
            for menu in self.sudo().search([('id', 'child_of', megamenu.id)]):
                level = len(menu.parent_path.split('/')) - 1  # 1: the website's top menu
                if (menu == megamenu and level != 2) or level > 4:
                    raise UserError(self.env._("A Scita Pages megamenu sits in the menu bar and only holds groups and their pages."))
                if menu.is_mega_menu:
                    raise UserError(self.env._("A mega menu cannot have a parent or child menu."))

    @api.constrains("is_megamenu", "megamenu_view_type")
    def _check_pages_megamenu_type(self):
        # only a Pages megamenu holds groups with pages: another type would leave a menu tree Odoo
        # refuses, and the website's Edit Menu dialog could no longer save any menu
        for record in self.sudo():
            if record.child_id.child_id and not record._scita_pages_megamenu():
                raise UserError(self.env._(
                    "Menu \"%s\" holds groups with pages, which only a Pages megamenu can show. "
                    "Move or remove those pages first.", record.name))

# a block that is not one of Odoo's (s_...), or one of Scita's named like them
_SCITA_BLOCK_RE = re.compile(r'data-snippet="(?!s_(?!theme_scita|appjetty))')


class website(models.Model):
    _inherit = 'website'

    header_logo = fields.Binary('Header Logo')
    footer_logo = fields.Binary('Footer Logo')
    shop_qty = fields.Boolean('Decimal Quantity')
    hide_price = fields.Boolean('Price Hide for Grid View')
    add_to_cart = fields.Boolean('Add Cart Button Hide')
    # For Multi image
    no_extra_options = fields.Boolean(string='Want to customize multi-image slider',
                                      default=False,
                                      help="Slider with all options for next, previous, play, pause, fullscreen, hide/show thumbnail panel.")
    interval_play = fields.Char(string='slideshow interval', default='5000',
                                help='With this field you can set the interval play time between two images.')
    enable_disable_text = fields.Boolean(string='Enable text panel',
                                         default=True,
                                         help='Enable/Disable text which is visible on the image in multi image.')
    color_opt_thumbnail = fields.Selection([
        ('default', 'Default'),
        ('b_n_w', 'B/W'),
        ('sepia', 'Sepia'),
        ('blur', 'Blur'), ],
        default='default',
        string="Thumbnail overlay effects")
    thumbnail_panel_position = fields.Selection([
        ('left', 'Left'),
        ('right', 'Right'),
        ('bottom', 'Bottom'),
    ], default='left',
        string='Thumbnails panel position',
        help="Select the position where you want to display the thumbnail panel in multi image.")
    change_thumbnail_size = fields.Boolean(
        string="Change thumbnail size", default=False)
    thumb_height = fields.Char(string='Thumb height', default=86)
    thumb_width = fields.Char(string='Thumb width', default=66)
    # For Brand setting
    is_brand_display = fields.Boolean(
        string="Brand display in product page", default=False)
    brand_display_option = fields.Selection([
        ('name', 'Name'),
        ('logo', 'Logo'),
    ], default='logo',
        string='Brand Display Option',
        help="Select the option for brand logo  or name display.")
    is_default_code = fields.Boolean(
        string="Default code display in product page", default=False)
    # is_amp_enable = fields.Boolean(
    #     string="Enable AMP", default=True)

    @api.model
    def theme_scita_payment_icons(self):
        return self.env['payment.method'].sudo().search([
            ('brand_ids.active', '=', True)], limit=5).brand_ids

    # for product brand
    def get_product_brands(self, category, **post):
        domain = []
        if category:
            cat_id = []
            if category != None:
                for ids in category:
                    cat_id.append(ids.id)
                domain += ['|', ('public_categ_ids.id', 'in', cat_id),
                           ('public_categ_ids.parent_id', 'in', cat_id)]
        else:
            domain = []
        # only products this website sells (not unpublished ones or another website's)
        domain += [('is_published', '=', True), ('sale_ok', '=', True)] + list(self.website_domain())
        product_ids = self.env["product.template"].sudo(
        ).search(domain)
        domain_brand = [
            ('product_ids', 'in', product_ids.ids or []), ('product_ids', '!=', False)]
        brands = self.env['product.brands'].sudo().search(domain_brand)
        return brands

    # for hr.employee
    def get_snippet_employee(self):
        employee = self.env['hr.employee'].sudo().search(
            [('include_inourteam', '=', True)])
        return employee

    def get_snippet_blog_post(self):
        post = self.env['blog.post'].sudo().search(
            [('website_published', '=', True)])
        return post

    # For pages megamenu
    def get_megamenu_pages(self, submenu):
        # child_id is prefetched for the whole menu tree: no query per menu
        return submenu.sudo().child_id

    # For pages megamenu count
    def get_megamenu_pages_count(self, submenu):
        return len(submenu.sudo().child_id)

    # For category megamenu
    def get_public_product_category(self, submenu):
        categories = self.env['product.public.category'].search(
            [('parent_id', '=', False), ("website_id", "in", (False, request.env.website.id)),
             ('include_in_megamenu',
              '!=', False),
             ('menu_id', '=', submenu.id)],
            order="name")
        return categories

    def get_all_public_product_category(self, submenu):
        categories = self.env['product.public.category'].search([("website_id", "in", (False, request.env.website.id)),
                                                                 ('include_in_megamenu',
                                                                  '!=', False),
                                                                 ('menu_id', '=', submenu.id)],
                                                                order="name")
        return categories

    # For child category megamenu
    def get_public_product_child_category(self, children):
        # one search for all the children (was one per child); same result and order
        allowed = self.env['product.public.category'].search([
            ('id', 'in', children.ids),
            ("website_id", "in", (False, request.env.website.id)),
            ('include_in_megamenu', '!=', False)])
        return [child for child in children if child in allowed]

    def get_parent_category_breadcum(self, category):
        data = []
        parent_cat = False
        if category:
            cat_data = self.env['product.public.category'].search(
                [('id', '=', int(category))])
            data.append(cat_data)
            parent_cat = cat_data
            if cat_data and cat_data.parent_id:
                parent_cat = cat_data.parent_id
                data.append(parent_cat)
                while parent_cat.parent_id:
                    parent_cat = parent_cat.parent_id
                    data.append(parent_cat)
            data.reverse()
        return data

    def get_user_address(self, user_id=None):
        address_details = {}
        if user_id:
            address_details['street'] = user_id.street if user_id.street else None
            address_details['street2'] = user_id.street2 if user_id.street2 else None
            address_details['city'] = user_id.city if user_id.city else None
            address_details['state_id'] = user_id.state_id.code if user_id.state_id else None
            address_details['country_id'] = user_id.country_id.code if user_id.country_id else None
            address_details['zip'] = user_id.zip if user_id.zip else None
        return address_details

    def get_all_category(self):
        shop_category = request.env['product.public.category'].sudo().search([])
        return shop_category

    def get_multiple_images(self, product_id=None):
        productsss = False
        if product_id:
            products = self.env['scita.product.images'].search(
                [('biz_product_tmpl_id', '=', product_id)], order='sequence')
            if products:
                return products
        return productsss

    def get_all_categories(self):
        categoriess = self.env['product.public.category'].search(
            [('include_in_allcategory', "=", True), ('parent_id', '=', False),
             ("website_id", "in", [False, request.env.website.id])])
        return categoriess

    # For category menu in topmenu
    def get_child_all_categories(self, child_id):
        child_categories = self.env['product.public.category'].search(
            [('include_in_allcategory', "=", True), ('parent_id', '=', child_id.id),
             ("website_id", "in", [False, request.env.website.id])], order="sequence asc")
        return child_categories

    def get_all_categories_menu(self):
        """Header "All Categories" menu in one query, instead of one search per category
        and sub-category on every page (get_all_categories / get_child_all_categories).
        Same categories and order: top level as the model's default order, children by
        sequence."""
        categories = self.env['product.public.category'].search([
            ('include_in_allcategory', '=', True),
            ('website_id', 'in', [False, request.env.website.id]),
        ])
        Category = self.env['product.public.category']
        children = {}
        for category in categories.filtered('parent_id').sorted(lambda c: (c.sequence, c.id)):
            children[category.parent_id.id] = children.get(category.parent_id.id, Category) | category
        return {
            'roots': categories.filtered(lambda c: not c.parent_id),
            'children': children,
        }

    def get_categories(self, category=None):
        cat = {}
        shop_category = request.env['product.public.category'].sudo().search(
            Domain('parent_id', '=', False) & self.website_domain(), order='name asc')
        cat.update({'categ': shop_category})
        return cat

    website_hide_price = fields.Boolean(
        string="Hide prices on website",
        copy=False,
        help="Hide price at website level",
    )
    website_show_price = fields.Boolean(compute="_compute_website_show_price")
    website_hide_price_default_message = fields.Char(
        string="Default Hidden price message",
        help="When the price is hidden on the website we can give the customer"
        "some tips on how to find it out.",
        translate=True,
    )
    login_see_price = fields.Boolean(
        string="Login to see price",
        help="Require users to log in to view prices on this website",
        readonly=False,
    )

    def _compute_website_show_price(self):
        # outside a request (cron, tests, backend calls) fall back on the env user
        user = request.env.user if request else self.env.user
        for rec in self:
            rec.website_show_price = (
                not rec.website_hide_price
                and user.partner_id.website_show_price
            )

    def _prevent_product_sale(self, product_or_template, is_zero_price_product):
        # "Request Quote" products are not sold online: their price is hidden (product_category.py)
        # and Odoo shows its Contact Us button (styled by Scita) in Add to Cart's place
        if product_or_template.quote_request:
            return True
        return super()._prevent_product_sale(product_or_template, is_zero_price_product)

    def _sct_hide_line_price(self, line):
        """Cart / checkout: hide this order line's price (Request Quote or login to see price)."""
        self.ensure_one()
        return bool(
            not self.website_show_price
            or (self.login_see_price and self.env.user._is_public())
            or (line and line.product_id.website_hide_price)
        )

    def _sct_hide_order_prices(self, order):
        """Cart / checkout totals: hidden as soon as one line's price is, since they'd reveal it."""
        self.ensure_one()
        return self._sct_hide_line_price(False) or bool(
            order and any(order.website_order_line.product_id.mapped('website_hide_price'))
        )



    # A CSS background is the worst case for LCP: the browser cannot even ask
    # for it until the stylesheet has parsed and the element has been laid out.
    # On the electronics demo that put the hero banner's discovery 2.06s into
    # the load. <img> is cheaper to discover but still waits behind the
    # stylesheet. Whichever of the two appears first in the page's own markup
    # is the top of the page, so that is the one worth a preload hint.
    # Odoo-stored images (website-editable fields like
    # theme_scita.sct_banner_slider_image) are served as /web/image/<model>.
    # <field>, with no file extension at all - only static theme assets under
    # /theme_scita/static/... end in .png/.jpg/etc. Matching only the
    # extension form (as this used to) silently misses every dynamic hero
    # image and falls through to whatever static <img> happens to appear
    # first in the arch instead - on this site that was a 430x116 category-
    # slider thumbnail nowhere near the real hero, wasting the one preload
    # slot on the wrong 4KB image while the real ~200KB hero got none.
    _SCITA_URL_BODY = r'/(?:web/image/[^"\'()&\s]+|[^"\'()&\s]+\.(?:png|jpe?g|webp|gif))'
    _SCITA_BG_IMAGE_RE = re.compile(
        r'background-image:\s*url\(\s*(?:&#34;|&quot;|["\'])?'
        r'(' + _SCITA_URL_BODY + r')'
    )
    _SCITA_IMG_TAG_RE = re.compile(r'<img\b[^>]*?>')
    _SCITA_IMG_SRC_RE = re.compile(r'\ssrc="(' + _SCITA_URL_BODY + r')"')
    _SCITA_IMG_WIDTH_RE = re.compile(r'\swidth="(\d+)"')

    def _scita_lcp_preload_href(self, main_object):
        """URL of the page's likely LCP image, or False.

        Only literal, same-origin URLs are considered - t-att-src is evaluated
        too late to be useful here, and guessing would risk preloading
        something the page never requests. Any failure returns False: a
        performance hint must never be able to break a page.
        """
        try:
            self.ensure_one()
            if main_object is not None and getattr(main_object, '_name', None) == 'product.template':
                request._scita_lcp_href = False  # its main image is eager-loaded by ir_qweb.py
                return False
            if main_object is None or 'arch' not in getattr(main_object, '_fields', {}):
                return False
            arch = main_object.sudo().arch
            if not arch:
                return False

            candidates = []
            background = self._SCITA_BG_IMAGE_RE.search(arch)
            if background:
                candidates.append((background.start(), background.group(1)))

            for tag in self._SCITA_IMG_TAG_RE.finditer(arch):
                markup = tag.group(0)
                src = self._SCITA_IMG_SRC_RE.search(markup)
                if not src:
                    # .svg is deliberately excluded: in this theme they are
                    # arrows and other chrome, never the LCP element.
                    continue
                declared = self._SCITA_IMG_WIDTH_RE.search(markup)
                if declared and int(declared.group(1)) < 200:
                    continue
                candidates.append((tag.start(), src.group(1)))
                break

            href = min(candidates)[1] if candidates else False
            # Recorded so ir_qweb's eager-image hook (models/ir_qweb.py) can
            # tell whether this request already has a definitive LCP answer.
            # Without this, that hook falls back to "first <img> in rendered
            # document order" - wrong whenever the real LCP is a CSS
            # background (as on the homepage hero), where it ends up
            # eager-loading + fetchpriority=high'ing an unrelated first
            # <img> instead, stealing bandwidth from the actual LCP resource
            # on the throttled connection.
            request._scita_lcp_href = href
            return href
        except Exception:  # noqa: BLE001
            return False

    def _scita_path_startswith(self, *prefixes):
        """The current URL path, without its language prefix (/ar/shop -> /shop), starts with
        one of `prefixes`: which pages get the shop / block styles render-blocking."""
        if not request:
            return False
        path = request.httprequest.path or '/'
        parts = path.split('/', 2)
        if len(parts) > 1 and parts[1] and parts[1] in self.language_ids.mapped('url_code'):
            path = '/' + (parts[2] if len(parts) > 2 else '')
        return path.startswith(prefixes)

    def _scita_page_has_theme_blocks(self, main_object):
        """A website page using Scita blocks: their styles (theme_scita.assets_snippet_product_css)
        are then loaded render-blocking. Loaded after the first paint, as on other pages, the
        blocks at the top of the page were laid out unstyled first, then moved (layout shift).
        Odoo's own blocks are all named s_..."""
        if not main_object or main_object._name != 'website.page':
            return False
        arch = main_object.sudo().view_id.arch_db or ''
        return bool(_SCITA_BLOCK_RE.search(arch))

    def _scita_product_snippet_rows_css(self):
        """Rows of cards of each "Multi Product Snippet 1" configuration (2, 3 and 4 cards per
        row), as CSS variables on the blocks using it: their placeholder reserves the height the
        products will take (snippets.scss), the page then does not move when they load."""
        self.ensure_one()
        return Markup(self._scita_product_snippet_rows_css_cached(self.id))

    @api.ormcache('website_id')
    def _scita_product_snippet_rows_css_cached(self, website_id):
        rules = []
        configs = self.env['product.snippet.configuration'].sudo().with_context(
            website_id=website_id).search([])
        for config in configs:
            count = len(config.collection_of_products.filtered('is_published')._scita_on_website())
            if count:
                rules.append('section[data-multi-cat-slider-type="%d"]{--sct-r2:%d;--sct-r3:%d;--sct-r4:%d}' % (
                    config.id, -(-count // 2), -(-count // 3), -(-count // 4)))
        return ''.join(rules)

    def _scita_google_font_css_hrefs(self):
        """Hrefs of the locally-hosted Google-font stylesheets, for preloading.

        Odoo's "host fonts locally" feature pulls the font CSS in with an
        ``@import`` from *inside* web.assets_frontend
        (addons/website/static/src/scss/website.scss). An @import nested in a
        render-blocking stylesheet is the worst case for discovery: the
        browser cannot request the font CSS until the whole ~1.4MB bundle has
        downloaded and parsed, and cannot request the woff2 files until that
        CSS in turn arrives. Measured on the 17 Aug 2026 mobile run that is a
        4-level critical chain, 2.03s of maximum critical path latency for a
        1.1KB file.

        Emitting a preload for the same URL in the initial HTML (see
        theme_scita_preload_google_font in views/website_view.xml) lets it be
        fetched in parallel with the bundle instead of serially after it; the
        @import then resolves from cache. The URL has to match the one the
        SCSS builds byte for byte or it would be a second request, hence the
        '/web/content/<id>/google-font-<name>' shape below.

        Attachment ids differ per database, so this is looked up rather than
        hard-coded. Any failure returns an empty list: a performance hint must
        never be able to break a page.
        """
        return list(self._scita_google_font_css_hrefs_cached())

    @api.model
    @api.ormcache(cache='assets')
    def _scita_google_font_css_hrefs_cached(self):
        """The lookup above, once: a LIKE on ir.attachment's name scans the whole table, on every
        page of the site (~9ms). Fonts are only added or removed through the website's style
        customisations, which clear the 'assets' cache."""
        try:
            attachments = self.env['ir.attachment'].sudo().search([
                ('name', 'like', '% (google-font)'),
                ('mimetype', '=', 'text/css'),
            ])
            hrefs = []
            for attachment in attachments:
                font_name = attachment.name.replace(' (google-font)', '').strip()
                if not font_name:
                    continue
                hrefs.append('/web/content/%s/google-font-%s' % (attachment.id, font_name))
            return tuple(hrefs)
        except Exception:  # noqa: BLE001
            return ()


class WebsiteSnippetFilter(models.Model):
    _inherit = 'website.snippet.filter'

    def _filter_records_to_values(self, records, **options):
        """Odoo's dynamic product blocks: hide the price where Scita hides it (login to see
        price, prices hidden on the website or for this customer, Request Quote products).
        Odoo's card template already leaves the price out when `hide_price` is set."""
        res_products = super()._filter_records_to_values(records, **options)
        if (self.model_name or options.get('res_model')) != 'product.product' or options.get('is_sample'):
            return res_products
        website = self.env.website
        hide_all = bool(website) and website._sct_hide_line_price(False)
        for res_product in res_products:
            product = res_product.get('_record')
            template = product.product_tmpl_id if product and product._name == 'product.product' else product
            if hide_all or (template and (template.website_hide_price or template.quote_request)):
                res_product['hide_price'] = True
        return res_products
