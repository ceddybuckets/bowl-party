# Bowl Party

Swing-to-bowl party game for phones. One small Node server, no dependencies.

## Run it tonight (your laptop + a free HTTPS tunnel)
iPhones only allow motion sensors on HTTPS pages, so the tunnel is what makes swing work.

1. Install Node 18+ (https://nodejs.org) and cloudflared (`brew install cloudflared` on Mac).
2. In this folder: `node server.js`
3. In a second terminal: `cloudflared tunnel --url http://localhost:8080`
4. It prints an `https://something.trycloudflare.com` address. Open it on your iPhone, tap **Start a room**,
   and friends scan the QR code. Keep the laptop awake while you play. The address changes each time you run the tunnel.

## Host it permanently (free, Render.com)
1. Put this folder in a GitHub repo.
2. On render.com: New → Web Service → pick the repo. Runtime: Node. Build command: (leave empty). Start command: `node server.js`.
3. Use the `https://your-app.onrender.com` address. On the free plan the server sleeps when idle, so the first visit takes about a minute to wake it.

Any host that runs Node and supports WebSockets works (Railway, Fly.io, a VPS, …).

## Playing
- Tap **💪 Swing** once per visit and allow motion access.
- Hold the phone like a remote, top pointing forward. Hold the big button, swing your arm back and then forward, and let go of the button to release.
  Twist your wrist as you let go to hook the ball. Drag sideways on the lane beforehand to line up.
- Swipe controls still work for anyone who prefers them.
