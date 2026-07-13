import requests

BACKEND_URL = "http://back:80"
DEFAULT_TIMEOUT = 10


def get(path, timeout=DEFAULT_TIMEOUT, **kwargs):
    return requests.get(f"{BACKEND_URL}{path}", timeout=timeout, **kwargs)


def post(path, timeout=DEFAULT_TIMEOUT, **kwargs):
    return requests.post(f"{BACKEND_URL}{path}", timeout=timeout, **kwargs)


def put(path, timeout=DEFAULT_TIMEOUT, **kwargs):
    return requests.put(f"{BACKEND_URL}{path}", timeout=timeout, **kwargs)


def delete(path, timeout=DEFAULT_TIMEOUT, **kwargs):
    return requests.delete(f"{BACKEND_URL}{path}", timeout=timeout, **kwargs)
