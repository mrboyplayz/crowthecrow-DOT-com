import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import a2s

SERVERS = [
    {"name": "CROW'S ZCITY | EU 1 | OPEN", "address": ("45.152.160.251", 25569)},
    {"name": "CROW'S ZCITY | EU 2 | OPEN", "address": ("45.152.160.251", 25648)},
]

HOST = "0.0.0.0"
PORT = 8787


def fetch_server(server_info):
    host, port = server_info["address"]
    try:
        info = a2s.info((host, port), timeout=3)
        return {
            "address": f"{host}:{port}",
            "name": info.server_name or server_info["name"],
            "players": info.player_count,
            "max_players": info.max_players,
            "map": info.map_name,
            "success": True,
        }
    except Exception as error:
        return {
            "address": f"{host}:{port}",
            "name": server_info["name"],
            "success": False,
            "error": str(error),
        }


class StatusHandler(BaseHTTPRequestHandler):
    def _write_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._write_json(204, {})

    def do_GET(self):
        if self.path != "/status":
            self._write_json(404, {"error": "Not found"})
            return
        servers = [fetch_server(server) for server in SERVERS]
        self._write_json(200, {"servers": servers})


def main():
    server = HTTPServer((HOST, PORT), StatusHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
