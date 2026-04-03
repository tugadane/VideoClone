import json
import os


class Config:
    DEFAULT = {
        'ffmpeg_path': 'ffmpeg.exe',
        'default_clone_count': 10,
        'default_format': 'mp4',
        'default_template': '{title}_clone{index}_{date}',
        'default_output_folder': os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'hasil'),
        'default_method': 'fast',
        'notify_popup': True,
        'notify_sound': True,
    }

    def __init__(self, path=None):
        if path is None:
            base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            path = os.path.join(base, 'config.json')
        self.path = path
        self.data = dict(self.DEFAULT)
        self.load()

    def load(self):
        if os.path.exists(self.path):
            with open(self.path, 'r', encoding='utf-8') as f:
                saved = json.load(f)
            for key in self.DEFAULT:
                if key in saved:
                    self.data[key] = saved[key]
        else:
            self.save()

    def save(self):
        os.makedirs(os.path.dirname(self.path) or '.', exist_ok=True)
        with open(self.path, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, indent=2, ensure_ascii=False)

    def get(self, key):
        return self.data.get(key, self.DEFAULT.get(key))

    def set(self, key, value):
        self.data[key] = value
        self.save()

    def update(self, updates):
        for key, value in updates.items():
            if key in self.DEFAULT:
                self.data[key] = value
        self.save()

    def to_dict(self):
        return dict(self.data)
