import webview
from api import Api


def main():
    api = Api()
    window = webview.create_window(
        title="Clone Studio v0.6.3",
        url='web/index.html',
        js_api=api,
        width=1280,
        height=800,
        min_size=(1024, 600),
        frameless=True,
        easy_drag=False,
    )
    api.set_window(window)
    webview.start(debug=False, http_server=True)


if __name__ == "__main__":
    main()
