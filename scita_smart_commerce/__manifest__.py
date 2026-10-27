{
    'name': 'Scita Smart Commerce',
    'summary': 'AI shopping assistant, visual search, AI comparison, price alerts, '
               'product hotspots on any image with 3D/AR and a free-shipping progress bar for Theme Scita',
    'description': """
Smart commerce add-on for Theme Scita (Odoo 20):

* AI Shopping Assistant: chat bubble that answers product questions, recommends
  catalogue items and can add them to the cart.
* AI Visual Search: find visually similar products from a photo.
* Product Comparison 2.0: AI explanation of the differences between compared products.
* Price Drop Alerts: shoppers pick "any drop", "at least N% off" or their own price and
  get one email when it happens (re-checked as soon as a price changes, waits while sold
  out), then decide to keep watching; managed from My Account > Price Alerts.
* Product hotspots on any image of any block (banners, carousels, image blocks): added by
  clicking on the image in the website editor, with a live product card and a
  "view in your room" 3D/AR viewer.
* Smart free-shipping progress bar in the cart and mini-cart.

The AI features use the shop owner's own API key (Anthropic Claude by default,
OpenAI or Google Gemini selectable) configured in Website settings.
""",
    'author': 'AppJetty',
    'website': 'https://www.appjetty.com/',
    'category': 'Website/eCommerce',
    'version': '20.0.1.5.0',
    'license': 'OPL-1',
    'depends': [
        'theme_scita',
        'website_sale',
        'website_sale_stock',
        'delivery',
        'mail',
    ],
    'data': [
        'security/ir.access.csv',
        'data/price_alert_data.xml',
        'data/portal_entry_data.xml',
        'views/ai_usage_views.xml',
        'views/assistant_templates.xml',
        'views/visual_search_templates.xml',
        'views/compare_ai_templates.xml',
        'views/price_alert_views.xml',
        'views/price_alert_templates.xml',
        'views/res_config_settings_views.xml',
        'views/free_shipping_templates.xml',
        'views/product_template_views.xml',
        'views/ar_photo_wizard_views.xml',
        'views/hotspot_ar_templates.xml',
    ],
    'assets': {
        'web.assets_frontend': [
            'scita_smart_commerce/static/src/assistant/**/*',
            'scita_smart_commerce/static/src/visual_search/**/*',
            'scita_smart_commerce/static/src/compare_ai/**/*',
            'scita_smart_commerce/static/src/price_alert/**/*',
            'scita_smart_commerce/static/src/hotspot_ar/**/*',
            'scita_smart_commerce/static/src/hotspots/*',
            'scita_smart_commerce/static/src/free_shipping/**/*',
        ],
        # website editor: product hotspots on any image (add by clicking, drag, product picker)
        'website.website_builder_assets': [
            'scita_smart_commerce/static/src/hotspots/builder/**/*',
        ],
    },
    'installable': True,
    'application': False,
    # Installed together with Theme Scita: as soon as theme_scita gets installed (from the
    # Apps list, `-i theme_scita` or the website's theme picker), Odoo installs this add-on
    # too, with its remaining dependencies. The features themselves stay off until enabled
    # in Website settings.
    'auto_install': ['theme_scita'],
}
