import json
import os
import uuid
from datetime import datetime


class History:
    def __init__(self, path=None):
        if path is None:
            base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            path = os.path.join(base, 'history.json')
        self.path = path
        self.entries = []
        self.load()

    def load(self):
        if os.path.exists(self.path):
            with open(self.path, 'r', encoding='utf-8') as f:
                self.entries = json.load(f)

    def save(self):
        os.makedirs(os.path.dirname(self.path) or '.', exist_ok=True)
        with open(self.path, 'w', encoding='utf-8') as f:
            json.dump(self.entries, f, indent=2, ensure_ascii=False)

    def add(self, source_file, duration, clone_count, method, fmt, elapsed_total):
        entry = {
            'id': str(uuid.uuid4()),
            'source_file': source_file,
            'duration': duration,
            'clone_count': clone_count,
            'method': method,
            'format': fmt,
            'timestamp': datetime.now().isoformat(),
            'elapsed_total': round(elapsed_total, 2),
        }
        self.entries.insert(0, entry)
        self.save()
        return entry

    def get_all(self):
        return list(self.entries)

    def clear(self):
        self.entries = []
        self.save()
