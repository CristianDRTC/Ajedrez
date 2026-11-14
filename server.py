import os 
import asyncio 
import json 
import time
from urllib.parse import parse_qs, urlparse
import websockets 

CONNECTED = set()
PARTIDA = {"W": None, "B": None}
ROOMS = {}
INITIAL_CLOCK_SECONDS = 600

def create_room():
    return {
        "players": {},
        "pending": [],
        "spectators": set(),
        "moves": [],
        "clocks": {"W": INITIAL_CLOCK_SECONDS, "B": INITIAL_CLOCK_SECONDS},
        "turn": "W",
        "started": False,
        "game_over": False,
        "winner": None,
        "end_reason": None,
        "last_tick": time.monotonic(),
    }

async def send_message(websocket, payload):
    try:
        await websocket.send(json.dumps(payload))
    except websockets.exceptions.ConnectionClosed:
        pass

async def broadcast_room(room, payload, exclude=None, include_spectators=True):
    recipients = set(room["players"].values()) | set(room["pending"])
    if include_spectators:
        recipients.update(room["spectators"])
    if exclude is not None:
        recipients.discard(exclude)
    await asyncio.gather(*(send_message(ws, payload) for ws in recipients))

async def end_room(room_id, room, winner, reason):
    if room["game_over"]:
        return
    room["game_over"] = True
    room["started"] = False
    room["winner"] = winner
    room["end_reason"] = reason
    await broadcast_room(room, {
        "type": "game_over",
        "winner": winner,
        "reason": reason,
        "roomId": room_id,
    })

async def update_room_clock(room_id, room):
    now = time.monotonic()
    if room["started"] and not room["game_over"]:
        elapsed = now - room["last_tick"]
        active_color = room["turn"]
        room["clocks"][active_color] = max(0, room["clocks"][active_color] - elapsed)
        room["last_tick"] = now
        if room["clocks"][active_color] <= 0:
            await end_room(room_id, room, "B" if active_color == "W" else "W", "timeout")
    await broadcast_room(room, {
        "type": "clocks",
        "clocks": room["clocks"],
        "turn": room["turn"],
        "running": room["started"] and not room["game_over"],
        "sentAt": time.time() * 1000,
        "roomId": room_id,
    })

async def start_room(room_id, room):
    room["clocks"] = {"W": INITIAL_CLOCK_SECONDS, "B": INITIAL_CLOCK_SECONDS}
    room["turn"] = "W"
    room["started"] = True
    room["game_over"] = False
    room["winner"] = None
    room["end_reason"] = None
    room["moves"] = []
    room["last_tick"] = time.monotonic()
    await broadcast_room(room, {"type": "start", "roomId": room_id})
    await update_room_clock(room_id, room)

