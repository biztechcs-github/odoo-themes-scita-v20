# -*- coding: utf-8 -*-
# Part of AppJetty. See LICENSE file for full copyright and licensing details.

from markupsafe import Markup

from odoo import api, fields, models, tools
from odoo.exceptions import MissingError
from odoo.fields import Domain
from odoo.addons.website_sale.controllers import main


class ProductPublicCategory(models.Model):
    _inherit = 'product.public.category'

    include_in_allcategory = fields.Boolean(
        string="Enable All Category", help="Include in allcategory", default=True)
    linked_product_count = fields.Integer(string='# of Products')
    include_in_megamenu = fields.Boolean(
        string="Include in mega menu", help="Include in mega menu")
    menu_id = fields.Many2one('website.menu', string="Main menu")
    description = fields.Text(string="Slider Description",
                              translate=True,
                              help="""Short description which will be 
                              visible below category slider.""")
    attributes_ids = fields.Many2many('product.attribute', 'product_category_attribute_rel', 'category_id',
                                      'attribute_id', string="Attributes", domain="[('visibility', '=', 'visible')]")
    attributes_ids_values = fields.Many2many('product.attribute.value',
                                             domain="[('attribute_id', 'in', attributes_ids)]",
                                             string="Attributes Values")
    align_category_content = fields.Selection(
        [
            ("left", "Left"),
            ("center", "Center"),
            ("right", "Right"),  
        ],
        string="Align Category Content",
        default="center",
    )

    def _scita_on_website(self):
        """The records the current website may show: those without a website or on this one
        (Scita blocks read their products from configurations shared by all websites)."""
        website = self.env.website
        if not website:
            return self
        domain = website.website_domain()
        if 'company_id' in self._fields:
            # and of the website's company (products of another company can't be sold here)
            domain &= Domain('company_id', 'in', [False, website.company_id.id])
        # read as superuser: a visitor may not even read a record of another website.
        # Records of a relation (menus, sliders: rendered on every page) are prefetched, so
        # filter them directly; exists() (one query per call) only when an id was deleted.
        try:
            kept = self.sudo().filtered_domain(domain)
        except MissingError:
            kept = self.exists().sudo().filtered_domain(domain)
        return kept.with_env(self.env)  # keeps the prefetch of the whole menu tree

    @api.onchange('attributes_ids')
    def onchange_website_attributes_ids(self):
        if self.child_id:
            for child in self.child_id:
                child._origin.attributes_ids = self.attributes_ids
                child._origin.onchange_website_attributes_ids()
