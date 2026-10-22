"""Closed Torznab source and webseed for a finite, hash-verified public-domain pack.

No tracker, DHT, remote URL proxy, directory listing, upload or filesystem API.
Only a private Docker network reaches this service. The same approved manifest
restricts Bookseerr search and acquisition independently of this feed.
"""
import datetime
import hashlib
import http.server
import json
import os
from pathlib import Path
import urllib.parse
import xml.etree.ElementTree as ET


def bencode(value):
    if isinstance(value, int):
        return b'i' + str(value).encode() + b'e'
    if isinstance(value, str):
        value = value.encode()
    if isinstance(value, bytes):
        return str(len(value)).encode() + b':' + value
    if isinstance(value, list):
        return b'l' + b''.join(bencode(item) for item in value) + b'e'
    if isinstance(value, dict):
        return b'd' + b''.join(bencode(key) + bencode(value[key]) for key in sorted(value)) + b'e'
    raise TypeError('Unsupported torrent value')


def load_pack(manifest, assets, base):
    entries = json.loads(Path(manifest).read_text())
    if not isinstance(entries, list) or not 1 <= len(entries) <= 100:
        raise ValueError('An explicit approved catalogue is required')
    pack = {}
    for entry in entries:
        asset = entry['asset']
        name = asset['file']
        if Path(name).name != name or not name.endswith('.epub') or name in pack:
            raise ValueError('Invalid or duplicate asset name')
        content = (Path(assets) / name).read_bytes()
        if not content.startswith(b'PK\x03\x04') or len(content) > 20 * 1024 * 1024:
            raise ValueError('Only small approved EPUBs may be served')
        if hashlib.sha256(content).hexdigest() != asset['sha256']:
            raise ValueError('Asset checksum does not match its approved manifest')
        book = entry['book']
        file_name = book['author'] + ' - ' + book['title'] + '.epub'
        if any(character in file_name for character in '/\\\x00\r\n'):
            raise ValueError('Unsafe release title')
        piece_size = 262144
        info = {'name': file_name, 'length': len(content), 'piece length': piece_size,
                'pieces': b''.join(hashlib.sha1(content[i:i + piece_size]).digest()
                                   for i in range(0, len(content), piece_size)), 'private': 1}
        torrent = bencode({'info': info, 'url-list': [base + '/assets/' + urllib.parse.quote(name)],
                           'comment': 'Bookseerr public-domain review catalogue. Source: ' + entry['rights']['url']})
        pack[name] = {'content': content, 'torrent': torrent, 'hash': hashlib.sha1(bencode(info)).hexdigest(),
                      'title': book['author'] + ' - EPUB - ' + book['title'], 'book': book,
                      'source': entry['rights']['url']}
    return pack


def handler(pack, base):
    class Source(http.server.BaseHTTPRequestHandler):
        server_version = 'BookseerrCuratedSource/1'

        def log_message(self, *args):
            pass

        def send(self, status, data, mime):
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)

        def do_GET(self):
            parsed = urllib.parse.urlsplit(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            if parsed.path == '/health':
                return self.send(200, b'{"status":"ok"}', 'application/json')
            for prefix, field, mime in [('/assets/', 'content', 'application/epub+zip'),
                                         ('/torrents/', 'torrent', 'application/x-bittorrent')]:
                if parsed.path.startswith(prefix):
                    name = urllib.parse.unquote(parsed.path[len(prefix):])
                    if name not in pack:
                        return self.send(404, b'Not found', 'text/plain')
                    content = pack[name][field]
                    # qBittorrent's HTTP webseed requests a byte range.
                    if field == 'content' and self.headers.get('Range'):
                        import re
                        match = re.fullmatch(r'bytes=(\d+)-(\d*)', self.headers['Range'])
                        if not match:
                            return self.send(416, b'Invalid range', 'text/plain')
                        start, end = int(match[1]), int(match[2]) if match[2] else len(content) - 1
                        if not 0 <= start <= end < len(content):
                            return self.send(416, b'Invalid range', 'text/plain')
                        self.send_response(206)
                        self.send_header('Content-Type', mime)
                        self.send_header('Content-Range', f'bytes {start}-{end}/{len(content)}')
                        self.send_header('Content-Length', str(end - start + 1))
                        self.send_header('Accept-Ranges', 'bytes')
                        self.end_headers()
                        if self.command != 'HEAD':
                            self.wfile.write(content[start:end + 1])
                        return
                    return self.send(200, content, mime)
            if parsed.path not in ('/', '/api'):
                return self.send(404, b'Not found', 'text/plain')
            action = query.get('t', ['search'])[0]
            if action == 'caps':
                return self.send(200, b'''<?xml version="1.0"?><caps><server version="1" title="Bookseerr public-domain catalogue"/><limits max="100" default="100"/><registration available="no" open="no"/><searching><search available="yes" supportedParams="q"/><book-search available="yes" supportedParams="q,author,title"/></searching><categories><category id="7000" name="Books"><subcat id="7020" name="EBook"/></category></categories></caps>''', 'application/xml')
            if action not in ('search', 'book'):
                return self.send(400, b'Unsupported action', 'text/plain')
            root = ET.Element('rss', {'version': '2.0', 'xmlns:torznab': 'http://torznab.com/schemas/2015/feed'})
            channel = ET.SubElement(root, 'channel')
            ET.SubElement(channel, 'title').text = 'Bookseerr public-domain catalogue'
            ET.SubElement(channel, 'description').text = 'A finite catalogue of approved public-domain EPUB editions.'
            ET.SubElement(channel, 'link').text = base
            for name, value in pack.items():
                item = ET.SubElement(channel, 'item')
                ET.SubElement(item, 'title').text = value['title']
                ET.SubElement(item, 'guid', {'isPermaLink': 'false'}).text = value['hash']
                url = base + '/torrents/' + urllib.parse.quote(name)
                ET.SubElement(item, 'link').text = url
                ET.SubElement(item, 'pubDate').text = datetime.datetime.now(datetime.timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')
                ET.SubElement(item, 'size').text = str(len(value['content']))
                ET.SubElement(item, 'enclosure', {'url': url, 'length': str(len(value['content'])), 'type': 'application/x-bittorrent'})
                for key, val in {'category': '7020', 'infohash': value['hash'], 'seeders': '0', 'peers': '0',
                                 'author': value['book']['author'], 'title': value['book']['title'], 'language': 'en'}.items():
                    ET.SubElement(item, 'torznab:attr', {'name': key, 'value': val})
            self.send(200, ET.tostring(root, encoding='utf-8', xml_declaration=True), 'application/rss+xml')

        do_HEAD = do_GET
    return Source


if __name__ == '__main__':
    base = os.environ['SOURCE_BASE_URL'].rstrip('/')
    pack = load_pack('/source/catalogue.json', '/assets', base)
    http.server.ThreadingHTTPServer(('0.0.0.0', 8090), handler(pack, base)).serve_forever()
