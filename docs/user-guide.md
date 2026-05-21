# User Guide

This guide explains how to use the Hong Kong Mahjong web UI after starting it locally or opening the deployed Azure Container Apps website.

## Quick start

1. Open the website.
2. Wait for the status card at the top-right to show either **Local server room** or **Demo adapter**.
3. For real multiplayer, click **Create server room**.
4. Share the **Room code** with the other players.
5. Each player joins the room, then claims one seat.
6. Play only when the **Eligible actions** panel shows **Your prompt**.

The app supports exactly four seats per room: East, South, West, and North. Unclaimed seats remain AI-controlled.

## Main controls

| UI control | What it does |
| --- | --- |
| **API base** | HTTP API endpoint. On Azure this should default to the current website URL. In local Vite dev it defaults to `http://127.0.0.1:8787`. |
| **WebSocket URL** | Realtime room feed endpoint. On Azure this should default to the current website URL with `/ws`. |
| **Room code** | The room to join. The creator sees the room code in the Room card after creating a server room. |
| **Display name** | Name used when claiming a seat. |
| **AI difficulty** | Difficulty used by AI seats and four-AI spectator mode. |
| **Create server room** | Creates a multiplayer room on the running server. Use this for real player-vs-player games. |
| **Join room** | Looks up the room code currently typed in the **Room code** field. |
| **Use local demo** | Starts a single-browser demo room. This is good for trying the UI without a server. |
| **Auto-play to prompt** | In demo mode, lets AI players move until the human seat has a legal action. |
| **Watch 4 AIs** | Starts a local four-AI game with no human seat claimed. |
| **Pause/Resume 4 AIs** | Controls four-AI autoplay. If a round is finished, **Resume 4 AIs** starts the next AI round and continues. |
| **Step 4 AIs** | Advances one AI action. If a round is finished, it starts the next AI round. |
| **Start next AI round** | Appears after a four-AI round ends; starts the next round after a win or draw. |

## Hosting a multiplayer room

The first player should create the room:

1. Open the website.
2. Enter a display name.
3. Click **Create server room**.
4. Copy the room code shown in the Room card.
5. Click one seat in **Seat takeover** to claim it.

Other players should join:

1. Open the same website.
2. Enter the shared room code in **Room code**.
3. Enter a display name.
4. Click **Join room**.
5. Click an unclaimed seat in **Seat takeover**.

After joining, the table updates through WebSocket messages. If the socket disconnects, refresh the page and rejoin the room.

## Taking actions

The server is authoritative. You can only act when the **Eligible actions** panel says **Your prompt**.

Common actions:

- **Draw tile**: draw from the wall when it is your turn.
- **Discard**: click a selectable tile in your hand.
- **Pass**: decline a claim window after another player discards.
- **Chow/Pong/Kong**: claim another player's discard when the engine says the action is legal.
- **Declare self-draw win** or **Claim win on discard**: win when the engine validates the hand and minimum Fan requirement.
- **Start next round**: appears after a finished human/server round for the active claimed seat.

If no actions are shown, wait for another player or AI to move.

## Reading the table

| Area | Meaning |
| --- | --- |
| **Wall** | Remaining live wall tiles, dead wall tiles, and replacement draw count. |
| **Round wind** | Current prevailing wind and dealer seat. |
| **Current turn** | Player who is expected to draw or discard. |
| **Last discard** | Most recent discarded tile and the seat that discarded it. |
| **Player panels** | Each player's melds, flowers/seasons, discards, and concealed tile count. |
| **Your hand** | Your concealed tiles. A newly drawn tile stays highlighted on the right edge until discarded or the turn changes. |
| **Table ledger** | Scores, winning Fan, payment lines, and score deltas after a round ends. |
| **Game log** | Recent room and AI/player events. |

Concealed hands for other players are hidden during active play. After a win or draw, all hands are revealed and the winning tile is highlighted separately.

## Four-AI spectator mode

Use this to watch the game run by itself:

1. Select **AI difficulty**.
2. Click **Watch 4 AIs**.
3. Use **Pause 4 AIs**, **Resume 4 AIs**, or **Step 4 AIs**.
4. After a win or draw, click **Start next AI round**, **Resume 4 AIs**, or **Step 4 AIs** to continue.

Four-AI spectator mode is local to your browser. It is useful for testing gameplay and observing payments/round progression.

## Current deployment limitations

- Each room has exactly four seats.
- The current Azure deployment runs one app replica, so in-memory room state is shared by all players connected to that instance.
- Multiple rooms can exist at the same time on that one instance.
- Active rooms are not durable across app restarts or redeploys.
- Multi-replica scale-out is intentionally disabled until durable room storage and distributed coordination are implemented.

## Troubleshooting

| Symptom | What to try |
| --- | --- |
| The app opens in **Demo adapter** mode | Click **Create server room** again. If it still fails, check that the server/Container App is running. |
| Other players cannot join | Confirm everyone uses the same website URL and exact room code. |
| No actions are available | Wait for the current player, claim a seat, or use **Auto-play to prompt** in demo mode. |
| WebSocket stops updating | Refresh the page, re-enter the room code, and join again. |
| After redeploy, the room disappeared | Rooms are currently in memory and are cleared by restart/redeploy. Create a new room. |