async def handle_room_connection(websocket, room_id):
    room = ROOMS.setdefault(room_id, create_room())
    if len(room["players"]) + len(room["pending"]) >= 2:
        room["spectators"].add(websocket)
        await send_message(websocket, {
            "type": "init",
            "spectator": True,
            "roomId": room_id,
            "moves": room["moves"],
            "clocks": room["clocks"],
            "turn": room["turn"],
            "running": room["started"] and not room["game_over"],
            "gameOver": room["game_over"],
            "winner": room["winner"],
            "endReason": room["end_reason"],
        })
    else:
        room["pending"].append(websocket)
        if not room["players"] and room["pending"][0] is websocket:
            await send_message(websocket, {"type": "init", "needsColor": True, "roomId": room_id})
        elif len(room["players"]) == 1:
            available_color = "B" if "W" in room["players"] else "W"
            room["pending"].remove(websocket)
            room["players"][available_color] = websocket
            await send_message(websocket, {"type": "init", "color": available_color, "roomId": room_id})
            await start_room(room_id, room)
        else:
            await send_message(websocket, {"type": "init", "waitingForColor": True, "roomId": room_id})

    try:
        async for message in websocket:
            data = json.loads(message)
            msg_type = data.get("type")
            player_color = next((color for color, player in room["players"].items() if player is websocket), None)

            if msg_type == "ping":
                await send_message(websocket, {"type": "pong"})
            elif msg_type == "choose_color":
                if room["pending"] and room["pending"][0] is websocket and not room["players"]:
                    chosen_color = data.get("color")
                    if chosen_color not in ("W", "B"):
                        await send_message(websocket, {"type": "error", "message": "Elige Blancas o Negras."})
                        continue
                    room["pending"].remove(websocket)
                    room["players"][chosen_color] = websocket
                    await send_message(websocket, {"type": "init", "color": chosen_color, "roomId": room_id})
                    if room["pending"]:
                        second_player = room["pending"].pop(0)
                        remaining_color = "B" if chosen_color == "W" else "W"
                        room["players"][remaining_color] = second_player
                        await send_message(second_player, {"type": "init", "color": remaining_color, "roomId": room_id})
                        await start_room(room_id, room)
                else:
                    await send_message(websocket, {"type": "error", "message": "No se puede cambiar el color en este momento."})
            elif msg_type == "move":
                await update_room_clock(room_id, room)
                if room["game_over"] or player_color != room["turn"]:
                    continue
                move = {
                    "type": "move",
                    "fromRow": data["fromRow"],
                    "fromCol": data["fromCol"],
                    "toRow": data["toRow"],
                    "toCol": data["toCol"],
                    "promotedPiece": data.get("promotedPiece"),
                    "roomId": room_id,
                }
                room["moves"].append({key: move[key] for key in (
                    "fromRow", "fromCol", "toRow", "toCol", "promotedPiece"
                )})
                await broadcast_room(room, move, exclude=websocket)
                room["turn"] = "B" if room["turn"] == "W" else "W"
                room["last_tick"] = time.monotonic()
                await update_room_clock(room_id, room)
            elif msg_type == "resign":
                if player_color is None or room["game_over"]:
                    continue
                await broadcast_room(room, {
                    "type": "resign",
                    "color": player_color,
                    "colorQueAbandona": player_color,
                    "roomId": room_id,
                }, exclude=websocket)
                await end_room(room_id, room, "B" if player_color == "W" else "W", "resign")
            elif msg_type == "offer_draw":
                if player_color is None or room["game_over"]:
                    continue
                await broadcast_room(room, {
                    "type": "offer_draw",
                    "sender": player_color,
                    "color": player_color,
                    "roomId": room_id,
                }, exclude=websocket, include_spectators=False)
            elif msg_type == "accept_draw":
                if player_color is not None and not room["game_over"]:
                    await broadcast_room(room, {"type": "accept_draw", "roomId": room_id}, exclude=websocket)
                    await end_room(room_id, room, None, "draw")
            elif msg_type == "request_rematch":
                if player_color is None:
                    continue
                await broadcast_room(room, {
                    "type": "rematch_offered",
                    "senderColor": player_color,
                    "roomId": room_id,
                }, exclude=websocket, include_spectators=False)
            elif msg_type == "accept_rematch":
                if player_color is not None and len(room["players"]) == 2:
                    white_player = room["players"].get("W")
                    black_player = room["players"].get("B")
                    room["players"] = {"W": black_player, "B": white_player}
                    await send_message(room["players"]["W"], {"type": "init", "color": "W", "roomId": room_id})
                    await send_message(room["players"]["B"], {"type": "init", "color": "B", "roomId": room_id})
                    await start_room(room_id, room)
            elif msg_type == "game_over" and player_color is not None:
                await end_room(room_id, room, data.get("winner"), data.get("reason", "checkmate"))
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        room["spectators"].discard(websocket)
        if websocket in room["pending"]:
            room["pending"].remove(websocket)
        was_player = False
        for color, player in list(room["players"].items()):
            if player is websocket:
                del room["players"][color]
                was_player = True
        if was_player:
            room["started"] = False
            await broadcast_room(room, {"type": "opponent_left", "roomId": room_id})
        if not room["players"] and room["pending"]:
            await send_message(room["pending"][0], {"type": "init", "needsColor": True, "roomId": room_id})
        if not room["players"] and not room["pending"] and not room["spectators"]:
            ROOMS.pop(room_id, None)

async def clock_loop():
    while True:
        await asyncio.sleep(0.5)
        for room_id, room in list(ROOMS.items()):
            if room["started"]:
                await update_room_clock(room_id, room)

