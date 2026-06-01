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
    async with websockets.serve(handler, "0.0.0.0", port):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())