# -*- coding: utf-8 -*-
"""Smaller versions of website pictures, for the srcset and the phone background versions
models/ir_qweb.py adds to website pages: the theme's own files (theme_scita/static/...) and
uploaded JPEG/PNG attachments. Not Odoo's /web/image?width=: it saves at JPEG quality 95, so a
"smaller" version could weigh more than the original (an 828px photo: 378KB for a 304KB one)."""
import collections
import os
import threading

from werkzeug.exceptions import NotFound

from odoo import http
from odoo.exceptions import AccessError, MissingError
from odoo.http import request
from odoo.tools.image import image_process
from odoo.tools.misc import file_path

from odoo.addons.theme_scita.models.ir_qweb import RESPONSIVE_WIDTHS

QUALITY = 80
_MIMETYPES = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'}
_CACHE_SIZE = 256
_cache = collections.OrderedDict()
_cache_lock = threading.Lock()


def _resized(key, width, read):
    """`read()` (the picture's bytes) scaled down to `width` px, kept for the next requests:
    `key` names that version of the picture (a changed picture has another key)."""
    key = (key, width)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    data = image_process(read(), size=(width, 0), quality=QUALITY)
    with _cache_lock:
        _cache[key] = data
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return data


def _response(data, mimetype, unique, public=True):
    if not data:
        raise NotFound()
    # the URL names the version of the picture (unique=): a changed picture gets a new URL
    # shared caches must not keep a picture reserved to some visitors
    scope = 'public' if public else 'private'
    cache = f'{scope}, max-age=31536000, immutable' if unique else f'{scope}, max-age=86400'
    return request.make_response(data, headers=[('Content-Type', mimetype), ('Cache-Control', cache)])


class ScitaResponsiveImage(http.Controller):

    @http.route('/theme_scita/resized/<int:width>/<path:subpath>', type='http', auth='public',
                methods=['GET'], readonly=True, save_session=False)
    def scita_resized_theme_file(self, width, subpath, unique=None, **kwargs):
        extension = os.path.splitext(subpath)[1].lower()
        if width not in RESPONSIVE_WIDTHS or extension not in _MIMETYPES:
            raise NotFound()
        static_dir = os.path.realpath(file_path('theme_scita/static'))
        path = os.path.realpath(os.path.join(static_dir, subpath))
        if not path.startswith(static_dir + os.sep) or not os.path.isfile(path):
            raise NotFound()

        def read():
            with open(path, 'rb') as f:
                return f.read()
        return _response(_resized((path, os.path.getmtime(path)), width, read), _MIMETYPES[extension], unique)

    @http.route(['/theme_scita/resized_image/<int:attachment_id>/<int:width>',
                 '/theme_scita/resized_image/<int:attachment_id>/<int:width>/<string:filename>'],
                type='http', auth='public', methods=['GET'], readonly=True, save_session=False)
    def scita_resized_attachment(self, attachment_id, width, unique=None, filename=None, **kwargs):
        if width not in RESPONSIVE_WIDTHS:
            raise NotFound()
        try:
            # the access rules of /web/image: what the visitor may see there
            attachment = request.env['ir.binary']._find_record(res_id=attachment_id, field='raw')
        except (AccessError, MissingError):
            raise NotFound()
        if attachment.type != 'binary' or attachment.mimetype not in _MIMETYPES.values():
            raise NotFound()
        return _response(_resized(('ir.attachment', attachment.id, attachment.checksum), width,
                                  lambda: attachment.raw), attachment.mimetype, unique, attachment.public)
