# Browser egress proxy

This private HTTP CONNECT proxy is for Daiko's isolated LivePocket browser. It
permits only HTTPS connections to the fixed LivePocket and AWS WAF challenge
hostnames in `server.js`. It resolves each connection separately, rejects all
non-public addresses, connects to the validated numeric address, and requires
the TLS ClientHello SNI to match the allowed CONNECT hostname. IPv6 is
intentionally not supported; LivePocket and the challenge hosts need public A
records. The proxy does not forward ordinary HTTP requests or credentials.

Set the browser's proxy to `http://browser-proxy:3128`. Keep this service on
the browser's internal network and an egress network; never publish its port.
The browser must have no direct connection to the egress network. DNS, tunnel
duration, inactivity, bytes, and simultaneous connections are bounded. These
controls do not replace isolation of the browser from other internal services.

Run `npm ci --ignore-scripts` followed by `npm test` in this directory.