class ProductStyleTags(models.Model):
    _name = 'biztech.product.style.tag'
    _description = 'Product Style Tags'

    name = fields.Char(string='Tag Name', required=True, translate=True)
    color = fields.Selection(
        [('blue', 'Blue'), ('red', 'Red'), ('yellow', 'Yellow'), ('brown', 'Brown')], string="Color ")
    color_code = fields.Char(string='Color', required=True)
    font_color_code = fields.Char(string='Font Color', required=True)
    style = fields.Selection(
        [('style1', 'Style 1'), ('style2', 'Style 2'), ('style3', 'Style 3'), ('style4', 'Style 4'),
         ('style5', 'Style 5')], string="Style", required=True)
    position = fields.Selection(
        [('left', 'Left'), ('right', 'Right')], string="Position", default='right', required=True)
    product_ids = fields.One2many(
        'product.template',
        'product_style_tag_id',
        string='Product Tags',
    )


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    product_brand_id = fields.Many2one(
        'product.brands',
        string='Brand',
        help='Select a brand for this product'
    )
    # tag_ids = fields.Many2many('biztech.product.tags', string="Product Tags")
    product_style_tag_id = fields.Many2one(
        'biztech.product.style.tag',
        string='Style Tags',
        help='Select a tag for this product'
    )
    biz_images = fields.One2many('scita.product.images', 'biz_product_tmpl_id',
                                 string='Product Images')
    deal_product = fields.Boolean(string='Available for deal of the day')

    similar_product_ids = fields.Many2many(
        'product.template',
        'product_template_similar_rel',
        'product_id',
        'similar_product_id',
        string='Similar Products'
    )
    website_hide_price = fields.Boolean(string="Enabling Request a Quote for Individual Products")
    website_hide_price_message = fields.Text(
        string="Hidden price message",
        help="When the price is hidden on the website we can give the customer"
        "some tips on how to find it out.",
        translate=True,
    )

    def _scita_on_website(self):
        """The records the current website may show: those without a website or on this one
        (Scita blocks read their products from configurations shared by all websites)."""
        website = self.env.website
        if not website:
            return self
        domain = website.website_domain()
        if 'company_id' in self._fields:
            # and of the website's company (products of another company can't be sold here)
            domain &= Domain('company_id', 'in', [False, website.company_id.id])
        # read as superuser: a visitor may not even read a record of another website.
        # Records of a relation (menus, sliders: rendered on every page) are prefetched, so
        # filter them directly; exists() (one query per call) only when an id was deleted.
        try:
            kept = self.sudo().filtered_domain(domain)
        except MissingError:
            kept = self.exists().sudo().filtered_domain(domain)
        return kept.with_env(self.env)  # keeps the prefetch of the whole menu tree

    def _sct_hidden_price_message(self):
        """The text shown where this product's price would be, while Scita hides it (prices
        hidden on the website or for this product, or a Request Quote product): the product's
        "Hidden price message", else the website's "Default Hidden price message". Empty when
        the price shows, or when the visitor only has to log in (a Login button says so)."""
        self.ensure_one()
        website = self.env.website
        if not website or (website.login_see_price and self.env.user._is_public()):
            return ''
        if website.website_show_price and not self.website_hide_price and not self.quote_request:
            return ''
        return self.website_hide_price_message or website.website_hide_price_default_message or ''

    def _search_render_results(self, fetch_fields, mapping, icon, limit):
        """Hide price on the search bar results"""
        results_data = super()._search_render_results(
            fetch_fields, mapping, icon, limit
        )
        website_show_price = (
            self.env.website.website_show_price
        )
        login_to_see_price = (
            self.env.website.login_see_price and self.env.user._is_public()
        )
        for product, data in zip(self, results_data, strict=True):
            if login_to_see_price:
                data.update({"price": "", "list_price": ""})
            elif product.website_hide_price or product.quote_request or not website_show_price:
                # Markup: a plain str was escaped and showed the <span> tags as text
                message = product._sct_hidden_price_message()
                data.update({
                    "price": Markup("<span>%s</span>") % message if message else "",
                    "list_price": "",
                })
        return results_data

    def _is_add_to_cart_possible(self, parent_combination=None):
        """Removed from website_sale in Odoo 20; Scita templates still use it (same logic as 19)."""
        self.ensure_one()
        if not self.active or not self.filtered_domain(self.env['website']._product_domain()):
            return False
        return next(self._get_possible_combinations(parent_combination), False) is not False

    def quick_publish_product(self):
        self.ensure_one()
        self.is_published = not (self.is_published)

    def action_product_publish(self):
        self.is_published = True

    def action_product_unpublish(self):
        self.is_published = False

    @api.model
    def _search_get_detail(self, website, order, options):
        search_details = super()._search_get_detail(website, order, options)
        if options.get('brandlistdomain'):
            search_details['base_domain'].append([('product_brand_id', 'in', options.get('brandlistdomain'))])
        return search_details

    def _get_product_variant(self, attrib_value):
        """Ids of the variants with `attrib_value` that have an image (their own or the
        template's, as product.product.image_512). Called for every swatch of every
        product card: reads the prefetched variants instead of one search per swatch,
        and reads a variant's own image only when the template has none."""
        variants = self.product_variant_ids.filtered(
            lambda variant: attrib_value in variant.product_template_attribute_value_ids)
        if self.image_512:
            return variants.ids
        return [variant.id for variant in variants if variant.image_variant_512]
    
    quote_request = fields.Boolean(string="Request Quote",
                                    help="Hides the price and 'Add to Cart' button, so customers must request a quote by contacting the seller.")

    def _get_combination_info(
        self,
        combination=False,
        product_id=False,
        add_qty=1.0,
        only_template=False,
        **kwargs
    ):
        """Extend combination info to include quote_request."""
        combination_info = super()._get_combination_info(
            combination=combination,
            product_id=product_id,
            add_qty=add_qty,
            only_template=only_template,
            **kwargs
        )
        combination_info['quote_request'] = self.quote_request
        # price hidden by Scita (login to see price, prices hidden, Request Quote): say so, as
        # the compare bar, compare page and wishlist only check `hide_price`
        website = self.env.website
        if website and (self.quote_request or website._sct_hide_line_price(False)
                        or self.website_hide_price):
            combination_info.update(hide_price=True, compare_list_price=0)
        return combination_info

    def _scita_bulk_prices(self, variant, pricelist):
        """Bulk-buy tiers of this product for `pricelist`: one dict per minimum quantity
        (>= 2) with the unit price at that quantity, as Odoo prices it (fixed, percentage,
        discount or formula rule, taxes as the website shows them).

        :return: [{'min_quantity': int, 'fixed_price': float}] sorted by quantity
        """
        self.ensure_one()
        if not pricelist:
            return []
        rules = pricelist.item_ids.filtered(
            lambda r: r.product_tmpl_id == self and r.min_quantity and r.min_quantity >= 2
            and (not r.product_id or (variant and r.product_id == variant))
        )
        tiers = {}
        for quantity in sorted({int(r.min_quantity) for r in rules}):
            info = self._get_combination_info(
                product_id=variant.id if variant else False, add_qty=quantity, pricelist=pricelist)
            tiers[quantity] = info['price']
        return [{'min_quantity': quantity, 'fixed_price': price} for quantity, price in tiers.items()]

    def _website_show_quick_add(self, product=None):
        """Hide the quick add to cart option on website if quote_request is enabled."""
        # Odoo 20 passes the variant (product.product calls it with `self`)
        if self.quote_request or self.website_hide_price:
            return False
        # no price shown (login to see price, prices hidden): no quick "Add to Cart" either
        website = self.env.website
        if website and website._sct_hide_line_price(False):
            return False
        return super()._website_show_quick_add(product=product)

    def _search_render_results_prices(self, mapping, combination_info):
        """Modify displayed price in search results if quote_request is enabled."""
        # Odoo 20 returns only the rendered price (no list price any more)
        price = super()._search_render_results_prices(mapping, combination_info)

        if combination_info.get('quote_request'):
            price = 'Not Available For Sale'

        return price