async def handler(websocket):
    request = getattr(websocket, "request", None)
    request_path = getattr(request, "path", getattr(websocket, "path", "/"))
    query = parse_qs(urlparse(request_path).query)
    if query.get("modern") == ["1"]:
        room_id = query.get("room", ["room-1"])[0]
        if room_id not in {"room-1", "room-2", "room-3"}:
            await websocket.send(json.dumps({"type": "error", "message": "Sala no válida."}))
            return
        await handle_room_connection(websocket, room_id)
        return

    global PARTIDA 
    CONNECTED.add(websocket)

    color_asignado = None 
    if PARTIDA["W"] is None:
        PARTIDA["W"] = websocket 
        color_asignado = "W"
    elif PARTIDA["B"] is None:
        PARTIDA["B"] = websocket 
        color_asignado = "B"

    if color_asignado:
        await websocket.send(json.dumps({"type": "init", "color": color_asignado}))
        if PARTIDA["W"] and PARTIDA["B"]:
            websockets.broadcast(CONNECTED, json.dumps({"type": "start"}))
    else:
        await websocket.send(json.dumps({"type": "error", "message": "Sala llena. Intenta más tarde."}))
        CONNECTED.remove(websocket)
        return 

    try:
        async for message in websocket:
            data = json.loads(message)
            msg_type = data.get("type")

            # 1. ENVIAR MOVIMIENTOS
            if msg_type == "move":
                for ws in CONNECTED:
                    if ws != websocket:
                        await ws.send(json.dumps({
                            "type": "move",
                            "fromRow": data["fromRow"],
                            "fromCol": data["fromCol"],
                            "toRow": data["toRow"],
                            "toCol": data["toCol"],
                            "promotedPiece": data.get("promotedPiece")
                        }))

            # 2. ENVIAR MENSAJE DE RENDICIÓN AL RIVAL
            elif msg_type == "resign":
                for ws in CONNECTED:
                    if ws != websocket:
                        await ws.send(json.dumps({
                            "type": "resign",
                            "color": data.get("color"),
                            "colorQueAbandona": data.get("colorQueAbandona")
                        }))

            # 3. ENVIAR OFERTA DE TABLAS AL RIVAL
            elif msg_type == "offer_draw":
                for ws in CONNECTED:
                    if ws != websocket:
                        await ws.send(json.dumps({
                            "type": "offer_draw",
                            "sender": data.get("sender"),
                            "color": data.get("color")
                        }))

            # 4. ENVIAR ACEPTACIÓN DE TABLAS AL RIVAL
            elif msg_type == "accept_draw":
                for ws in CONNECTED:
                    if ws != websocket:
                        await ws.send(json.dumps({"type": "accept_draw"}))

            # 5. SOLICITAR REVANCHA AL RIVAL
            elif msg_type == "request_rematch":
                for ws in CONNECTED:
                    if ws != websocket:
                        await ws.send(json.dumps({
                            "type": "rematch_offered",
                            "senderColor": data.get("senderColor")
                        }))

            # 6. ACEPTAR REVANCHA (Intercambia colores y reinicia)
            elif msg_type == "accept_rematch":
                old_w = PARTIDA["W"]
                old_b = PARTIDA["B"]
                PARTIDA["W"] = old_b
                PARTIDA["B"] = old_w
                
                if PARTIDA["W"]:
                    await PARTIDA["W"].send(json.dumps({"type": "init", "color": "W"}))
                if PARTIDA["B"]:
                    await PARTIDA["B"].send(json.dumps({"type": "init", "color": "B"}))
                
                websockets.broadcast(CONNECTED, json.dumps({"type": "start"}))

            # 7. REINICIAR MANUAL
            elif msg_type == "restart":
                websockets.broadcast(CONNECTED, json.dumps({"type": "restart"}))

    except websockets.exceptions.ConnectionClosed:
        pass 
    finally:
        CONNECTED.remove(websocket)
        if PARTIDA["W"] == websocket:
            PARTIDA["W"] = None 
        elif PARTIDA["B"] == websocket:
            PARTIDA["B"] = None 
        websockets.broadcast(CONNECTED, json.dumps({"type": "opponent_left"}))

async def main():
    port = int(os.environ.get("PORT", 8080))
    asyncio.create_task(clock_loop())
    async with websockets.serve(handler, "0.0.0.0", port):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())