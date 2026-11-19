# -*- coding: utf-8 -*-
"""
Wraps Odoo's WSGI application with gzip response compression.

Mobile Lighthouse testing found this environment has no reverse proxy in
front of Odoo handling compression: the theme's ~1.3MB CSS bundle was being
sent completely uncompressed, costing ~6.5s of render-blocking time alone
under throttled mobile network conditions - by far the single biggest
performance cost found in this theme.

In a real production deployment this belongs at the reverse-proxy/CDN layer
(nginx, an ALB, CloudFront, etc.) rather than in application code - it's
more efficient there and every Odoo deployment guide recommends it. This
module is a stand-in for environments where that layer isn't configured yet
(or, as here, doesn't exist locally). It's safe either way: it only acts
when the client sent no existing Content-Encoding and the response isn't
already encoded, so it won't double-compress behind a proxy that already
handles this.
"""
import gzip
import logging
import threading
from collections import OrderedDict

from odoo.http import request
from odoo.http.router import Application
from odoo.orm.registry import Registry

_logger = logging.getLogger(__name__)


def _theme_scita_installed():
    """True only when the current request's database has theme_scita installed.

    The patch below is process-wide (one Odoo server can serve several
    databases, and it stays loaded after the module is uninstalled), so it
    must stay inert for requests without a database or for a database that
    does not have the theme. Called from start_response, while the request
    is still bound.
    """
    try:
        registry = request.registry or (request.db and Registry.registries.get(request.db))
    except RuntimeError:  # no request bound
        return False
    return bool(registry) and 'theme_scita' in registry._init_modules

# Compressing the frontend bundles costs real CPU on every single hit
# (measured: 26ms for the 2.1MB stylesheet, 65ms for the 2.7MB script), and
# that lands squarely in front of first paint, so compressed asset bundles are
# kept. The key is the URL *and* the ETag Odoo sends for the bundle (a checksum
# of its content): the URL alone is not enough, as Odoo can rebuild a bundle
# under the same URL (e.g. after missing filestore files are restored) and one
# server can serve several databases whose bundles share a URL. Bounded so a
# long-running worker cannot grow without limit.
_ASSET_URL_PREFIX = '/web/assets/'
_CACHE_MAX_ENTRIES = 24
_cache = OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(key):
    with _cache_lock:
        if key not in _cache:
            return None
        _cache.move_to_end(key)
        return _cache[key]


def _cache_put(key, value):
    with _cache_lock:
        _cache[key] = value
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)

COMPRESSIBLE_TYPES = frozenset((
    'text/css', 'text/html', 'text/javascript', 'text/plain', 'text/xml',
    'application/javascript', 'application/json', 'application/xml',
    'image/svg+xml',
))
MIN_SIZE_TO_COMPRESS = 1024

_patched = False


def _passthrough(head, iterator, app_iter):
    """Re-yield an untouched response without collapsing it into memory."""
    try:
        yield from head
        yield from iterator
    finally:
        if hasattr(app_iter, 'close'):
            app_iter.close()


def _patch_gzip_compression():
    global _patched
    if _patched:
        return
    _patched = True

    original_call = Application.__call__

    def gzip_call(self, environ, start_response):
        if 'gzip' not in environ.get('HTTP_ACCEPT_ENCODING', ''):
            return original_call(self, environ, start_response)
        # Connection upgrades (the bus websocket) must reach the server
        # untouched: Odoo's server writes the 101 headers when
        # start_response is called, and the websocket loop starts when the
        # response is closed. Deferring the first and triggering the second
        # (below) runs the loop on a socket the client never saw upgraded,
        # then writes the headers to it after it has been closed.
        if environ.get('HTTP_UPGRADE'):
            return original_call(self, environ, start_response)

        path = environ.get('PATH_INFO', '')
        # Only plain GETs of asset bundles are served from / stored in the cache:
        # a HEAD has no body to replay and a Range request expects a part of it.
        cacheable = (
            path.startswith(_ASSET_URL_PREFIX)
            and environ.get('REQUEST_METHOD') == 'GET'
            and not environ.get('HTTP_RANGE')
        )

        captured = {}

        def capturing_start_response(status, headers, exc_info=None):
            captured['status'] = status
            captured['headers'] = headers
            captured['exc_info'] = exc_info
            captured['active'] = _theme_scita_installed()
            return lambda data: None

        app_iter = original_call(self, environ, capturing_start_response)
        iterator = iter(app_iter)

        # A generator-based response only calls start_response on its first
        # yield, so pull chunks until the headers are known. Everything below
        # depends on seeing the real Content-Type.
        head = []
        while 'headers' not in captured:
            try:
                head.append(next(iterator))
            except StopIteration:
                break

        headers = captured.get('headers') or []
        header_dict = {k.lower(): v for k, v in headers}
        content_type = header_dict.get('content-type', '').split(';')[0].strip()

        compressible = (
            captured.get('active')
            and not captured.get('status', '').startswith('1')
            and 'content-encoding' not in header_dict
            and 'content-range' not in header_dict
            and content_type in COMPRESSIBLE_TYPES
        )
        if not compressible:
            # Not ours to touch. Hand the response straight back and keep it
            # streaming - buffering here would pull every binary download,
            # attachment and report fully into memory.
            start_response(captured.get('status'), headers, captured.get('exc_info'))
            return _passthrough(head, iterator, app_iter)

        # Only a plain 200 with an ETag is cached - a 304 or a redirect must never be
        # replayed as a body. Odoo still answers the request (session, access, the
        # current ETag), so a hit only skips reading and compressing the body.
        etag = header_dict.get('etag')
        cache_key = (path, etag) if cacheable and etag and captured['status'].startswith('200') else None
        compressed = _cache_get(cache_key) if cache_key else None
        if compressed is not None:
            if hasattr(app_iter, 'close'):
                app_iter.close()
        else:
            try:
                body = b''.join(head) + b''.join(iterator)
            finally:
                if hasattr(app_iter, 'close'):
                    app_iter.close()

            if len(body) < MIN_SIZE_TO_COMPRESS:
                start_response(captured['status'], headers, captured.get('exc_info'))
                return [body]

            compressed = gzip.compress(body, compresslevel=6)
            if cache_key:
                _cache_put(cache_key, compressed)

        # headers come from this response every time, so a visitor never gets
        # another visitor's Set-Cookie (session) from a cached copy
        new_headers = [
            (k, v) for k, v in headers
            if k.lower() not in ('content-length', 'vary')
        ]
        vary = header_dict.get('vary')
        vary_values = [v.strip() for v in vary.split(',')] if vary else []
        if not any(v.lower() == 'accept-encoding' for v in vary_values):
            vary_values.append('Accept-Encoding')
        new_headers.append(('Content-Encoding', 'gzip'))
        new_headers.append(('Content-Length', str(len(compressed))))
        new_headers.append(('Vary', ', '.join(vary_values)))

        start_response(captured['status'], new_headers, captured.get('exc_info'))
        return [compressed]

    Application.__call__ = gzip_call
    _logger.info("theme_scita: gzip response compression enabled (no reverse proxy detected)")


_patch_gzip_compression()