class ProductProduct(models.Model):
    _inherit = 'product.product'

    def quick_publish_product(self):
        self.ensure_one()
        self.is_published = not (self.is_published)

    def action_product_publish(self):
        self.is_published = True

    def action_product_unpublish(self):
        self.is_published = False


class Brands(models.Model):
    _name = 'product.brands'
    _description = 'Product brands'
    _order = "sequence"

    active = fields.Boolean(
        string="Active", default=True, help="""Active true will brand is display""")
    sequence = fields.Integer()
    name = fields.Char(string='Brand Name', required=True, translate=True)
    brand_description = fields.Text(string='Description', translate=True)
    image = fields.Binary(string='Brand Logo', attachment=True, )
    image_medium = fields.Binary("Medium-sized Image", attachment=True,
                                 help="Medium-sized logo of the brand. It is automatically "
                                      "resized as a 128x128px image, with aspect ratio preserved. "
                                      "Use this field in form views or some kanban views.")
    image_small = fields.Binary("Small-sized Image", attachment=True,
                                help="Small-sized logo of the brand. It is automatically "
                                     "resized as a 64x64px image, with aspect ratio preserved. "
                                     "Use this field anywhere a small image is required.")
    brand_cover = fields.Binary(string='Brand Cover', attachment=True, )
    product_ids = fields.One2many(
        'product.template',
        'product_brand_id',
        string='Product Brands',
    )
    products_count = fields.Integer(
        string='Number Of Products',
        compute='_get_products_count',
    )

    _unique_tag_name = models.UniqueIndex(
        "(name)",
        "Brands name should be unique..!",
    )
    @api.depends('product_ids')
    def _get_products_count(self):
        for brand in self:
            brand.products_count = len(brand.product_ids)

class ScitaMultiProductImages(models.Model):
    _name = 'scita.product.images'
    _description = "Add Multiple Image in Product"

    name = fields.Char(string='Title', translate=True)
    alt = fields.Char(string='Alt', translate=True)
    attach_type = fields.Selection([('image', 'Image'), ('video', 'Video')],
                                   default='image',
                                   string="Type")
    image = fields.Binary(string='Image', store=True, attachment=True)
    video_type = fields.Selection([('youtube', 'Youtube'),
                                   ('vimeo', 'Vimeo'),
                                   ('html5video', 'Html5 Video')],
                                  default='youtube',
                                  string="Video media player")
    cover_image = fields.Binary(string='Cover image', store=True, attachment=True,
                                help="Cover Image will be show untill video is loaded.")
    video_id = fields.Char(string='Video ID')
    video_ogv = fields.Char(
        string='Video OGV', help="Link for ogv format video")
    video_webm = fields.Char(
        string='Video WEBM', help="Link for webm format video")
    video_mp4 = fields.Char(
        string='Video MP4', help="Link for mp4 format video")
    sequence = fields.Integer(string='Sort Order')
    biz_product_tmpl_id = fields.Many2one('product.template', string='Product')
    more_view_exclude = fields.Boolean(string="More View Exclude")


class Zipcodes(models.Model):
    _name = 'delivery.zipcode'
    _description = "Delivery Area Zipcode Configuration"

    name = fields.Char(string='Zipcode', required=True)
