# Proxy configuration for Socket.IO (WebSocket)

If the frontend shows **"WebSocket connection to 'wss://.../socket.io/...' failed: cannot parse response"**, the reverse proxy in front of the Node backend is not forwarding WebSocket upgrades. The proxy must pass the `Upgrade` and `Connection` headers and proxy to the Node server for the path `/socket.io`.

## Nginx

```nginx
server {
    listen 443 ssl;
    server_name staffing.wudox.ca;

    location / {
        proxy_pass http://127.0.0.1:3001;   # or your Node app URL
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

If you have a separate `location /socket.io` block, ensure it also has the WebSocket headers:

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

## Caddy

Caddy v2 supports WebSocket by default when proxying. Example:

```caddy
staffing.wudox.ca {
    reverse_proxy localhost:3001
}
```

No extra config needed; Caddy forwards the Upgrade handshake.

## IIS (Application Request Routing + URL Rewrite)

IIS can proxy WebSocket (Socket.IO) only if the **WebSocket Protocol** is enabled and the reverse-proxy rule forwards requests to your Node app. Use the following steps.

### 1. Prerequisites

- **Application Request Routing (ARR)** 3.0 or later (reverse proxy for IIS).
- **URL Rewrite** module.
- **WebSocket Protocol** enabled in Windows/IIS.

To install **WebSocket Protocol** (if missing):

- **Windows Server:** Server Manager → Add Roles and Features → Web Server (IIS) → Application Development → **WebSocket Protocol**.
- **Windows 10/11 (IIS):** Turn Windows features on/off → Internet Information Services → World Wide Web Services → Application Development → **WebSocket Protocol**.

### 2. Enable ARR proxy

1. Open **IIS Manager**.
2. Click the **server** name (not the site).
3. Double-click **Application Request Routing Cache**.
4. Right side: **Server Proxy Settings**.
5. Check **Enable proxy**.
6. Apply.

### 3. URL Rewrite rule for your site

Use a rule that sends `/socket.io` (and the rest of the site) to your Node backend so that both HTTP and WebSocket upgrade requests are proxied. Replace `3001` with the port your Node app uses.

**Option A – Single rule (entire site to Node, including Socket.IO and API):**

In your site’s `web.config` (or in IIS Manager → URL Rewrite):

```xml
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxyToNode" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:3001/{R:1}" />
          <serverVariables>
            <set name="HTTP_UPGRADE" value="{HTTP_UPGRADE}" />
            <set name="HTTP_CONNECTION" value="{HTTP_CONNECTION}" />
          </serverVariables>
        </rule>
      </rules>
      <allowedServerVariables>
        <add name="HTTP_UPGRADE" />
        <add name="HTTP_CONNECTION" />
      </allowedServerVariables>
    </rewrite>
  </system.webServer>
</configuration>
```

**Option B – Socket.IO only (other paths handled by different rules or static files):**

If you already have a reverse-proxy rule for the API/SPA and only need Socket.IO to work:

```xml
<rule name="SocketIO" stopProcessing="true">
  <match url="^socket\.io/(.*)" />
  <action type="Rewrite" url="http://localhost:3001/socket.io/{R:1}" />
  <serverVariables>
    <set name="HTTP_UPGRADE" value="{HTTP_UPGRADE}" />
    <set name="HTTP_CONNECTION" value="{HTTP_CONNECTION}" />
  </serverVariables>
</rule>
```

Add the same `<allowedServerVariables>` block as in Option A.

**Important:** The rewrite URL must use the full backend address (e.g. `http://localhost:3001/...`), not just `localhost:3001/...`.

### 4. Allow server variables (one-time)

If you use `serverVariables` in the rule, they must be allowed at server level:

1. IIS Manager → **server** → **URL Rewrite**.
2. Right side: **View Server Variables**.
3. Add: `HTTP_UPGRADE`, `HTTP_CONNECTION`.

Or via **applicationHost.config** (run as Administrator), inside `<rewrite><allowedServerVariables>`:

```xml
<add name="HTTP_UPGRADE" />
<add name="HTTP_CONNECTION" />
```

### 5. Restart and test

Restart the site app pool or the IIS site, then hard-refresh the browser. Socket.IO should connect over WSS without “cannot parse response”.

## After changing the proxy

Reload the proxy (e.g. `nginx -s reload`, restart Caddy, or for IIS recycle the app pool / restart the site), then hard-refresh the frontend. The Socket.IO client will connect over WSS and the "cannot parse response" error should stop.
