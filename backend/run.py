from __future__ import annotations

import threading
import webbrowser

import uvicorn

from app.config import AppConfig
from app.main import create_app


def open_browser(port: int):
    webbrowser.open(f"http://127.0.0.1:{port}")


def main():
    config = AppConfig.from_environment()
    app = create_app(config=config)
    threading.Timer(1.2, open_browser, args=(config.port,)).start()
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
