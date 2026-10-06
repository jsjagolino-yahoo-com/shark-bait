# 🦈 Shark Bait

A phone-tapping elimination game for the monthly meeting. Players tap their screens to keep their fish swimming. The slowest fish sink and get eaten by the shark. When the round's quota of fish has been eaten, the round ends. Rounds repeat until one fish is left.

**Stack:** Node.js + Express + Socket.IO (real-time server), plain HTML5 Canvas (graphics). Players don't install anything; they just open a link.

## Run it

```bash
npm install
npm start
```

| Who | URL |
| --- | --- |
| Players (phones) | `http://<your-ip>:3000` (shown as a QR code on the big screen) |
| Game Master (projector + controls) | `http://localhost:3000/host?key=shark` |
| Extra display-only screen | `http://localhost:3000/screen` |

To change the Game Master password, set `HOST_KEY` before starting:

```powershell
$env:HOST_KEY="mysecret"; npm start
```

## Running the meeting

1. Open `/host?key=shark` on the laptop connected to the projector. Players scan the QR code.
2. Press **Start game** (or the Space key). After a 3‑second countdown, everyone taps.
3. The sea sinks faster every second, so every round is guaranteed to end. The fish closest to the shark get a red ring and a ⚠ label, and appear in the Danger Zone list. The camera zooms in and puts a spotlight on the fish nearest to death, and the shark chases it.
4. When the round's quota is eaten, the round ends. Press **Start round N** to continue.
5. The last fish swimming wins 🏆. Press **Reset to lobby** to play again.

Controls: **Eaten per round** (you can change it between rounds), **Zoom on near-death** toggle, **Players** list with a Kick button, **H** to hide the controls.

> Tip: each round takes about 30–60 s. With a large group, raise *Eaten per round*. For example, with 80 people try 15–20 per round so the game finishes in 4–5 rounds.

## Hosting so phones can connect

- **Same Wi‑Fi (simplest):** run it on a laptop. Phones open the LAN address printed in the console or shown in the QR code. Corporate Wi‑Fi often blocks phone‑to‑laptop traffic ("client isolation"), so test this before the meeting. You may also need to allow Node through Windows Firewall.
- **Tunnel (works on mobile data):** `npx cloudflared tunnel --url http://localhost:3000` gives you a public https URL. Open `/host` through that URL so the QR code points to it.
- **Cloud:** deploy to Render, Railway or Fly.io as a plain Node app (`npm start`, it respects `PORT`). Use one instance, because the game state is kept in memory.

## Rehearsal with bots

```bash
npm run bots -- 30
```

This adds 30 fake players with different tapping speeds.

## Tuning

The constants at the top of `server.js` control the difficulty:

- `BASE_SINK`: how fast fish sink at the start of a round.
- `SINK_RAMP`: how quickly sinking speeds up. Higher means shorter rounds.
- `TAP_LIFT`: how much lift each tap gives.
- `MAX_TAP_RATE`: the anti-cheat cap on taps per second.
