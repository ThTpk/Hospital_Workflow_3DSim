#!/usr/bin/env python3
"""
เซิร์ฟเวอร์สำหรับพัฒนา — เหมือน `python -m http.server` แต่ปิด cache

ทำไมต้องมี: `python -m http.server` ไม่ส่ง Cache-Control เบราว์เซอร์จึงใช้
heuristic caching เก็บไฟล์ .js ไว้เอง แก้โค้ดแล้วกด reload ก็ยังได้ของเก่า
ซึ่งทำให้ไล่ปัญหาผิดทางได้ง่ายมาก

ใช้งาน:  python serve.py        (พอร์ต 8765)
         python serve.py 3000
"""

import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        # ตัด If-Modified-Since ทิ้ง ไม่ให้ตอบ 304 กลับไป
        self.headers.replace_header("If-Modified-Since", "") if "If-Modified-Since" in self.headers else None
        if "If-None-Match" in self.headers:
            del self.headers["If-None-Match"]
        return super().send_head()

    def log_message(self, fmt, *args):
        # เงียบ ๆ ไม่ให้ท่วม terminal
        if "304" not in (args[1] if len(args) > 1 else ""):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("", PORT), NoCacheHandler) as httpd:
        print(f"เปิดที่ http://localhost:{PORT}  (Ctrl+C เพื่อหยุด)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nหยุดแล้ว")
