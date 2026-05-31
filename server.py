import os
import asyncio
import json
import websockets

CONNECTED = set()
PARTIDA = {"W": None, "B": None}

async def handler(websocket):
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
            if data["type"] == "move":
                for ws in CONNECTED:
                    if ws != websocket:
                        await ws.send(json.dumps({
                            "type": "move",
                            "fromRow": data["fromRow"],
                            "fromCol": data["fromCol"],
                            "toRow": data["toRow"],
                            "toCol": data["toCol"]
                        }))
            elif data["type"] == "restart":
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
    async with websockets.serve(handler, "0.0.0.0", port):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
