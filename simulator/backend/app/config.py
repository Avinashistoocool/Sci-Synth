import os


class Settings:
    google_api_key: str = os.getenv("GOOGLE_API_KEY", "")
    backend_port: int = int(os.getenv("BACKEND_PORT", "8000"))
    backend_host: str = os.getenv("BACKEND_HOST", "127.0.0.1")


settings = Settings()
