import hashlib
import http.server
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from source import handler, load_pack


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.content = b'PK\x03\x04' + b'isolated permitted source fixture' * 100
        (self.root / 'approved.epub').write_bytes(self.content)
        self.manifest = self.root / 'catalogue.json'
        self.entries = [{'book': {'title': 'Frankenstein', 'author': 'Mary Shelley'},
                         'asset': {'file': 'approved.epub', 'sha256': hashlib.sha256(self.content).hexdigest()},
                         'rights': {'url': 'https://www.gutenberg.org/ebooks/84'}}]
        self.manifest.write_text(json.dumps(self.entries))

    def tearDown(self):
        self.directory.cleanup()

    def test_changed_asset_or_unsafe_manifest_never_starts(self):
        (self.root / 'approved.epub').write_bytes(b'PK\x03\x04different content')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            load_pack(self.manifest, self.root, 'http://source:8090')
        self.entries[0]['asset']['file'] = '../approved.epub'
        self.manifest.write_text(json.dumps(self.entries))
        with self.assertRaisesRegex(ValueError, 'asset name'):
            load_pack(self.manifest, self.root, 'http://source:8090')

    def test_feed_and_byte_ranges_expose_only_approved_assets(self):
        pack = load_pack(self.manifest, self.root, 'http://source:8090')
        self.assertNotIn(b'8:announce', pack['approved.epub']['torrent'])
        self.assertIn(b'7:privatei1e', pack['approved.epub']['torrent'])
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler(pack, 'http://source:8090'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        try:
            with urllib.request.urlopen(base + '/api?t=book&q=unlisted') as result:
                xml = result.read()
                self.assertEqual(xml.count(b'<item>'), 1)
                self.assertIn(b'Mary Shelley - EPUB - Frankenstein', xml)
            request = urllib.request.Request(base + '/assets/approved.epub', headers={'Range': 'bytes=10-29'})
            with urllib.request.urlopen(request) as result:
                self.assertEqual(result.status, 206)
                self.assertEqual(result.read(), self.content[10:30])
            for path in ['/assets/unlisted.epub', '/assets/../catalogue.json', '/assets/%2e%2e%2fcatalogue.json', '/torrents/unlisted.epub', '/private']:
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    urllib.request.urlopen(base + path)
                self.assertEqual(denied.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
