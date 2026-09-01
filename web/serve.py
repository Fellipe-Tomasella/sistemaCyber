#!/usr/bin/env python3
"""
Servidor estático do AtléticaHub (dev).
- URLs limpas: /atletica/dashboard -> serve dashboard.html
- /pasta -> /pasta/ (index.html)
- 404 personalizado (404.html)
Uso:  python serve.py   (porta 4599)
"""
import http.server, socketserver, os, sys, socket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4599
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def send_head(self):
        raw = self.path.split('?', 1)[0].split('#', 1)[0]
        fs = self.translate_path(raw)
        # URL limpa: /x/y -> /x/y.html  (quando existe o .html e não é diretório)
        if not os.path.exists(fs) and not raw.endswith('/'):
            if os.path.exists(fs + '.html'):
                self.path = raw + '.html'
        return super().send_head()

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            page = os.path.join(ROOT, '404.html')
            if os.path.exists(page):
                with open(page, 'rb') as f:
                    body = f.read()
                self.send_response(404)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                if self.command != 'HEAD':
                    self.wfile.write(body)
                return
        return super().send_error(code, message, explain)

    def end_headers(self):
        # dev: nunca cachear html/js/css (evita ter que dar Ctrl+Shift+R)
        p = self.path.split('?', 1)[0]
        last = p.rsplit('/', 1)[-1]
        if p.endswith('/') or last == '' or last.endswith(('.html', '.js', '.css')) or '.' not in last:
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, *a):  # silencioso
        pass


# Servidor dual-stack: escuta IPv4 (127.0.0.1) E IPv6 (::1) —
# no Windows "localhost" costuma resolver pra ::1, então precisa dos dois.
class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    if socket.has_ipv6:
        address_family = socket.AF_INET6

    def server_bind(self):
        if self.socket.family == socket.AF_INET6:
            try:
                self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            except OSError:
                pass
        super().server_bind()


bind_host = '' if socket.has_ipv6 else '0.0.0.0'
try:
    httpd = Server((bind_host, PORT), Handler)
except OSError as e:
    print(f'Nao consegui subir na porta {PORT}: {e}')
    print('Provavelmente ja tem um servidor rodando nessa porta. Feche o outro ou use outra porta.')
    sys.exit(1)

with httpd:
    print(f'AtléticaHub em http://localhost:{PORT}/  (Ctrl+C para parar)')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
