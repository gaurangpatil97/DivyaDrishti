import sys
import requests
from pathlib import Path

"""
Simple test client for the Flask /detect endpoint.
Usage:
  python test_detect.py C:\path\to\image.jpg
"""

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_detect.py <path-to-image>")
        sys.exit(1)

    img_path = Path(sys.argv[1])
    if not img_path.exists():
        print(f"Image not found: {img_path}")
        sys.exit(1)

    url = "http://localhost:5000/detect"
    with img_path.open("rb") as f:
        files = {"image": f}
        resp = requests.post(url, files=files)
        print(f"Status: {resp.status_code}")
        try:
            print(resp.json())
        except Exception:
            print(resp.text)
