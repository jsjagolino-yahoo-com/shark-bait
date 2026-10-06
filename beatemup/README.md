# 🥊 Beat 'Em Up

A phone-controlled, last-fighter-standing brawler for the monthly meeting. Every player is a stick figure with a random animal head and a stick. Use the D-pad to move and **HIT!** to swing. Knock everyone else out to win.

**Stack:** Node.js + Express + Socket.IO (real-time server), plain HTML5 Canvas (graphics). Players don't install anything; they just open a link.

## Run it locally

```bash
cd beatemup
npm install
npm start
```

| Who | URL |
| --- | --- |
| Players (phones) | `http://<your-ip>:3001` (shown as a QR code on the big screen) |
| Game Master (projector + controls) | `http://localhost:3001/host?key=beatemup` |
| Extra display-only screen | `http://localhost:3001/screen` |

To change the Game Master password, set `HOST_KEY` before starting. On Render, set it under the service's **Environment** settings.

## How a game goes

1. **Lobby / practice:** players scan the QR code and enter a name. They can already walk around and swing in the arena, with no damage, to learn the controls.
2. **Start fight** (button or Space key): a 3-second countdown, then **FIGHT!**
3. Each fighter has **150 HP**, and a hit does 9–13 damage. A stick only hits fighters in front of you at about the same depth on the floor. Each hit knocks the target back.
4. After **45 s** the arena starts shrinking. Standing outside the safe zone drains HP, so nobody can hide in a corner and the game always ends.
5. The big screen shows **fighters left**, a **KO feed** (who knocked out whom), the **Top KOs** leaderboard, and finally the **winner** with a podium for most knockouts.
6. **Rematch:** press *Rematch (back to lobby)*, then *Start fight* again.

Controls on the phone: drag on the D-pad (8 directions) and tap or hold **HIT!**. On a laptop you can also use the arrow keys/WASD and Space.

## Rehearsal with bots

```bash
npm run bots -- 30
```

This adds 30 fake fighters that chase the nearest opponent and swing.

## Tuning

The constants at the top of `server.js` control the game:

- `MAX_HP`, `DMG_MIN`, `DMG_MAX`: how long a fight lasts.
- `REACH`, `DEPTH_REACH`: how close you need to be to land a hit.
- `ATTACK_COOLDOWN_MS`: how fast you can swing.
- `SHRINK_AFTER_MS`, `SHRINK_DURATION_MS`, `RING_DPS`: when the arena closes in and how much standing outside hurts.
