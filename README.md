# cianporteous.com

Static site with a small Go server in front of it.

    go run main.go        # https://localhost:8443

`main.go` serves `static/` and nothing else — no templating, no build step. The
TLS certificate is a local development one and is deliberately not committed
(see `.gitignore`); regenerate with mkcert if you need it.

## Layout

    static/            the site itself
    static/clonskeagh/ a 3D map of Clonskeagh, served at /clonskeagh/

## static/clonskeagh

Built output, copied in from the `clonskeagh-3d` project — don't edit it here.
To update it, run `make_dist.py` there and copy `dist/` over the top.

It's about 14 MB, most of that `world.json`. That is committed rather than
generated at deploy time because reproducing it needs an hour of satellite
imagery processing. Worth knowing: re-baking the map replaces `world.json`
wholesale, so every rebake adds another ~2 MB to this repository permanently.
A handful is fine; if it's ever rebuilt often, move it out to its own deploy.

The game is plain static files and everything it loads is relative, so it works
from `/clonskeagh/` as happily as from a root — provided the server redirects
`/clonskeagh` to `/clonskeagh/`, which `StaticFileServer` now does.
