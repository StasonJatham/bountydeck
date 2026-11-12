"""Read the BountyDeck identity using a provisioned OAuth access token."""

from __future__ import annotations

import json
import os
import re
from typing import TypeAlias, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

JsonValue: TypeAlias = (
    str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]
)


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(
        self,
        req: Request,
        fp: object,
        code: int,
        msg: str,
        headers: object,
        newurl: str,
    ) -> None:
        return None


def get_identity(origin: str, token: str) -> JsonValue:
    if not re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token):
        raise ValueError("Supply a bearer access token.")
    parsed = urlsplit(origin)
    local_http = (
        parsed.scheme == "http" and os.getenv("BOUNTYDECK_ALLOW_HTTP") == "1"
    )
    if (
        (parsed.scheme != "https" and not local_http)
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Set BOUNTYDECK_URL to the deployment origin.")
    request = Request(
        f"{origin.rstrip('/')}/api/v1/identity",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with build_opener(RejectRedirects()).open(request, timeout=10) as response:
        return cast(JsonValue, json.load(response))


def main() -> None:
    origin = os.getenv("BOUNTYDECK_URL")
    token = os.getenv("BOUNTYDECK_ACCESS_TOKEN")
    if not origin or not token:
        raise SystemExit("Set BOUNTYDECK_URL and BOUNTYDECK_ACCESS_TOKEN.")
    try:
        print(json.dumps(get_identity(origin, token), indent=2))
    except HTTPError as error:
        raise SystemExit(f"Identity request failed with HTTP {error.code}.") from None
    except (URLError, ValueError):
        raise SystemExit("Could not read the deployment's identity endpoint.") from None


if __name__ == "__main__":
    main()
